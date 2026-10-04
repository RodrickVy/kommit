import { SUPABASE_SERVICE_ROLE_KEY } from '$app/env/private';
import { PUBLIC_SUPABASE_URL } from '$app/env/public';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireSecret } from '#lib/server/config/require-secret';
import type { Database } from '#lib/supabase/database.types';

/**
 * The privileged Supabase client.
 *
 * READ THIS BEFORE USING IT
 * -------------------------
 * This client authenticates with the `service_role` key, which BYPASSES ROW
 * LEVEL SECURITY COMPLETELY. Every query it makes can read and write every
 * row belonging to every user. None of the database's authorisation rules
 * apply to it.
 *
 * It therefore must not be used to serve a request on a user's behalf. The
 * correct client for that is `event.locals.supabase`, which acts as the user
 * and is constrained by RLS. Reaching for this client because a query "wasn't
 * returning anything" means an RLS policy is wrong, fix the policy.
 *
 * Legitimate uses are operations that have no user to act as:
 *
 *   - handling an inbound webhook, where the caller is another system
 *   - a scheduled job reconciling state
 *   - administrative repair of data
 *
 * A result from this client must never be returned from a `load` function
 * without being filtered first, because whatever a `load` function returns is
 * serialised into the page's HTML.
 */

/**
 * Constructed on first use and then reused. Unlike the request-scoped client,
 * this one is safe to share: it holds no user session, so it is the same
 * privileged identity on every call and there is nothing to leak between
 * requests.
 */
let client: SupabaseClient<Database> | null = null;

/**
 * Returns the privileged client, creating it on first use.
 *
 * Construction is deferred rather than done at module load so that
 * `SUPABASE_SERVICE_ROLE_KEY` is only required once something actually needs
 * admin access. A developer can run the app, and a user can browse it,
 * without that secret being present.
 *
 * @throws If `SUPABASE_SERVICE_ROLE_KEY` is not configured.
 */
export function adminClient(): SupabaseClient<Database> {
	if (client) return client;

	client = createClient<Database>(
		PUBLIC_SUPABASE_URL,
		requireSecret('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY),
		{
			auth: {
				/**
				 * The service role key is a static credential, not a user
				 * session. There is no refresh token to rotate and nowhere on
				 * the server to persist a session to, so both behaviours are
				 * switched off. Left on, the client would attempt background
				 * refreshes against a session that does not exist.
				 */
				autoRefreshToken: false,
				persistSession: false,

				/**
				 * Never try to read a session out of a URL fragment. That is
				 * browser OAuth-callback behaviour and is meaningless here.
				 */
				detectSessionInUrl: false
			}
		}
	);

	return client;
}
