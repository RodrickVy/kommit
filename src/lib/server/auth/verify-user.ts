import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from '#lib/types/auth';
import type { Database } from '#lib/supabase/database.types';

/**
 * Establishes who is making the current request, or `null` if nobody is.
 *
 * This is the only function in the codebase permitted to decide that a
 * request is authenticated. Everything else consumes its result.
 *
 * WHY NOT `auth.getSession()`
 * ---------------------------
 * `getSession()` decodes the access token out of the request's cookies and
 * returns it WITHOUT checking the signature. Cookies are client-supplied, so
 * its result is an unverified claim about identity — anyone can hand us a
 * cookie containing any `sub` they like. Using it for an authorisation
 * decision is an authentication bypass.
 *
 * WHY `auth.getClaims()` AND NOT `auth.getUser()`
 * -----------------------------------------------
 * Both verify properly, but they pay for it differently:
 *
 *   - `getUser()` makes an HTTP round trip to the Auth server on every single
 *     call. Under the hierarchical load pattern this function runs at least
 *     once per navigation, so that cost lands on every page view.
 *
 *   - `getClaims()` verifies the token's signature locally with the WebCrypto
 *     API against the project's published JSON Web Key Set, which the client
 *     caches. After the first request there is normally no network call at
 *     all. If the project still signs with a symmetric secret rather than an
 *     asymmetric key, it transparently falls back to asking the Auth server,
 *     so this is never less correct — only sometimes slower.
 *
 * It also refreshes the session first if the token is about to expire, which
 * is what triggers the `setAll` cookie write in `request-client.ts`.
 *
 * @param supabase The request-scoped client, i.e. `event.locals.supabase`.
 *                 Must be the request-scoped one: the admin client carries no
 *                 user token and would always yield `null`.
 * @returns The verified user, or `null` when there is no valid session.
 */
export async function verifyUser(supabase: SupabaseClient<Database>): Promise<SessionUser | null> {
	const { data, error } = await supabase.auth.getClaims();

	/**
	 * Three outcomes are collapsed into `null` here, because the app's
	 * response to all of them is identical — treat the request as anonymous:
	 *
	 *   - `error` set: the token was present but failed verification, is
	 *     expired, or the Auth server could not be reached
	 *   - `data` null with no error: there was no token to verify
	 *   - a valid token: falls through below
	 *
	 * A verification failure is deliberately not re-thrown. A tampered or
	 * stale cookie should render the signed-out view, not a 500.
	 */
	if (error !== null || data === null) {
		return null;
	}

	const { claims } = data;

	/**
	 * Map the JWT's claims onto our own narrow domain type. `sub` and `role`
	 * are guaranteed present by Supabase; `email` is absent for phone and
	 * anonymous sign-ins, so it is normalised to `null` rather than left
	 * `undefined` — one representation of "no email", not two.
	 */
	return {
		id: claims.sub,
		email: claims.email ?? null,
		role: claims.role
	};
}
