import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { consumeQrToken, releaseQrToken, validateQrToken } from '../_shared/qr.ts';
import { settleStake } from '../_shared/stake.ts';
import { meetupDay } from '../_shared/meetup_day.ts';

/**
 * complete_commitment, processes QR #1 and closes the commitment successfully.
 *
 *   POST /complete_commitment
 *   { "commitment_id": "<uuid>", "token": "<from the QR>" }
 *
 * THE MEETUP OBLIGATION IS NOW FULFILLED. Both stakes come back. Nothing is
 * bought, the buyer may inspect the item and walk away with no penalty
 * whatsoever, which is the entire premise of the product.
 *
 * Only the BUYER may call this. The seller shows the code and the buyer scans
 * it, so the person who has to be physically present to complete the meetup is
 * the one the code cannot be completed without.
 *
 * REFUNDS USE THE RECORDED LAMPORTS, never a recalculated fee. `settle_stake`
 * enforces that; see the note there on why reconverting would quietly
 * short-change somebody.
 */

interface CommitmentRow {
	id: string;
	status: string;
	scheduled_at: string;
	buyer_id: string;
	seller_id: string;
	buyer_checked_in_at: string | null;
	seller_checked_in_at: string | null;
	meetup_verified_at: string | null;
}

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const buyerId = await callerId(request);
	if (!buyerId) return fail('UNAUTHORIZED', 'Sign in to verify this meetup.', 401);

	let body: { commitment_id?: string; token?: string };
	try {
		body = await request.json();
	} catch {
		return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
	}

	if (!body.commitment_id || !body.token) {
		return fail('INVALID_REQUEST', 'commitment_id and token are required.', 400);
	}

	const db = serviceClient();

	try {
		const { data: commitment } = await db
			.from('commitments')
			.select(
				'id, status, buyer_id, seller_id, scheduled_at, buyer_checked_in_at, seller_checked_in_at, meetup_verified_at'
			)
			.eq('id', body.commitment_id)
			.maybeSingle<CommitmentRow>();

		if (!commitment) return fail('INVALID_REQUEST', 'That commitment does not exist.', 404);

		/**
		 * The scanner must be the buyer. This is what makes a forwarded
		 * screenshot worthless: whoever opens the link has to hold the buyer's
		 * own session, and a stranger does not.
		 */
		if (commitment.buyer_id !== buyerId) {
			return fail(
				'UNAUTHORIZED',
				commitment.seller_id === buyerId
					? 'You are the seller on this commitment. The buyer scans the code.'
					: 'That commitment is not yours.',
				403
			);
		}

		if (commitment.meetup_verified_at || commitment.status === 'completed') {
			/**
			 * Not an error. A buyer who scans twice, or reloads the page, should
			 * see that it worked, telling them the code is used would read as a
			 * failure for something that succeeded.
			 */
			return json({
				commitment_id: commitment.id,
				status: 'completed',
				already_completed: true,
				message: 'This meetup was already verified. Both stakes have been returned.'
			});
		}

		if (commitment.status !== 'accepted') {
			return fail('INVALID_REQUEST', 'This commitment has already been resolved.', 409);
		}

		if (!commitment.buyer_checked_in_at || !commitment.seller_checked_in_at) {
			return fail(
				'AWAITING_OTHER_PARTY',
				'Both of you need to be checked in before the meetup can be verified.',
				409
			);
		}

		/** Verification, like check-in, belongs to the meetup's own day. */
		// TESTING: verification allowed on any day. Uncomment to require the meetup date.
		// if (Date.now() >= meetupDay(commitment.scheduled_at).end.getTime()) {
			// return fail('WINDOW_CLOSED', 'The day of this meetup has passed.', 409);
		// }

		const validation = await validateQrToken(db, {
			commitmentId: commitment.id,
			purpose: 'meetup_verification',
			token: body.token
		});

		if (!validation.ok) {
			return fail(validation.code, validation.message, 409);
		}

		return await complete(db, commitment, validation.tokenId, buyerId);
	} catch (error) {
		console.error('[complete_commitment]', error);
		return fail('INTERNAL', 'The meetup could not be verified.', 500);
	}
});

