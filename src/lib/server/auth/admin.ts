import { adminClient } from '#lib/server/supabase/admin-client';
import type { SessionUser } from '#lib/types/auth';

/**
 * Whether the signed-in user administers the marketplace.
 *
 * WHY THIS NEEDS THE PRIVILEGED CLIENT
 * ------------------------------------
 * `profiles.is_admin` is granted to no role the browser can reach, not to
 * `anon`, not to `authenticated`, and not to the user on their own row. So the
 * request-scoped client cannot read it, which is the point: the flag is not
 * something a session can be persuaded to report.
 *
 * The consequence is that this is the one authorisation question in kommitly
 * that RLS cannot answer, so it is asked with the service role and asked only
 * here.
 *
 * NOT A GUARD. It returns a boolean. The guard is in the route, which must
 * decide what to do with a `false`, see `/admin`.
 */
export async function isAdminUser(user: SessionUser | null): Promise<boolean> {
	if (!user) return false;

	try {
		const { data, error } = await adminClient()
			.from('profiles')
			.select('is_admin')
			.eq('id', user.id)
			.maybeSingle();

		if (error) {
			console.error('[isAdminUser] could not read the admin flag', error);
			return false;
		}

		return data?.is_admin === true;
	} catch (cause) {
		/**
		 * `adminClient()` throws when SUPABASE_SERVICE_ROLE_KEY is absent, which
		 * is a legitimate local setup, the app is meant to run without secrets.
		 *
		 * Returning false rather than propagating is deliberate: this is called
		 * from the root layout, so throwing would take down every page in the
		 * app for a missing admin feature. Failing closed costs an administrator
		 * one page; failing open or failing loud would cost everyone the site.
		 */
		console.error('[isAdminUser] admin access is not configured', cause);
		return false;
	}
}
