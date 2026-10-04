import { error, fail } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards';
import { invokeFunction } from '#lib/server/functions/invoke';
import type { Database } from '#lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

/**
 * Commitment detail — `/commitment/[commitment_id]`.
 *
 * Both parties see the same page; which actions are offered depends on their
 * role and the current status. That is decided on the server from the verified
 * session, and every action re-checks it before writing.
 *
 * NOT DONE HERE, deliberately:
 *   * no stake is locked, refunded or forfeited — the wallet service does not
 *     exist. Status and the event log are maintained correctly, so when it
 *     does exist it has an accurate history to act on.
 *   * reputation counters are not incremented. Everything needed to compute
 *     them later is recorded in `commitment_events`.
 */

type EventType = Database['public']['Enums']['commitment_event_type'];
type Party = Database['public']['Enums']['commitment_party'];

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const user = requireUser(await locals.getVerifiedUser(), url.pathname);

	const { data: commitment, error: loadError } = await locals.supabase
		.from('commitments')
		.select(
			'id, status, responsible_party, scheduled_at, request_expires_at, created_at, accepted_at, declined_at, cancelled_at, buyer_id, seller_id, buyer_stake_cents, seller_stake_cents, listings(id, title, price_cents, condition), meetup_locations(name, latitude, longitude)'
		)
		.eq('id', params.commitment_id)
		.maybeSingle();

	if (loadError) error(500, 'This commitment could not be loaded.');

	/**
	 * RLS returns no row for a commitment the viewer is not party to, which
	 * arrives here as "not found". That is the right answer: confirming one
	 * exists would leak that two particular people arranged to meet, which the
	 * privacy rules exist to prevent.
	 */
	if (!commitment) error(404, 'That commitment does not exist.');

	const { data: events } = await locals.supabase
		.from('commitment_events')
		.select('id, event_type, actor_role, occurred_at')
		.eq('commitment_id', commitment.id)
		.order('occurred_at', { ascending: true });

	const isBuyer = commitment.buyer_id === user.id;

	/**
	 * A pending request past its deadline is dead, but nothing has marked it so
	 * — expiry needs a scheduled job that does not exist yet. Computed here so
	 * the page tells the truth meanwhile; the accept action refuses it
	 * independently rather than trusting this value.
	 */
	const expired =
		commitment.status === 'pending' && new Date(commitment.request_expires_at) <= new Date();

	return { commitment, events: events ?? [], isBuyer, expired };
};

/** Loads a commitment and confirms the caller is party to it. */
async function requireParty(locals: App.Locals, commitmentId: string, pathname: string) {
	const user = requireUser(await locals.getVerifiedUser(), pathname);

	const { data } = await locals.supabase
		.from('commitments')
		.select('id, status, buyer_id, seller_id, request_expires_at')
		.eq('id', commitmentId)
		.maybeSingle();

	if (!data) error(404, 'That commitment does not exist.');

	const isBuyer = data.buyer_id === user.id;
	const isSeller = data.seller_id === user.id;

	if (!isBuyer && !isSeller) error(403, 'That commitment is not yours.');

	return { user, commitment: data, isBuyer, isSeller };
}

/** Records what happened, who did it, and in which role. */
async function recordEvent(
	locals: App.Locals,
	commitmentId: string,
	eventType: EventType,
	actorId: string,
	actorRole: Party
) {
	await locals.supabase.from('commitment_events').insert({
		commitment_id: commitmentId,
		event_type: eventType,
		actor_profile_id: actorId,
		actor_role: actorRole
	});
}

const ok = (message: string) => ({ actionError: null, message, needsFunds: false });

