import { PUBLIC_SOLANA_RPC_URL } from '$app/env/public';

/**
 * Reading a Solana balance from the SvelteKit server.
 *
 * WHY NOT `@solana/web3.js`
 * ------------------------
 * The SDK is a dependency of the Edge Functions, where it belongs, they are
 * the only code that constructs or signs a transaction. Pulling it into this
 * app to read one number would add a sizeable package, and its Node built-in
 * requirements, to the deployment for a single JSON-RPC call this file makes
 * in fifteen lines.
 *
 * Signing stays out of here deliberately. The private keys are encrypted with
 * a secret held only by the Edge Function runtime, so this process cannot
 * decrypt them even if something here tried.
 *
 * WHERE THIS IS USED
 * ------------------
 * Only for wallets that have no owner and therefore no `query_wallet`
 * equivalent: the Main Wallet and the charity wallets, both shown on /admin. A
 * user's own balance goes through `query_wallet`, which also returns the
 * conversion and the network.
 */

/**
 * Lamport balance of an address, or null when Solana could not be reached.
 *
 * NULL IS NOT ZERO, and the distinction matters enough to be in the return
 * type rather than in a comment. "The treasury holds nothing" and "we could
 * not ask" lead to opposite decisions, and an RPC failure collapsed into zero
 * would tell an operator their treasury had been emptied.
 */
export async function getBalanceLamports(address: string): Promise<number | null> {
	try {
		const response = await fetch(PUBLIC_SOLANA_RPC_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'getBalance',
				params: [address, { commitment: 'confirmed' }]
			}),

			/**
			 * The public devnet endpoint is rate-limited and sometimes slow. An
			 * admin page should render with a balance marked unavailable rather
			 * than hang.
			 */
			signal: AbortSignal.timeout(6_000)
		});

		if (!response.ok) return null;

		const payload = (await response.json()) as {
			result?: { value?: unknown };
			error?: { message?: string };
		};

		if (payload.error) {
			console.error('[solana] getBalance returned an error', payload.error);
			return null;
		}

		const value = payload.result?.value;

		return typeof value === 'number' && Number.isFinite(value) ? value : null;
	} catch (cause) {
		console.error('[solana] getBalance failed', cause);
		return null;
	}
}

/** Reads several balances at once. One slow address must not serialise the rest. */
export async function getBalances(
	addresses: readonly string[]
): Promise<Record<string, number | null>> {
	const results = await Promise.all(
		addresses.map(async (address) => [address, await getBalanceLamports(address)] as const)
	);

	return Object.fromEntries(results);
}
