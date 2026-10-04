import { fail, redirect } from '@sveltejs/kit';
import { safeRedirectTarget } from '#lib/server/auth/guards';
import type { Actions, PageServerLoad } from './$types';

/**
 * Join — create an account.
 *
 * Email and password for now. The product specification describes passwordless
 * email codes, which is a change to this file and the sign-in form only; the
 * data model is unaffected either way, because Supabase Auth holds credentials
 * in `auth.users` and never in `profiles`.
 *
 * The profile row is NOT created here. A database trigger on `auth.users`
 * creates it, which means an account can never exist without its profile even
 * if this request dies between the two steps.
 */

/** Matches Supabase's own minimum. Raising it here would reject nothing. */
const MINIMUM_PASSWORD_LENGTH = 8;

export const load: PageServerLoad = async ({ locals, url }) => {
	/**
	 * Someone already signed in has no use for this page. Sending them on is
	 * friendlier than showing a form that would fail.
	 */
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
		const displayName = String(form.get('displayName') ?? '').trim();

		/**
		 * Field-level errors, collected rather than returned on the first
		 * failure. Showing one problem at a time means three round trips to fix
		 * three mistakes.
		 */
		const errors: Record<string, string> = {};

		if (displayName.length === 0) {
			errors.displayName = 'Enter the name other people will see.';
		} else if (displayName.length > 60) {
			errors.displayName = 'Use 60 characters or fewer.';
		}

		if (email.length === 0) {
			errors.email = 'Enter your email address.';
		} else if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
			/**
			 * Deliberately a shape check, not a full RFC 5322 pattern. Those
			 * reject valid addresses, and the only real proof an address works
			 * is sending mail to it.
			 */
			errors.email = 'That does not look like an email address.';
		}

		if (password.length === 0) {
			errors.password = 'Choose a password.';
		} else if (password.length < MINIMUM_PASSWORD_LENGTH) {
			errors.password = `Use at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
		}

		/**
		 * Every failure returns the SAME shape.
		 *
		 * Without this, each `fail()` call site infers its own object type and
		 * the page receives a union — at which point `form.errors.email` is a
		 * type error on the branches that happened not to set it. Returning one
		 * shape consistently is both easier to consume and easier to reason
		 * about than narrowing a union in the template.
		 *
		 * `email` and `displayName` are echoed back so the form can be
		 * repopulated. The password never is: it would be written into the HTML.
		 */
		const failure = (
			status: number,
			payload: { errors?: Record<string, string>; formError?: string }
		) => {
			/* Annotated locals rather than inline `?? {}`. An empty object
			   literal infers as `{}`, which unions with `Record<string, string>`
			   and makes every key access a type error on the page. */
			const fieldErrors: Record<string, string> = payload.errors ?? {};
			const formError: string | null = payload.formError ?? null;

			return fail(status, {
				errors: fieldErrors,
				formError,
				awaitingConfirmation: false,
				email,
				displayName
			});
		};

		if (Object.keys(errors).length > 0) {
			return failure(400, { errors });
		}

		const { data, error } = await locals.supabase.auth.signUp({
			email,
			password,
			options: {
				/**
				 * Read by the `handle_new_user` trigger to populate
				 * `profiles.display_name`.
				 */
				data: { display_name: displayName },

				/**
				 * Where the confirmation link lands: `/auth/callback`, which
				 * trades the one-time code for a session. Pointing it at a normal
				 * page instead would deliver the visitor back to the site still
				 * signed out, holding parameters nothing reads.
				 *
				 * Built from the REQUEST ORIGIN rather than a configured value,
				 * so the link is correct in local development, on each preview
				 * deployment and in production without three separate settings —
				 * and so a preview never emails someone a production link.
				 *
				 * The origin must appear in the project's allowed redirect URLs
				 * or Supabase ignores it and falls back to `site_url`.
				 */
				emailRedirectTo: `${url.origin}/auth/callback`
			}
		});

		if (error) {
			/**
			 * Supabase messages are aimed at developers. Map the ones a user can
			 * actually act on, and fall back to something honest rather than
			 * printing an internal string.
			 */
			const message = error.message.toLowerCase();

			if (message.includes('already registered') || message.includes('already exists')) {
				return failure(409, {
					errors: { email: 'An account already uses this email. Sign in instead.' }
				});
			}

			if (message.includes('password')) {
				return failure(400, { errors: { password: error.message } });
			}

			/**
			 * Supabase could not send the confirmation email.
			 *
			 * Almost always means the project has "Confirm email" switched on
			 * while still using Supabase's built-in SMTP, which is rate-limited
			 * to a handful of messages an hour and is not intended for real use.
			 * The symptom is maddening without this message: sign-up works once
			 * or twice, then fails for an hour, then works again.
			 *
			 * The account itself is usually created — only the email failed — so
			 * the message says to try signing in rather than to try again.
			 */
			if (
				message.includes('sending confirmation') ||
				message.includes('error sending') ||
				message.includes('smtp') ||
				message.includes('rate limit') ||
				error.status === 429
			) {
				return failure(503, {
					formError:
						'Your account may have been created, but the confirmation email could not be sent — the email service is rate limited. Try signing in; if that does not work, wait a few minutes and try again.'
				});
			}

			return failure(500, { formError: 'The account could not be created. Please try again.' });
		}

		/**
		 * Two outcomes, decided by the project's email-confirmation setting:
		 *
		 *   - confirmation OFF: a session is returned and the user is signed in
		 *   - confirmation ON:  no session, and they must click a link first
		 *
		 * Both are legitimate, so the result is read rather than assumed.
		 */
		if (data.session === null) {
			const noErrors: Record<string, string> = {};
			return {
				errors: noErrors,
				formError: null,
				awaitingConfirmation: true,
				email,
				displayName
			};
		}

		redirect(303, safeRedirectTarget(url.searchParams.get('redirectTo')));
	}
};
