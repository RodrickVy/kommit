import { isAdminUser } from '#lib/server/auth/admin';
import type { LayoutServerLoad } from './$types';

/**
 * Root layout load, the top of the data hierarchy.
 *
 * This is the ONLY place the signed-in user is loaded. Every route inherits
 * the result, and no page should resolve the user for itself.
 *
 * WHY THIS DOES NOT RE-RUN ON EVERY NAVIGATION
 * --------------------------------------------
 * SvelteKit re-runs a `load` function only when something it depends on
 * changes. Dependencies are tracked from what the function actually touches:
 * route params, properties of `url`, anything registered with `depends()`,
 * and the parent's data.
 *
 * This function touches none of those, it reads only `locals`. So after the
 * first server render it is NOT re-run as the user moves between
 * `/discover`, `/wallet` and `/commitments`. The header keeps rendering the
 * same user object without a single extra request.
 *
 * That property is easy to destroy by accident. Reading `url.pathname` here,
 * for example, would make this re-run on every navigation and re-verify the
 * token each time. If something genuinely path-dependent is needed, it
 * belongs in the page's own `+page.server.ts`, not here.
 *
 * HOW IT RE-RUNS WHEN IT MUST
 * ---------------------------
 * Sign-in and sign-out change the answer, and both go through a server form
 * action. After an action SvelteKit re-runs the page's load functions, and a
 * `redirect` from an action triggers a fresh navigation, so the new user is
 * picked up without anything here needing to opt in. With JavaScript
 * disabled it is a full page load, which has the same effect.
 *
 * WHAT MAY BE ADDED HERE
 * ----------------------
 * Only data that (a) is needed by the shell itself or by most routes, and
 * (b) does not depend on the current path. Anything else makes every page in
 * the app pay for one page's query.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	/**
	 * Memoised in `hooks.server.ts`, so the token's signature is verified at
	 * most once per request even though pages may ask again while scoping
	 * their own queries.
	 */
	const user = await locals.getVerifiedUser();

	/**
	 * The admin flag belongs to the shell: it decides whether the header shows
	 * an Admin link, which is the definition of what this layout is for.
	 *
	 * It costs one primary-key lookup, and only for signed-in users,
	 * `isAdminUser` returns false immediately for an anonymous visitor without
	 * touching the database. Because this load still depends on nothing
	 * trackable, the query runs on a full page load and not again as the user
	 * navigates.
	 *
	 * Hiding the link is cosmetic. `/admin` answers 404 to anyone who is not an
	 * administrator, whatever the navigation says.
	 */
	const [isAdmin, profile] = await Promise.all([
		isAdminUser(user),
		/** The name shown in the header in place of the private email. */
		user
			? locals.supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
			: Promise.resolve({ data: null })
	]);

	/**
	 * Returned as `data.user` to the layout and, through inheritance, to
	 * every page beneath it.
	 *
	 * `SessionUser` is three small fields by design. Whatever a `load`
	 * function returns is serialised into the page's HTML, so returning the
	 * full Supabase user object would ship its metadata, identity list and
	 * timestamps to the browser on every single page view.
	 */
	return { user, isAdmin, displayName: profile.data?.display_name ?? null };
};
