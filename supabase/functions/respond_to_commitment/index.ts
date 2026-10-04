import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { getCommitmentStake, settleStake, stakeToLamports } from '../_shared/stake.ts';
import { transferFunds } from '../_shared/transfer.ts';
import { getPlatformWallet, getUserWallet } from '../_shared/wallets.ts';

/**
 * respond_to_commitment, the seller accepts or declines a pending request.
 *
 *   POST /respond_to_commitment
 *   { "commitment_id": "<uuid>", "action": "accept" | "decline" }
 *
 * ACCEPT takes the seller's stake BEFORE the commitment becomes active, so a
 * commitment is never "both parties committed" while only one has paid. If the
 * seller cannot afford it, acceptance simply does not happen: the buyer's stake
 * stays held against a request that is still pending, so they have lost nothing
 * and may still be accepted later or refunded on expiry.
 *
 * DECLINE takes nothing and refunds the buyer immediately. Declining promptly
 * is the good outcome and must cost the seller nothing.
 */

interface CommitmentRow {
	id: string;
	status: string;
	buyer_id: string;
	seller_id: string;
	request_expires_at: string;
	buyer_stake_lamports: number | null;
}

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const sellerId = await callerId(request);
	if (!sellerId) return fail('UNAUTHORIZED', 'Sign in to respond.', 401);

	let body: { commitment_id?: string; action?: string };
	try {
		body = await request.json();
	} catch {
		return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
	}

	const commitmentId = body.commitment_id;
	const action = body.action;

	if (!commitmentId || (action !== 'accept' && action !== 'decline')) {
		return fail('INVALID_REQUEST', 'commitment_id and an action of accept or decline are required.', 400);
	}

	const db = serviceClient();

	try {
		const { data: commitment } = await db
			.from('commitments')
			.select('id, status, buyer_id, seller_id, request_expires_at, buyer_stake_lamports')
			.eq('id', commitmentId)
			.maybeSingle<CommitmentRow>();

		if (!commitment) return fail('INVALID_REQUEST', 'That commitment does not exist.', 404);

		if (commitment.seller_id !== sellerId) {
			return fail('UNAUTHORIZED', 'Only the seller can respond to this request.', 403);
		}

		/** Guards double acceptance and double decline alike. */
		if (commitment.status !== 'pending') {
			return fail('INVALID_REQUEST', 'This request has already been resolved.', 409);
		}

		if (new Date(commitment.request_expires_at) <= new Date()) {
			return fail('INVALID_REQUEST', 'This request has expired. The buyer will need to send a new one.', 409);
		}

		/**
		 * The buyer's stake must already be held. A pending request without one
		 * should not exist, request_commitment removes any whose transfer failed
		 *, so this is a consistency check rather than an expected path.
		 * Accepting against it would commit a seller with nothing on the other
		 * side.
		 */
		if (!commitment.buyer_stake_lamports) {
			return fail('INVALID_REQUEST', 'The buyer has not funded this request.', 409);
		}

		if (action === 'decline') {
			await db
				.from('commitments')
				.update({ status: 'declined', declined_at: new Date().toISOString() })
				.eq('id', commitmentId)
				.eq('status', 'pending');

			await db.from('commitment_events').insert({
				commitment_id: commitmentId,
				event_type: 'seller_declined',
				actor_profile_id: sellerId,
				actor_role: 'seller'
			});

			/** The buyer's held stake comes straight back. Declining costs nobody. */
			const settled = await settleStake(db, commitmentId, 'buyer', 'refund');

			if (!settled.ok) {
				/**
				 * The decline stands, the seller answered, the request is closed,
				 * but the refund has not landed. Reported honestly rather than
				 * claiming the money is back, so the scheduled resolver can retry it
				 * under the same idempotency key without double-paying.
				 */
				console.error('[respond_to_commitment] refund failed after decline', settled);

				return json({
					commitment_id: commitmentId,
					status: 'declined',
					refunded: false,
					message: 'Declined. The refund did not complete and will be retried automatically.'
				});
			}

			return json({
				commitment_id: commitmentId,
				status: 'declined',
				refunded: true,
				refund_lamports: settled.lamports,
				signature: settled.signature
			});
		}

		return await accept(db, commitmentId, sellerId);
	} catch (error) {
		console.error('[respond_to_commitment]', error);
		return fail('INTERNAL', 'The response could not be completed.', 500);
	}
});