export const actions: Actions = {
	/**
	 * The seller agrees. Delegated to `respond_to_commitment`, which takes the
	 * seller's stake before activating the commitment.
	 *
	 * This file no longer changes the status itself. Only the Edge Function can
	 * move the money, and a commitment must never become active with one side
	 * unpaid — so the state change belongs where the payment happens.
	 */
	accept: async ({ locals, params, url }) => {
		requireUser(await locals.getVerifiedUser(), url.pathname);

		const result = await invokeFunction<{ stake_lamports: number }>(
			locals.supabase,
			'respond_to_commitment',
			{ commitment_id: params.commitment_id, action: 'accept' }
		);

		if (!result.ok) {
			return fail(result.error.code === 'INSUFFICIENT_FUNDS' ? 402 : 409, {
				actionError: result.error.message,
				message: null,
				needsFunds: result.error.code === 'INSUFFICIENT_FUNDS' || result.error.code === 'WALLET_NOT_FOUND'
			});
		}

		return ok('Accepted. Both stakes are now held — you are committed to this meetup.');
	},

	/** The seller says no. Takes nothing from them and refunds the buyer. */
	decline: async ({ locals, params, url }) => {
		requireUser(await locals.getVerifiedUser(), url.pathname);

		const result = await invokeFunction<{ refunded: boolean }>(
			locals.supabase,
			'respond_to_commitment',
			{ commitment_id: params.commitment_id, action: 'decline' }
		);

		if (!result.ok) {
			return fail(409, { actionError: result.error.message, message: null, needsFunds: false });
		}

		/**
		 * The refund can fail independently of the decline. Saying so is the
		 * point: claiming the money is back when it is not would be a lie the
		 * user could only discover by checking their balance.
		 */
		return ok(
			result.data.refunded
				? 'Declined. The buyer has been refunded.'
				: 'Declined. The buyer refund is still processing and will complete shortly.'
		);
	},

	/** The buyer takes back their own request before it is accepted. */
	withdraw: async ({ locals, params, url }) => {
		const { user, commitment, isBuyer } = await requireParty(
			locals,
			params.commitment_id,
			url.pathname
		);

		if (!isBuyer) {
			return fail(403, { actionError: 'Only the buyer can withdraw a request.', message: null, needsFunds: false });
		}
		if (commitment.status !== 'pending') {
			return fail(409, { actionError: 'This request is no longer open.', message: null, needsFunds: false });
		}

		await locals.supabase
			.from('commitments')
			.update({ status: 'declined', declined_at: new Date().toISOString() })
			.eq('id', commitment.id)
			.eq('status', 'pending');

		await recordEvent(locals, commitment.id, 'buyer_withdrew', user.id, 'buyer');

		return ok('Request withdrawn.');
	},

	/**
	 * Either party backs out AFTER acceptance.
	 *
	 * The one action that carries a consequence: whoever cancels forfeits their
	 * stake and the other is refunded. Neither happens yet — there is no wallet
	 * — but `responsible_party` is recorded now, so that when there is one, the
	 * history already says who was at fault rather than requiring it to be
	 * inferred from timestamps.
	 */
	cancel: async ({ locals, params, url }) => {
		const { user, commitment, isBuyer } = await requireParty(
			locals,
			params.commitment_id,
			url.pathname
		);

		if (commitment.status !== 'accepted') {
			return fail(409, {
				actionError: 'Only an accepted commitment can be cancelled.',
				message: null,
				needsFunds: false
			});
		}

		const role: Party = isBuyer ? 'buyer' : 'seller';

		const { error: updateError } = await locals.supabase
			.from('commitments')
			.update({
				status: 'cancelled',
				responsible_party: role,
				cancelled_at: new Date().toISOString()
			})
			.eq('id', commitment.id)
			.eq('status', 'accepted');

		if (updateError) {
			return fail(500, { actionError: 'The commitment could not be cancelled.', message: null, needsFunds: false });
		}

		await recordEvent(
			locals,
			commitment.id,
			isBuyer ? 'buyer_cancelled' : 'seller_cancelled',
			user.id,
			role
		);

		/**
		 * The listing returns to `active` automatically — the trigger on this
		 * table does it, so a seller whose buyer cancelled at 2am does not wake
		 * up to an item that silently stopped being visible.
		 */
		return ok('Cancelled. The listing is available again.');
	}
};