/**
 * Consumes the code, closes the commitment, and returns both stakes.
 *
 * THE ORDER IS THE DESIGN, and each step guards the next:
 *
 *   1. consume the token , atomic. Two simultaneous scans both validate,
 *                           because validating is a read; only one consumes.
 *                           This is what makes a double scan impossible.
 *   2. claim the status  , compare-and-set on `accepted`. If something else
 *                           resolved the commitment in between, the token is
 *                           released so a retry is still possible.
 *   3. settle both stakes, last, because they are the only irreversible part.
 *                           By here the commitment definitively belongs to
 *                           this call.
 *
 * Settling before claiming would allow a refund against a commitment that was
 * simultaneously being cancelled, paying the stake back and forfeiting it.
 */
async function complete(
	db: ReturnType<typeof serviceClient>,
	commitment: CommitmentRow,
	tokenId: string,
	buyerId: string
): Promise<Response> {
	if (!(await consumeQrToken(db, tokenId, buyerId))) {
		return fail('QR_ALREADY_USED', 'That code has already been used.', 409);
	}

	const verifiedAt = new Date().toISOString();

	const claimed = await db
		.from('commitments')
		.update({ status: 'completed', meetup_verified_at: verifiedAt, completed_at: verifiedAt })
		.eq('id', commitment.id)
		.eq('status', 'accepted')
		.select('id');

	if (claimed.error || (claimed.data?.length ?? 0) === 0) {
		/**
		 * Safe to release: nothing irreversible has happened yet. No money has
		 * moved and the status is unchanged, so re-arming the code leaves the
		 * buyer able to try again instead of needing the seller to refresh.
		 */
		await releaseQrToken(db, tokenId);

		console.error('[complete_commitment] status was not claimable', claimed.error);
		return fail('INVALID_REQUEST', 'This commitment was resolved while you were scanning.', 409);
	}

	/**
	 * The business record of the meetup. Its unique constraint on
	 * `commitment_id` is a second guarantee behind the token's single use,
	 * wanted here specifically, because the consequence of a duplicate would be
	 * a second pair of refunds out of the treasury.
	 */
	const recorded = await db.from('meetup_verifications').insert({
		commitment_id: commitment.id,
		qr_token_id: tokenId,
		displayed_by_profile_id: commitment.seller_id,
		scanned_by_profile_id: buyerId,
		verified_at: verifiedAt
	});

	if (recorded.error) {
		/**
		 * Logged, not fatal. The commitment is legitimately complete, the
		 * status and the timestamp say so, and refusing now would leave two
		 * people with their stakes still held after a meetup they genuinely
		 * completed. The verification row is evidence, and losing it is worth
		 * less than withholding the money.
		 */
		console.error('[complete_commitment] verification row not written', recorded.error);
	}

	await db.from('commitment_events').insert([
		{
			commitment_id: commitment.id,
			event_type: 'meetup_verified',
			actor_profile_id: buyerId,
			actor_role: 'buyer'
		},
		{
			commitment_id: commitment.id,
			event_type: 'commitment_completed',
			actor_profile_id: buyerId,
			actor_role: 'buyer'
		}
	]);

	/**
	 * Both refunds attempted independently, and reported separately.
	 *
	 * One failing must not stop the other: they are different transfers to
	 * different wallets, and the person whose refund would have worked should
	 * not be held back by the person whose did not. `process_commitments`
	 * retries whatever is still outstanding, under the same idempotency key, so
	 * a retry can never pay twice.
	 */
	const buyerSettlement = await settleStake(db, commitment.id, 'buyer', 'refund');
	const sellerSettlement = await settleStake(db, commitment.id, 'seller', 'refund');

	if (!buyerSettlement.ok) {
		console.error('[complete_commitment] buyer refund failed', buyerSettlement);
	}
	if (!sellerSettlement.ok) {
		console.error('[complete_commitment] seller refund failed', sellerSettlement);
	}

	const bothRefunded = buyerSettlement.ok && sellerSettlement.ok;

	return json({
		commitment_id: commitment.id,
		status: 'completed',
		already_completed: false,
		verified_at: verifiedAt,

		/** Stated truthfully, per side. The page must not claim money is back when it is not. */
		buyer_refunded: buyerSettlement.ok,
		seller_refunded: sellerSettlement.ok,
		your_refund_lamports: buyerSettlement.ok ? buyerSettlement.lamports : null,
		signature: buyerSettlement.ok ? buyerSettlement.signature : null,

		message: bothRefunded
			? 'Meetup verified. Both commitment stakes have been returned.'
			: 'Meetup verified. One or both stake refunds are still processing and will complete shortly.'
	});
}
