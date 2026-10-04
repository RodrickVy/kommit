import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@^2.117.0';

/**
 * Authorising operations that no ordinary user may perform.
 *
 * Two kinds of caller qualify, and they are deliberately different things:
 *
 *   SERVICE ROLE , an operator or a scheduler, holding the project's service
 *                   key. Nobody is attributable; there is no person involved.
 *   ADMIN        , a signed-in user whose profile carries `is_admin`. A
 *                   person, attributable, revocable by flipping one boolean.
 *
 * Both are accepted so the same function serves `npm run` setup scripts, the
 * scheduler, and the /admin page without any of them needing another path.
 */

/**
 * Whether the caller's credential can read a table only the service role may.
 *
 * A PERMISSION PROBE, not an identity check: it asks what the caller is
 * allowed to do rather than what they claim to be.
 *
 * Deliberately not a string comparison against `SUPABASE_SERVICE_ROLE_KEY`.
 * Supabase issues service credentials in more than one format and which one a
 * project injects can change, so comparing tokens fails for reasons that have
 * nothing to do with authorisation. `platform_wallet` has RLS enabled and no
 * policies at all, so every role except the service role is denied, a
 * successful read with the caller's own token therefore proves service-role
 * rights, whatever the credential looks like. The database answers the
 * question instead of a hardcoded assumption.
 */
export async function hasServiceRole(request: Request): Promise<boolean> {
	const authorization = request.headers.get('Authorization');
	const url = Deno.env.get('SUPABASE_URL');
	if (!authorization || !url) return false;

	const token = authorization.replace('Bearer ', '');

	const asCaller = createClient(url, token, {
		global: { headers: { Authorization: authorization } },
		auth: { autoRefreshToken: false, persistSession: false }
	});

	/**
	 * `head: true` fetches no rows, only whether the read was permitted. An
	 * empty table and a forbidden table are distinguished by the error, not by
	 * the row count.
	 */
	const { error } = await asCaller
		.from('platform_wallet')
		.select('id', { head: true, count: 'exact' });

	return !error;
}

/**
 * Whether this profile is an administrator.
 *
 * Read with the service client, because `profiles.is_admin` is granted to no
 * role the browser can reach, so the user's own session cannot read it, and
 * therefore cannot be tricked into reporting it wrongly either.
 */
export async function isAdmin(db: SupabaseClient, profileId: string): Promise<boolean> {
	const { data } = await db
		.from('profiles')
		.select('is_admin')
		.eq('id', profileId)
		.maybeSingle<{ is_admin: boolean }>();

	return data?.is_admin === true;
}

export interface PrivilegedCaller {
	/** The administrator's profile id, or null when the caller is the service role. */
	readonly adminId: string | null;
}

/**
 * Resolves a privileged caller, or null when the request is not privileged.
 *
 * @param callerProfileId The authenticated user id, or null for a non-user
 *                        credential. Pass the result of `callerId(request)`.
 */
export async function privilegedCaller(
	request: Request,
	db: SupabaseClient,
	callerProfileId: string | null
): Promise<PrivilegedCaller | null> {
	if (await hasServiceRole(request)) return { adminId: null };

	if (callerProfileId && (await isAdmin(db, callerProfileId))) {
		return { adminId: callerProfileId };
	}

	return null;
}
