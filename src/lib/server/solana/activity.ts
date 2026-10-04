import { PUBLIC_SOLANA_RPC_URL } from '$app/env/public';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/supabase/database.types';

/**
 * A wallet's activity, read from Solana and labelled from kommitly's records.
 *
 * The chain is the source of truth for WHAT happened — it includes deposits,
 * which kommitly never sees arrive. The ledger (`wallet_transactions`) and
 * `payments` say WHY: a stake, a refund, a sale. A signature found in neither
 * is described by its effect on this wallet: money in is a deposit, money out
 * a send.
 */

export interface ActivityItem {
	readonly signature: string;
	/** When the chain recorded it, or null when the cluster does not say. */
	readonly at: string | null;
	readonly label: string;
	/** Signed change to this wallet: positive in, negative out. */
	readonly lamports: number;
	readonly failed: boolean;
	readonly commitmentId: string | null;
}

const OUT_LABELS: Record<string, string> = {
	commitment_lock: 'Commitment stake put down',
	purchase: 'Item purchase',
	withdrawal: 'Withdrawal',
	commitment_forfeit: 'Stake forfeited to charity'
};

const IN_LABELS: Record<string, string> = {
	commitment_refund: 'Commitment stake returned',
	deposit: 'Deposit',
	sale: 'Item sold',
	/** The same purchase row, seen from the receiving (seller's) side. */
	purchase: 'Item sold'
};

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
	try {
		const response = await fetch(PUBLIC_SOLANA_RPC_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			/** The public devnet endpoint is slow at times; the page must not hang on it. */
			signal: AbortSignal.timeout(8_000)
		});
		if (!response.ok) return null;
		const payload = (await response.json()) as { result?: T };
		return payload.result ?? null;
	} catch {
		return null;
	}
}

/** Net lamport change to `address` in one transaction, fees included. */
async function deltaFor(signature: string, address: string): Promise<number | null> {
	const tx = await rpc<{
		meta: { preBalances: number[]; postBalances: number[] } | null;
		transaction: { message: { accountKeys: (string | { pubkey: string })[] } };
	}>('getTransaction', [
		signature,
		{ encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }
	]);

	if (!tx?.meta) return null;

	const index = tx.transaction.message.accountKeys.findIndex(
		(key) => (typeof key === 'string' ? key : key.pubkey) === address
	);
	if (index < 0) return null;

	const before = tx.meta.preBalances[index];
	const after = tx.meta.postBalances[index];
	return before === undefined || after === undefined ? null : after - before;
}

/**
 * The most recent activity for this wallet, newest first.
 *
 * @returns null when Solana could not be reached — not an empty history.
 */
export async function loadWalletActivity(
	supabase: SupabaseClient<Database>,
	address: string,
	limit = 25
): Promise<ActivityItem[] | null> {
	const signatures = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>(
		'getSignaturesForAddress',
		[address, { limit, commitment: 'confirmed' }]
	);

	if (signatures === null) return null;
	if (signatures.length === 0) return [];

	const list = signatures.map((s) => s.signature);

	/**
	 * Both read through the user's own client. Row Level Security limits the
	 * ledger to their own wallet and `payments` to purchases they are party to.
	 */
	const [ledger, payments] = await Promise.all([
		supabase
			.from('wallet_transactions')
			.select('type, lamports, from_address, to_address, solana_signature, commitment_id')
			.in('solana_signature', list),
		supabase
			.from('payments')
			.select('solana_signature, amount_lamports, commitment_id')
			.eq('status', 'completed')
			.in('solana_signature', list)
	]);

	const ledgerBySignature = new Map((ledger.data ?? []).map((row) => [row.solana_signature, row]));
	const paymentBySignature = new Map((payments.data ?? []).map((row) => [row.solana_signature, row]));

	return Promise.all(
		signatures.map(async ({ signature, blockTime, err }): Promise<ActivityItem> => {
			const at = blockTime ? new Date(blockTime * 1000).toISOString() : null;
			const failed = err !== null && err !== undefined;
			const row = ledgerBySignature.get(signature);

			if (row) {
				const incoming = row.to_address === address;
				return {
					signature,
					at,
					failed,
					commitmentId: row.commitment_id,
					lamports: incoming ? row.lamports : -row.lamports,
					label:
						(incoming ? IN_LABELS[row.type] : OUT_LABELS[row.type]) ??
						(incoming ? 'Received' : 'Sent')
				};
			}

			/** A purchase the seller received: recorded on the buyer's ledger, not theirs. */
			const payment = paymentBySignature.get(signature);
			if (payment) {
				return {
					signature,
					at,
					failed,
					commitmentId: payment.commitment_id,
					lamports: payment.amount_lamports,
					label: 'Item sold'
				};
			}

			/** Not something kommitly did: describe it by its effect on this wallet. */
			const delta = (await deltaFor(signature, address)) ?? 0;
			return {
				signature,
				at,
				failed,
				commitmentId: null,
				lamports: delta,
				label: delta >= 0 ? 'Deposit' : 'Sent from this wallet'
			};
		})
	);
}