/**
 * The seller agrees, and pays their stake to do it.
 */
async function accept(
	db: ReturnType<typeof serviceClient>,
	commitmentId: string,
	sellerId: string
): Promise<Response> {
	const sellerWallet = await getUserWallet(db, sellerId);
	if (!sellerWallet) {
		return fail('WALLET_NOT_FOUND', 'You need a wallet before you can accept. Set one up first.', 404);
	}

	const platform = await getPlatformWallet(db);
	if (!platform) return fail('INTERNAL', 'The Main Wallet has not been set up.', 503);

	const stakeCents = await getCommitmentStake(db, sellerId, 'seller');
	if (stakeCents === null) return fail('INTERNAL', 'Market settings are missing.', 500);

	const stakeLamports = await stakeToLamports(db, stakeCents);
	if (stakeLamports === null) return fail('INTERNAL', 'Market settings are missing.', 500);

	/**
	 * The stake moves BEFORE the status changes.
	 *
	 * If the transfer fails, the commitment stays pending and the buyer's stake
	 * stays held, a recoverable state the seller can retry from. The reverse
	 * order would produce an active commitment that only one party had paid
	 * into, and there is no safe way back from that: the buyer would be exposed
	 * to a no-show penalty against a seller with nothing at risk.
	 */
	const transfer = await transferFunds(db, {
		fromSecretEncrypted: sellerWallet.secretEncrypted,
		fromAddress: sellerWallet.address,
		toAddress: platform.address,
		lamports: stakeLamports,
		type: 'commitment_lock',
		walletId: sellerWallet.id,
		commitmentId,
		idempotencyKey: `commitment:${commitmentId}:seller:lock`
	});

	if (!transfer.ok) {
		return fail(
			transfer.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'INTERNAL',
			transfer.message,
			transfer.code === 'INSUFFICIENT_FUNDS' ? 402 : 502,
			{ required_lamports: stakeLamports, required_cents: stakeCents }
		);
	}

	/**
	 * `.eq('status', 'pending')` makes this a compare-and-set. Two concurrent
	 * acceptances both transfer under the same idempotency key, so only one
	 * payment occurs, and only one of them finds the row still pending.
	 */
	const accepted = await db
		.from('commitments')
		.update({
			status: 'accepted',
			accepted_at: new Date().toISOString(),
			seller_stake_cents: stakeCents,
			seller_stake_lamports: transfer.lamports
		})
		.eq('id', commitmentId)
		.eq('status', 'pending')
		.select('id');

	if (accepted.error || (accepted.data?.length ?? 0) === 0) {
		/**
		 * The money moved but the state did not. Deliberately NOT rolled back
		 * here: a refund is itself a transfer that can fail, and attempting one
		 * inside an already-failing path is how money gets moved twice. The
		 * seller's lock is recorded against this commitment with its own
		 * idempotency key, so it can be settled deliberately rather than guessed
		 * at now.
		 */
		console.error('[respond_to_commitment] transfer succeeded but status did not change', accepted.error);

		return fail(
			'INTERNAL',
			'Your stake was taken but the commitment could not be activated. This has been recorded and will be resolved.',
			500
		);
	}

	await db.from('commitment_events').insert({
		commitment_id: commitmentId,
		event_type: 'seller_accepted',
		actor_profile_id: sellerId,
		actor_role: 'seller'
	});

	return json({
		commitment_id: commitmentId,
		status: 'accepted',
		stake_cents: stakeCents,
		stake_lamports: transfer.lamports,
		signature: transfer.signature,
		explorer: transfer.explorer
	});
}
