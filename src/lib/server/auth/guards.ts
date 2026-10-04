import { redirect } from '@sveltejs/kit';
import type { SessionUser } from '#lib/types/auth';

/**
 * Route guards.
 *
 * A guard is the ONLY thing that keeps an anonymous visitor off a page.
 * Hiding a link in the navigation does not: anyone can type a URL. See the
 * warning on `NavVisibility` in `#lib/config/navigation`.
 */

/**
 * Requires a signed-in user, or redirects to sign-in.
 *
 * @param user     The result of `locals.getVerifiedUser()`.
 * @param pathname The page being guarded, so the user can be returned to it
 *                 after signing in.
 * @returns The user, narrowed to non-null.
 * @throws A redirect to `/signin` when there is no session.
 */
export function requireUser(user: SessionUser | null, pathname: string): SessionUser {
	if (user === null) {
		/**
		 * 303 rather than 302. After a POST, a 302 lets the browser repeat the
		 * request method against the new location; 303 forces a GET, which is
		 * what "go and look at the sign-in page" means.
		 *
		 * The destination is carried as a query parameter so the user lands
		 * back where they were trying to go. `encodeURIComponent` matters:
		 * a path containing `&` would otherwise truncate the parameter.
		 */
		redirect(303, `/signin?redirectTo=${encodeURIComponent(pathname)}`);
	}

	return user;
}

/**
 * Resolves where to send someone after they sign in or join.
 *
 * Only accepts a same-origin absolute path. A `redirectTo` arrives from the
 * query string, which is attacker-controllable: without this check, a link to
 * `/signin?redirectTo=https://evil.example` would bounce a freshly
 * authenticated user to another site that looks like a continuation of the
 * flow. That is an open redirect, and it is one of the easier ways to make a
 * phishing page credible.
 *
 * @param redirectTo The raw query parameter, or null.
 * @returns A safe path to redirect to.
 */
export function safeRedirectTarget(redirectTo: string | null): string {
	/**
	 * Must start with exactly one `/`. A value beginning `//` is
	 * protocol-relative — the browser reads `//evil.example` as an absolute URL
	 * on the current scheme — so it is rejected along with anything carrying
	 * its own scheme.
	 */
	if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
		return redirectTo;
	}

	return '/';
}
