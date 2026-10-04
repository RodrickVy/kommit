import { redirect } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards';
import type { Actions, PageServerLoad } from './$types';

/**
 * Account.
 *
 * Also hosts the sign-out action, which the header posts to from every page.
 * A form action has to live on a route, and this is the one that is about the
 * signed-in user.
 */

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(await locals.getVerifiedUser(), url.pathname);

	/**
	 * The profile is read here rather than in the root layout. Only this page
	 * needs it, and putting it in the layout would make every route in the app
	 * pay for a query it does not use.
	 *
	 * Columns are listed explicitly — never `select('*')`. The generated types
	 * then describe exactly what was fetched, and a column added later does not
	 * quietly start being serialised into every page of HTML.
	 */
	const { data: profile, error } = await locals.supabase
		.from('profiles')
		.select(
			'display_name, description, reputation, commitments_total, commitments_successful, email_receipts_enabled'
		)
		.eq('id', user.id)
		.single();

	if (error) {
		/**
		 * The trigger on `auth.users` guarantees a profile exists, so this is
		 * unreachable in normal operation. Surfacing it rather than rendering a
		 * blank page means a broken trigger shows up immediately.
		 */
		return { user, profile: null, loadError: 'Your profile could not be loaded.' };
	}

	return { user, profile, loadError: null };
};

export const actions: Actions = {
	signout: async ({ locals }) => {
		/**
		 * Clears the session cookies through the request-scoped client, so the
		 * `setAll` handler in `request-client.ts` writes the expiry onto this
		 * response.
		 *
		 * The error is ignored on purpose: if the token was already invalid,
		 * sign-out has effectively succeeded, and refusing to let someone log
		 * out because their session was broken is the wrong failure mode.
		 */
		await locals.supabase.auth.signOut();

		redirect(303, '/');
	}
};
