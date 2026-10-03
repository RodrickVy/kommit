/**
 * Authentication domain types.
 *
 * These are kommitly's own types, not Supabase's. The application depends on
 * this narrow shape rather than on `@supabase/supabase-js`'s much wider
 * `User` object, which carries identities, factors, metadata and timestamps
 * that no part of the UI needs.
 *
 * Keeping our own type here means:
 *
 *   - a `load` function returns three small fields, not a large object that
 *     gets serialised into every page's HTML
 *   - a breaking change in the Supabase client's types is absorbed in one
 *     place (`src/lib/server/auth/verify-user.ts`) instead of rippling out
 *   - it is obvious at a glance what the app actually knows about a signed-in
 *     user
 *
 * Add a field here only when something renders it.
 */

/**
 * A user whose identity has been cryptographically verified for the current
 * request.
 *
 * The existence of a `SessionUser` is the app's proof of authentication. It is
 * only ever produced by `verifyUser()`, which validates the access token's
 * signature — never by reading a cookie or trusting a client-supplied value.
 */
export interface SessionUser {
	/**
	 * The user's immutable Supabase Auth id (the JWT `sub` claim).
	 *
	 * This is the value to store in foreign keys and to compare against
	 * `auth.uid()` in Row Level Security policies.
	 */
	readonly id: string;

	/**
	 * The user's email address, or `null` when the account has none — which is
	 * the case for phone sign-in and anonymous sessions.
	 */
	readonly email: string | null;

	/**
	 * The Postgres role the user's requests execute as, from the JWT `role`
	 * claim. In practice `'authenticated'`, or `'anon'` for an unauthenticated
	 * token. Row Level Security policies are written against this.
	 */
	readonly role: string;
}
