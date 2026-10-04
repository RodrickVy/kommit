import { error, fail } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards';
import { invokeFunction } from '#lib/server/functions/invoke';
import { renderQrSvg } from '#lib/server/qr';
import type { Database } from '#lib/supabase/database.types';
import type { Actions, PageServerLoad } from './$types';

/**
 * Commitment detail — `/commitment/[commitment_id]`.
 *
 * Both parties see the same page; which actions are offered depends on their
 * role and the current status. That is decided on the server from the verified
 * session, and every action re-checks it before writing.
 *
 * NOTHING HERE MOVES MONEY OR CHANGES A STATUS DIRECTLY.
 * Accepting, declining, cancelling, checking in, verifying the meetup and
 * paying all delegate to Edge Functions, because each one has to change state
 * and move SOL together. The one exception is withdrawing an unfunded request
 * of one's own, which moves nothing.
 *
 * THE TWO QR CODES ARE SEPARATE THINGS and the page must never blur them:
 *
 *   QR #1 — verify the meetup. Returns both stakes. Buys nothing.
 *   QR #2 — buy the item. Only after QR #1, and only if the buyer wants to.
 */

type EventType = Database['public']['Enums']['commitment_event_type'];
type Party = Database['public']['Enums']['commitment_party'];

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const user = requireUser(await locals.getVerifiedUser(), url.pathname);

	const { data: commitment, error: loadError } = await locals.supabase
		.from('commitments')
		.select(
			'id, status, responsible_party, scheduled_at, request_expires_at, created_at, accepted_at, declined_at, cancelled_at, buyer_id, seller_id, buyer_stake_cents, seller_stake_cents, buyer_stake_lamports, seller_stake_lamports, buyer_checked_in_at, seller_checked_in_at, check_in_window_ends_at, meetup_verified_at, completed_at, listings(id, title, price_cents, condition, status), meetup_locations(name, latitude, longitude)'
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

	const [eventsResult, settingsResult, paymentResult] = await Promise.all([
		locals.supabase
			.from('commitment_events')
			.select('id, event_type, actor_role, occurred_at')
			.eq('commitment_id', commitment.id)
			.order('occurred_at', { ascending: true }),

		/** Needed to tell the user the radius and the window before they act, not after. */
		locals.supabase
			.from('market_settings')
			.select('check_in_radius_metres, check_in_window_minutes')
			.eq('id', 1)
			.maybeSingle(),

		/**
		 * The purchase, if there is one. Read through the user's own client, so
		 * the policy on `payments` confirms they are party to it.
		 */
		locals.supabase
			.from('payments')
			.select('id, status, amount_cents, amount_lamports, solana_signature, completed_at')
			.eq('commitment_id', commitment.id)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle()
	]);

	const isBuyer = commitment.buyer_id === user.id;

	/**
	 * A pending request past its deadline is dead even though nothing has
	 * marked it so yet — `process_commitments` does that on its next run.
	 * Computed here so the page tells the truth meanwhile; the accept action
	 * refuses it independently rather than trusting this value.
	 */
	const expired =
		commitment.status === 'pending' && new Date(commitment.request_expires_at) <= new Date();

	return {
		commitment,
		events: eventsResult.data ?? [],
		settings: settingsResult.data,
		payment: paymentResult.data,
		isBuyer,
		expired
	};
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

/**
 * One result shape for every action on this page.
 *
 * Normalised because SvelteKit unions the return types of all actions into
 * `form`, and a page branching on six different shapes becomes unreadable very
 * quickly. Every field is always present, so the template never has to guess
 * which action produced the result it is rendering.
 */
interface ActionResult {
	actionError: string | null;
	message: string | null;

	/** True when the failure is "not enough SOL", which earns an Add funds link. */
	needsFunds: boolean;

	/** A freshly issued QR, for the seller to display. Never both at once. */
	qr: {
		purpose: 'meetup_verification' | 'purchase';
		url: string;
		svg: string | null;
		expiresAt: string;
	} | null;
}

const base: ActionResult = { actionError: null, message: null, needsFunds: false, qr: null };

const ok = (message: string): ActionResult => ({ ...base, message });
const problem = (actionError: string, needsFunds = false): ActionResult => ({
	...base,
	actionError,
	needsFunds
});

/** What both QR functions return. */
interface IssuedQr {
	token: string;
	path: string;
	expires_at: string;
}

/**
 * Issues a QR and renders it, for whichever of the two codes is asked for.
 *
 * THE ABSOLUTE URL IS BUILT HERE, from the request's own origin. The function
 * returns a relative path deliberately: a URL hardcoded in the Edge Function
 * would point a preview deployment's QR at production, and someone would scan
 * it before anyone noticed.
 */
async function issueQr(
	locals: App.Locals,
	functionName: 'create_commitment_qr' | 'create_payment_qr',
	purpose: 'meetup_verification' | 'purchase',
	commitmentId: string,
	origin: string
) {
	const result = await invokeFunction<IssuedQr>(locals.supabase, functionName, {
		commitment_id: commitmentId
	});

	if (!result.ok) {
		return fail(409, problem(result.error.message));
	}

	const absolute = `${origin}${result.data.path}`;

	return {
		...base,
		qr: {
			purpose,
			url: absolute,

			/**
			 * Null when the code could not be drawn. The token is real either way,
			 * so the page falls back to showing the link rather than reporting a
			 * failure for something that worked.
			 */
			svg: await renderQrSvg(absolute),
			expiresAt: result.data.expires_at
		}
	};
}

export const actions: Actions = {
	/**
	 * The seller agrees. Delegated to `respond_to_commitment`, which takes the
	 * seller's stake before activating the commitment.
	 *
	 * This file does not change the status itself. Only the Edge Function can
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
			const needsFunds =
				result.error.code === 'INSUFFICIENT_FUNDS' || result.error.code === 'WALLET_NOT_FOUND';

			return fail(needsFunds ? 402 : 409, problem(result.error.message, needsFunds));
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

		if (!result.ok) return fail(409, problem(result.error.message));

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

		if (!isBuyer) return fail(403, problem('Only the buyer can withdraw a request.'));
		if (commitment.status !== 'pending') return fail(409, problem('This request is no longer open.'));

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
	 * Delegated to `cancel_commitment`, which forfeits the canceller's stake and
	 * refunds the other participant. Nothing about the status is changed here:
	 * the state and the settlements have to move together, and only the function
	 * can do the second half.
	 */
	cancel: async ({ locals, params, url }) => {
		requireUser(await locals.getVerifiedUser(), url.pathname);

		const result = await invokeFunction<{
			cancelled_by: 'buyer' | 'seller';
			refunded: boolean;
			forfeited: boolean;
			message: string;
		}>(locals.supabase, 'cancel_commitment', { commitment_id: params.commitment_id });

		if (!result.ok) return fail(409, problem(result.error.message));

		return ok(result.data.message);
	},

	/**
	 * "I am here."
	 *
	 * The coordinates come from the browser's Geolocation API and are filled
	 * into hidden fields before the form submits — which is why this action
	 * needs JavaScript, and says so in the UI. There is no server-side way to
	 * learn where a phone is.
	 *
	 * The position is NOT trusted here. `check_in` compares it against the
	 * agreed location and refuses anything outside the configured radius; this
	 * action only carries it across.
	 */
	checkIn: async ({ locals, params, request, url }) => {
		requireUser(await locals.getVerifiedUser(), url.pathname);

		const data = await request.formData();
		const latitude = Number(data.get('latitude'));
		const longitude = Number(data.get('longitude'));

		/**
		 * `Number('')` is 0, and (0, 0) is a real place in the Gulf of Guinea —
		 * so an empty field would otherwise submit as a position rather than as
		 * a missing one, and be reported as "you are 11,000km away".
		 */
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
			return fail(
				400,
				problem('Your location could not be read. Allow location access and try again.')
			);
		}

		const result = await invokeFunction<{
			both_checked_in: boolean;
			already_checked_in: boolean;
			other_checked_in_at: string | null;
			deadline: string | null;
			distance_metres?: number;
		}>(locals.supabase, 'check_in', {
			commitment_id: params.commitment_id,
			latitude,
			longitude
		});

		if (!result.ok) return fail(409, problem(result.error.message));

		if (result.data.already_checked_in) {
			return ok('You were already checked in.');
		}

		return ok(
			result.data.both_checked_in
				? 'Checked in. You are both here — the seller can now show the verification code.'
				: 'Checked in. Waiting for the other person to arrive.'
		);
	},

	/**
	 * The seller shows QR #1, which the buyer scans to verify the meetup.
	 *
	 * Issuing a new code revokes the previous one, so this doubles as the
	 * refresh action — there is no state in which two codes are live.
	 */
	showMeetupQr: async ({ locals, params, url }) => {
		requireUser(await locals.getVerifiedUser(), url.pathname);

		return await issueQr(
			locals,
			'create_commitment_qr',
			'meetup_verification',
			params.commitment_id,
			url.origin
		);
	},

	/**
	 * The seller shows QR #2, for the optional purchase.
	 *
	 * Only possible once the meetup is verified. The buyer is under no
	 * obligation to scan it.
	 */
	showPaymentQr: async ({ locals, params, url }) => {
		requireUser(await locals.getVerifiedUser(), url.pathname);

		return await issueQr(
			locals,
			'create_payment_qr',
			'purchase',
			params.commitment_id,
			url.origin
		);
	}
};
