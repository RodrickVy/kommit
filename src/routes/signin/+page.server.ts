import { fail, redirect } from '@sveltejs/kit';
import { safeRedirectTarget } from '#lib/server/auth/guards';
import type { Actions, PageServerLoad } from './$types';

/**
 * Sign in — email and password.
 *
 * Deliberately gives less detail than the join form. See the note on the
 * failure branch below.
 */

export const load: PageServerLoad = async ({ locals, url }) => {
	if (await locals.getVerifiedUser()) {
		redirect(303, safeRedirectTarget(url.searchParams.get('redirectTo')));
	}

	return {};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const form = await request.formData();

		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');

		const errors: Record<string, string> = {};

		if (email.length === 0) errors.email = 'Enter your email address.';
		if (password.length === 0) errors.password = 'Enter your password.';

		/** One consistent failure shape — see the note in `join/+page.server.ts`. */
		const failure = (
			status: number,
			payload: { errors?: Record<string, string>; formError?: string }
		) => {
			const fieldErrors: Record<string, string> = payload.errors ?? {};
			const formError: string | null = payload.formError ?? null;

			return fail(status, { errors: fieldErrors, formError, email });
		};

		if (Object.keys(errors).length > 0) {
			return failure(400, { errors });
		}

		const { error } = await locals.supabase.auth.signInWithPassword({ email, password });

		if (error) {
			/**
			 * One message for every authentication failure, attached to the form
			 * rather than to a field.
			 *
			 * This is not laziness. "No account with that email" and "wrong
			 * password" are different answers, and the difference is a free
			 * oracle for checking whether an address has an account here —
			 * which is worth something to an attacker and worth nothing to an
			 * honest user, who knows which email they used.
			 *
			 * The join form can afford to be specific: it has to tell you the
			 * address is taken, or you cannot proceed.
			 */
			if (error.message.toLowerCase().includes('confirm')) {
				return failure(403, {
					formError: 'Confirm your email address first — check your inbox for the link.'
				});
			}

			if (error.status === 400 || error.status === 401) {
				return failure(400, {
					formError: 'That email and password do not match an account.'
				});
			}

			return failure(500, { formError: 'Could not sign you in. Please try again.' });
		}

		redirect(303, safeRedirectTarget(url.searchParams.get('redirectTo')));
	}
};
