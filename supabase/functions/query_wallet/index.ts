import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { LAMPORTS_PER_SOL, getBalanceLamports } from '../_shared/solana.ts';

/**
 * query_wallet — the live state of a wallet.
 *
 *   POST /query_wallet   {}        // the caller's own wallet
 *
 * Response:
 *   {
 *     "wallet_id": "<uuid>",
 *     "solana_address": "<base58>",
 *     "lamports": 1500000000,
 *     "sol": 1.5,
 *     "funded": true
 *   }
 *
 * THE BALANCE IS READ FROM SOLANA EVERY TIME, never from the database.
 *
 * That is the whole point of this function. A stored balance is a second
 * source of truth, and it diverges the first time anything moves on-chain that
 * the app did not initiate — a direct deposit from Solflare, for instance,
 * which is exactly how users are told to fund their wallet. Reading the chain
 * means the number shown is the number that exists.
 *
 * The cost is a network call per view. That is the right trade: showing
 * someone a stale balance for their own money is worse than showing it a few
 * hundred milliseconds later.
 */

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	/**
	 * Whose wallet is decided by the JWT, never by the request body. There is
	 * deliberately no way to ask for someone else's balance: a Solana address
	 * and its holdings are precisely the kind of payment detail the product
	 * promises never to leak between users.
	 */
	const profileId = await callerId(request);

	if (!profileId) {
		return fail('UNAUTHORIZED', 'Sign in to view your wallet.', 401);
	}

	const db = serviceClient();

	const { data: wallet, error } = await db
		.from('wallets')
		.select('id, solana_address')
		.eq('profile_id', profileId)
		.maybeSingle<{ id: string; solana_address: string }>();

	if (error) {
		console.error('[query_wallet] lookup failed', error);
		return fail('INTERNAL', 'The wallet could not be read.', 500);
	}

	if (!wallet) {
		/**
		 * Distinct from a zero balance, and the caller needs the difference: no
		 * wallet means create_wallet has not run, while zero means it has and
		 * the user needs to add funds.
		 */
		return fail('WALLET_NOT_FOUND', 'You do not have a wallet yet.', 404);
	}

	let lamports: number;
	try {
		lamports = await getBalanceLamports(wallet.solana_address);
	} catch (cause) {
		/**
		 * The RPC endpoint being unreachable is a temporary condition, and the
		 * caller may retry. Reported as 503 rather than 500 so it is
		 * distinguishable from a real fault, and never as a balance of zero —
		 * telling someone their money is gone because a network call failed
		 * would be the worst possible answer.
		 */
		console.error('[query_wallet] rpc failed', cause);
		return fail('CHAIN_UNAVAILABLE', 'Solana could not be reached. Try again shortly.', 503);
	}

	return json({
		wallet_id: wallet.id,
		solana_address: wallet.solana_address,
		lamports,
		sol: lamports / LAMPORTS_PER_SOL,
		/** Lets the UI choose between "add funds" and showing a balance. */
		funded: lamports > 0
	});
});
