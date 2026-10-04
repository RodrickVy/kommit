import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@^2.117.0';

/**
 * The database client for Edge Functions.
 *
 * Uses the service role, which BYPASSES Row Level Security. That is required
 * here and nowhere else: these functions read the encrypted secret-key column,
 * which no browser-reachable role is granted access to at all.
 *
 * The consequence is that every query in a function is responsible for its own
 * scoping. There is no policy underneath to catch a missing
 * `.eq('profile_id', ...)`, so each query must be written as though it were the
 * only protection — because it is.
 */
export function serviceClient(): SupabaseClient {
	const url = Deno.env.get('SUPABASE_URL');
	const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

	if (!url || !key) {
		/** Both are injected automatically by Supabase; absence means a broken deploy. */
		throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be present.');
	}

	return createClient(url, key, {
		auth: {
			/** A static credential, not a session. Nothing to refresh, nowhere to persist. */
			autoRefreshToken: false,
			persistSession: false
		}
	});
}

/**
 * Resolves the caller from their JWT.
 *
 * The function is invoked with the user's own access token in the
 * Authorization header. Reading the user from that token — rather than
 * trusting a `profile_id` in the request body — is what stops one user
 * creating or querying another user's wallet.
 *
 * @returns The authenticated user's id, or null when the token is not valid.
 */
export async function callerId(request: Request): Promise<string | null> {
	const authorization = request.headers.get('Authorization');
	if (!authorization) return null;

	const url = Deno.env.get('SUPABASE_URL');
	const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
	if (!url || !anonKey) return null;

	const scoped = createClient(url, anonKey, {
		global: { headers: { Authorization: authorization } },
		auth: { autoRefreshToken: false, persistSession: false }
	});

	const { data, error } = await scoped.auth.getUser();

	return error ? null : (data.user?.id ?? null);
}
