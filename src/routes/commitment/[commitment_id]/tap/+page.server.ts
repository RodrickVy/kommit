import { error, fail } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards';
import { invokeFunction } from '#lib/server/functions/invoke';
import type { Actions, PageServerLoad } from './$types';

/**
 * Meetup verification — `/commitment/[commitment_id]/tap`.
 *
 * The destination encoded in QR #1. The buyer's phone camera opens it, the
 * page checks who they are, and completion is a POST they make deliberately.
 *
 * NOTHING HAPPENS ON LOAD. The token travels in the query string, so anything
 * done here would also be done by whatever else follows a link — a chat app
 * generating a preview, a security scanner, the browser prefetching. A GET
 * must stay safe to repeat.
 *
 * WHY THE TOKEN IS IN A URL AT ALL
 * --------------------------------
 * Because the transport is a camera. There is no other way to hand a value
 * from one phone's screen to another's. What makes it acceptable is that the
 * token is not authorisation on its own: `complete_commitment` independently
 * requires the caller to hold the buyer's session, so a forwarded screenshot
 * is worthless. The token is short-lived, single-use, and stored only as a
 * hash.
 */

/** The three shapes this page renders. Decided here so the template has no logic. */
type Outcome = 'ready' | 'completed' | 'blocked';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	/**
	 * `pathname + search` so signing in returns the buyer to this page WITH the
	 * token. Without the query they would come back to a verification page that
	 * had forgotten which code they scanned, and the seller would have to
	 * refresh it.
	 */
	const user = requireUser(await locals.getVerifiedUser(), `${url.pathname}${url.search}`);

	const token = url.searchParams.get('t') ?? '';

	const { data: commitment } = await locals.supabase
		.from('commitments')
		.select(
			'id, status, buyer_id, seller_id, buyer_stake_cents, seller_stake_cents, buyer_checked_in_at, seller_checked_in_at, meetup_verified_at, listings(title, price_cents)'
		)
		.eq('id', params.commitment_id)
		.maybeSingle();

	/**
	 * RLS hides a commitment the viewer is not party to, so a stranger who
	 * scanned someone else's screen sees a plain 404 rather than confirmation
	 * that the commitment exists.
	 */
	if (!commitment) error(404, 'That commitment does not exist.');

	const isBuyer = commitment.buyer_id === user.id;

	/**
	 * Whether this viewer's own refund has actually landed.
	 *
	 * Read from the ledger rather than assumed from the status, because the two
	 * can legitimately disagree: completion and settlement are separate
	 * transfers, and `complete_commitment` reports a refund that has not landed
	 * instead of pretending otherwise. The scheduled resolver retries it.
	 *
	 * Scoped by RLS to the viewer's own wallet, which is exactly the right
	 * scope — a refund credits the wallet it returns to, so this answers "is my
	 * stake back" and says nothing about the other person's.
	 */
	const { data: refund } = await locals.supabase
		.from('wallet_transactions')
		.select('id')
		.eq('commitment_id', commitment.id)
		.eq('type', 'commitment_refund')
		.eq('status', 'completed')
		.limit(1)
		.maybeSingle();

	const base = {
		commitmentId: commitment.id,
		token,
		listingTitle: commitment.listings?.title ?? null,
		priceCents: commitment.listings?.price_cents ?? null,
		stakeCents: isBuyer ? commitment.buyer_stake_cents : commitment.seller_stake_cents,
		refundLanded: refund !== null
	};

	const blocked = (problemTitle: string, problem: string) => ({
		...base,
		outcome: 'blocked' as Outcome,
		problemTitle,
		problem
	});

	/**
	 * Already verified is reported as success, not as a problem. A buyer who
	 * scans twice, or reloads, should see that it worked.
	 */
	if (commitment.meetup_verified_at || commitment.status === 'completed') {
		return { ...base, outcome: 'completed' as Outcome, problemTitle: '', problem: '' };
	}

	if (!isBuyer) {
		return blocked(
			'The buyer scans this code',
			commitment.seller_id === user.id
				? 'You are the seller on this commitment — this is the code you show, not one you scan. Hand your phone to the buyer, or let them scan your screen.'
				: 'This code belongs to someone else’s commitment.'
		);
	}

	if (commitment.status !== 'accepted') {
		return blocked(
			'This commitment is closed',
			'It has already been resolved, so the meetup can no longer be verified.'
		);
	}

	if (!commitment.buyer_checked_in_at || !commitment.seller_checked_in_at) {
		return blocked(
			'Check in first',
			'Both of you need to check in at the meetup location before the meetup can be verified. Open the commitment and press Check in.'
		);
	}

	if (!token) {
		return blocked(
			'No code was scanned',
			'This page needs the code from the seller’s screen. Ask them to show it again and scan it with your camera.'
		);
	}

	return { ...base, outcome: 'ready' as Outcome, problemTitle: '', problem: '' };
};

export const actions: Actions = {
	/**
	 * Confirms the meetup happened, which returns both stakes.
	 *
	 * Every check is repeated inside `complete_commitment` — this action only
	 * carries the token across. The load's checks exist to explain things
	 * before the button is pressed, not to authorise it.
	 */
	complete: async ({ locals, params, request, url }) => {
		requireUser(await locals.getVerifiedUser(), `${url.pathname}${url.search}`);

		const data = await request.formData();
		const token = data.get('token');

		if (typeof token !== 'string' || !token) {
			return fail(400, {
				actionError: 'The code was missing. Ask the seller to show it again.'
			});
		}

		const result = await invokeFunction<{
			buyer_refunded: boolean;
			seller_refunded: boolean;
			message: string;
		}>(locals.supabase, 'complete_commitment', {
			commitment_id: params.commitment_id,
			token
		});

		if (!result.ok) {
			return fail(409, { actionError: result.error.message });
		}

		/**
		 * The load re-runs after an action, so it will now see
		 * `meetup_verified_at` and render the completed state. Nothing needs to
		 * be passed through except the error case above.
		 */
		return { actionError: null };
	}
};
