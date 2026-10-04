import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { logStep, recordOutcome } from '../_shared/outcome.ts';
import { settleStake, type Party } from '../_shared/stake.ts';

/**
 * cancel_commitment, either party backs out after acceptance.
 *
 *   POST /cancel_commitment   { "commitment_id": "<uuid>" }
 *
 * The one action that costs somebody money. Whoever cancels forfeits their own
 * stake to the charity; the other participant gets theirs back in full.
 *
 * Who is cancelling comes from the JWT, never the body. A browser cannot
 * nominate the other person as the one who backed out.
 */

interface CommitmentRow {
	id: string;
	status: string;
	buyer_id: string;
	seller_id: string;
	buyer_stake_lamports: number | null;
	seller_stake_lamports: number | null;
}

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const actorId = await callerId(request);
	if (!actorId) return fail('UNAUTHORIZED', 'Sign in to cancel.', 401);

	let body: { commitment_id?: string };
	try {
		body = await request.json();
	} catch {
		return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
	}

	const commitmentId = body.commitment_id;
	if (!commitmentId) return fail('INVALID_REQUEST', 'commitment_id is required.', 400);

	const db = serviceClient();

	try {
		const { data: commitment } = await db
			.from('commitments')
			.select('id, status, buyer_id, seller_id, buyer_stake_lamports, seller_stake_lamports')
			.eq('id', commitmentId)
			.maybeSingle<CommitmentRow>();

		if (!commitment) return fail('INVALID_REQUEST', 'That commitment does not exist.', 404);

		const isBuyer = commitment.buyer_id === actorId;
		const isSeller = commitment.seller_id === actorId;

		if (!isBuyer && !isSeller) {
			return fail('UNAUTHORIZED', 'That commitment is not yours.', 403);
		}

		/**
		 * Only an accepted commitment can be cancelled. Before acceptance there
		 * is nothing to back out of, the seller declines and the buyer
		 * withdraws, and neither costs anything. After resolution there is
		 * nothing left to cancel.
		 */
		if (commitment.status !== 'accepted') {
			return fail('INVALID_REQUEST', 'Only an accepted commitment can be cancelled.', 409);
		}

		const canceller: Party = isBuyer ? 'buyer' : 'seller';
		const other: Party = isBuyer ? 'seller' : 'buyer';

		/**
		 * The status changes FIRST, as a compare-and-set on `accepted`.
		 *
		 * This is what makes a double cancellation impossible: two concurrent
		 * requests both reach here, only one finds the row still accepted, and
		 * only that one goes on to settle. Settling first and updating after
		 * would let both callers reach the transfers, and although the
		 * idempotency keys would stop a duplicate payment, the second caller
		 * would be told it had cancelled something it had not.
		 */
		const claimed = await db
			.from('commitments')
			.update({
				status: 'cancelled',
				responsible_party: canceller,
				cancelled_at: new Date().toISOString()
			})
			.eq('id', commitmentId)
			.eq('status', 'accepted')
			.select('id');

		if (claimed.error || (claimed.data?.length ?? 0) === 0) {
			return fail('INVALID_REQUEST', 'This commitment has already been resolved.', 409);
		}

		/**
		 * The status claim above is what makes this run once: a second
		 * cancellation finds the row no longer `accepted` and returns before
		 * reaching here, so the counter cannot increment twice.
		 */
		logStep('cancel_commitment', 'core-complete', { commitmentId, canceller });

		const outcome = await recordOutcome(db, 'cancel_commitment', {
			commitmentId,
			eventType: isBuyer ? 'buyer_cancelled' : 'seller_cancelled',
			actorId,
			actorRole: canceller
		});

		if (outcome.failedAt) {
			console.error('[cancel_commitment] derived update failed', outcome);
		}

		/**
		 * The innocent party is refunded first.
		 *
		 * Order matters if only one of the two settlements can complete: the
		 * person who did nothing wrong should be made whole before the platform
		 * collects anything for the charity. A forfeit that has not yet landed
		 * is money still sitting in the treasury, which is recoverable; an
		 * unpaid refund is a user out of pocket.
		 */
		const refund = await settleStake(db, commitmentId, other, 'refund');
		const forfeit = await settleStake(db, commitmentId, canceller, 'forfeit');

		if (!refund.ok) {
			console.error('[cancel_commitment] refund failed', refund);
		}
		if (!forfeit.ok) {
			console.error('[cancel_commitment] forfeit failed', forfeit);
		}

		return json({
			commitment_id: commitmentId,
			status: 'cancelled',
			cancelled_by: canceller,
			/**
			 * Reported separately and truthfully. The cancellation itself has
			 * happened either way, but telling someone their stake was returned
			 * when the transfer failed is a claim they could only disprove by
			 * checking their balance.
			 */
			refunded: refund.ok,
			refund_lamports: refund.ok ? refund.lamports : null,
			forfeited: forfeit.ok,
			forfeit_lamports: forfeit.ok ? forfeit.lamports : null,
			message:
				refund.ok && forfeit.ok
					? 'Cancelled. The other participant has been refunded and your stake went to charity.'
					: 'Cancelled. Some settlement is still processing and will be retried automatically.'
		});
	} catch (error) {
		console.error('[cancel_commitment]', error);
		return fail('INTERNAL', 'The cancellation could not be completed.', 500);
	}
});
