import { redirect } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import { safeRedirectTarget } from '#lib/server/auth/guards';
import type { RequestHandler } from './$types';

/**
 * Auth callback, `/auth/callback`.
 *
 * Where every email link lands: confirmations, password resets, magic links.
 *
 * WHY THIS ROUTE HAS TO EXIST
 * ---------------------------
 * A Supabase email link does not sign anyone in by itself. Clicking it proves
 * the person holds the mailbox, and Supabase then redirects back here with a
 * one-time credential in the query string. Something has to trade that
 * credential for a session and write the session cookies.
 *
 * Without this endpoint the link "works", the browser arrives at the site,
 * and the visitor is still signed out, holding a URL full of parameters
 * nothing reads. That is the worst kind of broken, because it looks fine.
 *
 * TWO SHAPES, BECAUSE SUPABASE SENDS BOTH
 * ---------------------------------------
 * Which one arrives depends on the project's flow type and on whether the
 * email templates have been customised:
 *
 *   ?code=...                    PKCE. Exchange it for a session.
 *   ?token_hash=...&type=signup  The token-hash form, used by customised
 *                                templates. Verify it instead.
 *
 * Both are handled, so changing an email template later cannot silently break
 * sign-up.
 */

/** Email link types we are willing to act on. */
const HANDLED_TYPES: ReadonlySet<string> = new Set<EmailOtpType>([
	'signup',
	'invite',
	'magiclink',
	'recovery',
	'email_change',
	'email'
]);

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type');

	/**
	 * Where to send the visitor afterwards. Passed through `safeRedirectTarget`
	 * because it comes from a URL anyone can construct, without that check,
	 * `/auth/callback?next=https://evil.example` would bounce a freshly
	 * authenticated user to another site, which is about as convincing as
	 * phishing gets.
	 */
	const next = safeRedirectTarget(url.searchParams.get('next'));

	/**
	 * Supabase reports a refused link by redirecting here with its own error
	 * parameters rather than by failing. The commonest by far is an expired
	 * link, so it gets its own message, "something went wrong" would leave
	 * someone clicking the same dead link repeatedly.
	 */
	const errorCode = url.searchParams.get('error_code') ?? url.searchParams.get('error');

	if (errorCode) {
		const expired = errorCode.includes('expired') || errorCode === 'otp_expired';
		redirect(
			303,
			`/signin?notice=${encodeURIComponent(
				expired
					? 'That link has expired. Sign in to have a new one sent.'
					: 'That link is no longer valid. Try signing in.'
			)}`
		);
	}

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);

		if (!error) {
			/**
			 * The session cookies are written by the `setAll` handler in
			 * `request-client.ts`, which also attaches the no-store cache headers
			 *, essential here, because a cached redirect carrying a session
			 * cookie would hand one person's account to the next visitor.
			 */
			redirect(303, next);
		}
	} else if (tokenHash && type && HANDLED_TYPES.has(type)) {
		const { error } = await locals.supabase.auth.verifyOtp({
			type: type as EmailOtpType,
			token_hash: tokenHash
		});

		if (!error) {
			redirect(303, next);
		}
	}

	/**
	 * Fell through: no recognised parameters, or verification failed. Both mean
	 * the same thing to the visitor, this link did not work, so they are sent
	 * somewhere they can act rather than shown an error page they cannot.
	 */
	redirect(
		303,
		`/signin?notice=${encodeURIComponent(
			'That link could not be verified. It may have already been used.'
		)}`
	);
};
