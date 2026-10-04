import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2.117.0';
import { checkCanSend, explorerUrl, parseAddress, sendLamports } from './solana.ts';

/**
 * `transfer_funds` from the function contracts — the central money-movement
 * function.
 *
 * Every flow that moves value goes through here: locking a stake, refunding
 * one, forfeiting one to a charity, paying for an item, withdrawing. Nothing
 * else in kommitly signs a transaction, so the balance check, the rent rule,
 * the confirmation wait and the record-keeping cannot drift apart between
 * callers.
 *
 * IDEMPOTENCY IS THE WHOLE POINT.
 * Network calls time out and get retried; a retried transfer without this
 * moves money twice, and money moved twice cannot be un-moved. The caller
 * supplies a key identifying the BUSINESS operation — "the buyer's stake for
 * commitment X" — not the attempt. Replaying with the same key returns the
 * original result and transfers nothing.
 */

export type TransferType =
	| 'deposit'
	| 'withdrawal'
	| 'commitment_lock'
	| 'commitment_refund'
	| 'commitment_forfeit'
	| 'purchase'
	| 'sale';

export interface TransferRequest {
	/** Encrypted key of the wallet the money leaves. */
	readonly fromSecretEncrypted: string;
	readonly fromAddress: string;
	readonly toAddress: string;
	readonly lamports: number;

	/** Why this moved, for the record. */
	readonly type: TransferType;

	/** The wallet row this belongs to, or null for the platform wallet. */
	readonly walletId: string | null;
	readonly commitmentId?: string | null;
	readonly charityId?: string | null;

	/**
	 * Identifies the business operation, not the attempt. Two retries of one
	 * stake share a key; two different stakes never do.
	 */
	readonly idempotencyKey: string;
}

export type TransferFailureCode =
	| 'INSUFFICIENT_FUNDS'
	| 'RENT_MINIMUM'
	| 'INVALID_REQUEST'
	| 'CHAIN_ERROR'
	| 'IN_FLIGHT';

export type TransferResult =
	| {
			readonly ok: true;
			readonly signature: string;
			readonly explorer: string;
			readonly lamports: number;
			/** True when an earlier result was returned rather than transferring. */
			readonly replayed: boolean;
	  }
	| { readonly ok: false; readonly code: TransferFailureCode; readonly message: string };

export async function transferFunds(
	db: SupabaseClient,
	request: TransferRequest
): Promise<TransferResult> {
	if (!Number.isInteger(request.lamports) || request.lamports <= 0) {
		return {
			ok: false,
			code: 'INVALID_REQUEST',
			message: 'Amount must be a positive whole number of lamports.'
		};
	}

	try {
		parseAddress(request.toAddress);
	} catch {
		return {
			ok: false,
			code: 'INVALID_REQUEST',
			message: 'The destination is not a valid Solana address.'
		};
	}

	/**
	 * A previous attempt under this key decides everything.
	 *
	 *   completed — return it; the money already moved.
	 *   pending   — an attempt is in flight, or died mid-transfer. Refuse rather
	 *               than send again: the first may yet confirm, and sending a
	 *               second is how money gets created from nothing.
	 *   failed    — the earlier attempt definitively moved nothing, so retrying
	 *               under the same key is safe.
	 */
	const prior = await db
		.from('wallet_transactions')
		.select('id, status, lamports, solana_signature')
		.eq('idempotency_key', request.idempotencyKey)
		.maybeSingle();

	if (prior.data?.status === 'completed' && prior.data.solana_signature) {
		return {
			ok: true,
			signature: prior.data.solana_signature,
			explorer: explorerUrl(prior.data.solana_signature),
			lamports: prior.data.lamports,
			replayed: true
		};
	}

	if (prior.data?.status === 'pending') {
		return {
			ok: false,
			code: 'IN_FLIGHT',
			message: 'That transfer is already being processed. Check back in a moment.'
		};
	}

	/** Pre-flight. The chain's own errors for these cases are unactionable. */
	const refusal = await checkCanSend(request.fromAddress, request.toAddress, request.lamports);
	if (refusal) {
		return { ok: false, code: refusal.code, message: refusal.message };
	}

	/**
	 * Claim the key BEFORE sending. The unique constraint settles a race between
	 * two concurrent attempts — only one insert wins, and the loser never
	 * reaches the chain.
	 */
	let transactionId: string;

	if (prior.data) {
		transactionId = prior.data.id;
		await db
			.from('wallet_transactions')
			.update({ status: 'pending', failure_reason: null })
			.eq('id', transactionId);
	} else {
		const claimed = await db
			.from('wallet_transactions')
			.insert({
				wallet_id: request.walletId,
				type: request.type,
				status: 'pending',
				lamports: request.lamports,
				from_address: request.fromAddress,
				to_address: request.toAddress,
				commitment_id: request.commitmentId ?? null,
				charity_id: request.charityId ?? null,
				idempotency_key: request.idempotencyKey
			})
			.select('id')
			.single();

		if (claimed.error) {
			/** Lost the race. The winner is in flight; do not send a second time. */
			if (claimed.error.code === '23505') {
				return {
					ok: false,
					code: 'IN_FLIGHT',
					message: 'That transfer is already being processed. Check back in a moment.'
				};
			}

			console.error('[transfer_funds] could not record transfer', claimed.error);
			return { ok: false, code: 'CHAIN_ERROR', message: 'The transfer could not be started.' };
		}

		transactionId = claimed.data.id;
	}

	try {
		const signature = await sendLamports(
			request.fromSecretEncrypted,
			request.toAddress,
			request.lamports
		);

		await db
			.from('wallet_transactions')
			.update({
				status: 'completed',
				solana_signature: signature,
				completed_at: new Date().toISOString()
			})
			.eq('id', transactionId);

		return {
			ok: true,
			signature,
			explorer: explorerUrl(signature),
			lamports: request.lamports,
			replayed: false
		};
	} catch (cause) {
		/**
		 * Marked failed so the same key may be retried. Correct only because
		 * `sendAndConfirmTransaction` throws on submission failure and on a
		 * confirmed on-chain error, and both mean nothing moved.
		 *
		 * A timeout while awaiting confirmation is the dangerous case, because
		 * the transaction may still land. Anything left `pending` must be
		 * reconciled against the chain rather than retried blindly.
		 */
		const reason = cause instanceof Error ? cause.message.slice(0, 400) : 'Unknown error';

		await db
			.from('wallet_transactions')
			.update({ status: 'failed', failure_reason: reason })
			.eq('id', transactionId);

		console.error('[transfer_funds] send failed', cause);

		return {
			ok: false,
			code: 'CHAIN_ERROR',
			message: 'Solana rejected the transfer. Nothing was moved — please try again.'
		};
	}
}
