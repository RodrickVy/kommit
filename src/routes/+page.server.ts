import {
	PUBLIC_SOLANA_NETWORK,
	PUBLIC_SUPABASE_ANON_KEY,
	PUBLIC_SUPABASE_URL
} from '$app/env/public';
import { loadWallet } from '#lib/server/functions/invoke';
import type { PageServerLoad } from './$types';

/**
 * Home page load.
 *
 * SCAFFOLDING — the probe below exists to prove the Supabase connection is
 * configured correctly end to end, and should be deleted once the home page
 * has real content to load. It is here rather than in the root layout
 * deliberately: it is one page's concern, and putting it in the layout would
 * make every route in the app pay for it on every request.
 */

/** Outcome of a single reachability check against the Supabase project. */
export interface SupabaseHealth {
	/** Whether the project answered successfully. */
	readonly reachable: boolean;
	/** A short, safe explanation suitable for display. Never contains a key. */
	readonly detail: string;
}

/**
 * How long to wait for the project before giving up.
 *
 * Short on purpose. This is a diagnostic, and the home page must not hang
 * behind it — an unreachable project should render as a warning in about
 * three seconds, not stall the response until the platform's own timeout.
 */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * Asks the Supabase Auth service whether it is alive.
 *
 * `/auth/v1/health` is the cheapest endpoint that proves the whole path
 * works: the URL is right, DNS and TLS succeed, and the anon key is accepted.
 * It touches no tables, so it is also the only check available before the
 * first migration exists.
 */
async function probeSupabase(): Promise<SupabaseHealth> {
	try {
		const response = await fetch(`${PUBLIC_SUPABASE_URL}/auth/v1/health`, {
			/**
			 * The anon key is required even by the health endpoint. It is
			 * public by design, so sending it here exposes nothing.
			 */
			headers: { apikey: PUBLIC_SUPABASE_ANON_KEY },

			/** Aborts the request rather than letting it hang. */
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
		});

		if (!response.ok) {
			/**
			 * Reached, but refused. The status code is the useful part: 401
			 * means the anon key is wrong, 404 means the URL points at
			 * something that is not a Supabase project.
			 */
			return {
				reachable: false,
				detail: `The project answered with HTTP ${response.status}.`
			};
		}

		return { reachable: true, detail: 'The project answered successfully.' };
	} catch (cause) {
		return { reachable: false, detail: describeProbeFailure(cause) };
	}
}

/**
 * Turns a thrown value into a message that is safe to render.
 *
 * The message is chosen from a fixed set rather than taken from the error
 * itself. An error raised deep inside the fetch stack can carry request
 * details, and this string is rendered into a public page — so nothing from
 * the exception is ever interpolated into it.
 *
 * @param cause The value thrown by `fetch`.
 */
function describeProbeFailure(cause: unknown): string {
	/**
	 * `AbortSignal.timeout` rejects with a `TimeoutError` DOMException. It is
	 * worth distinguishing: a timeout usually means a wrong or unroutable
	 * host, whereas other failures point at DNS or TLS.
	 */
	if (cause instanceof Error && cause.name === 'TimeoutError') {
		return `No response within ${PROBE_TIMEOUT_MS / 1000} seconds.`;
	}

	return 'The project could not be reached. Check PUBLIC_SUPABASE_URL.';
}

export const load: PageServerLoad = async ({ locals }) => {
	/**
	 * The wallet, but only for someone signed in. A signed-out visitor has no
	 * wallet to read, and calling the function anyway would cost a round trip
	 * to Solana to be told so.
	 */
	const user = await locals.getVerifiedUser();
	const { wallet, error: walletError } = user
		? await loadWallet(locals.supabase)
		: { wallet: null, error: null };

	return {
		wallet,
		walletError: walletError?.message ?? null,
		supabaseHealth: await probeSupabase(),

		/**
		 * Echoed back so the page can show which project and cluster this
		 * instance is pointed at. Both are public values, already present in
		 * the browser bundle via `$app/env/public` — returning them here costs
		 * nothing and keeps the page component free of configuration lookups.
		 */
		supabaseUrl: PUBLIC_SUPABASE_URL,
		solanaNetwork: PUBLIC_SOLANA_NETWORK
	};
};
