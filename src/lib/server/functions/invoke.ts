import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Calling Edge Functions from the server.
 *
 * Always through the REQUEST-SCOPED client, never the admin one. The function
 * reads the caller's identity from the JWT it receives, so invoking with the
 * user's own client is what makes "whose wallet is this" answerable at all —
 * and it means a function can never be tricked into acting for someone else by
 * a value in the request body.
 */

/** The failure shape every wallet function returns. */
export interface FunctionError {
	readonly code: string;
	readonly message: string;
}

export type FunctionResult<T> =
	| { readonly ok: true; readonly data: T }
	| { readonly ok: false; readonly error: FunctionError };

/**
 * Invokes an Edge Function and normalises both success and failure.
 *
 * The Supabase client reports a non-2xx response as a thrown-style error whose
 * body has to be read separately, which means the function's own error code —
 * the only part worth branching on — is buried. This unwraps it so callers get
 * `{ ok: false, error: { code, message } }` whatever went wrong.
 *
 * @param supabase The request-scoped client, i.e. `event.locals.supabase`.
 * @param name     Function name as deployed.
 * @param body     JSON payload.
 */
export async function invokeFunction<T>(
	supabase: SupabaseClient,
	name: string,
	body: Record<string, unknown> = {}
): Promise<FunctionResult<T>> {
	const { data, error } = await supabase.functions.invoke(name, { body });

	if (!error) {
		return { ok: true, data: data as T };
	}

	/**
	 * A non-2xx response carries the real error in its body. `context` is the
	 * underlying Response; reading it is the only way to recover the code the
	 * function deliberately returned.
	 */
	const context = (error as { context?: Response }).context;

	if (context && typeof context.json === 'function') {
		try {
			const payload = (await context.json()) as { error?: FunctionError };

			if (payload?.error?.code) {
				return { ok: false, error: payload.error };
			}
		} catch {
			/**
			 * Body was not JSON — a gateway error page, a timeout. Falls through
			 * to the generic case below rather than masking the failure.
			 */
		}
	}

	console.error(`[invoke:${name}]`, error);

	return {
		ok: false,
		error: {
			code: 'FUNCTION_UNAVAILABLE',
			message: 'That service is temporarily unavailable. Please try again.'
		}
	};
}

/** What `query_wallet` returns on success. */
export interface WalletState {
	readonly wallet_id: string;
	readonly solana_address: string;
	readonly lamports: number;
	readonly sol: number;
	readonly network: string;
	readonly sol_price_cents: number | null;
	readonly currency_code: string | null;
	readonly value_cents: number | null;
	readonly funded: boolean;
}

/** What `create_wallet` returns on success. */
export interface CreatedWallet {
	readonly created: boolean;
	readonly wallet_id: string;
	readonly solana_address: string;
}

/**
 * Reads the signed-in user's wallet.
 *
 * Returns `null` when they do not have one yet, which is a legitimate state
 * rather than an error — it means `create_wallet` has not run. Distinguishing
 * it from a real failure lets the UI offer to create one instead of showing a
 * problem the user cannot fix.
 */
export async function loadWallet(
	supabase: SupabaseClient
): Promise<{ wallet: WalletState | null; error: FunctionError | null }> {
	const result = await invokeFunction<WalletState>(supabase, 'query_wallet');

	if (result.ok) return { wallet: result.data, error: null };
	if (result.error.code === 'WALLET_NOT_FOUND') return { wallet: null, error: null };

	return { wallet: null, error: result.error };
}
