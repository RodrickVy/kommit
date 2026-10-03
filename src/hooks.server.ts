import type { Handle } from '@sveltejs/kit/hooks';
import { verifyUser } from '#lib/server/auth/verify-user';
import { createRequestClient } from '#lib/server/supabase/request-client';
import type { SessionUser } from '#lib/types/auth';

/**
 * The server request pipeline.
 *
 * `handle` runs once per request, before any `load` function, and is where
 * per-request dependencies are constructed and attached to `event.locals`.
 * Doing it here rather than in each route is what lets a `load` function be
 * three lines long.
 *
 * @see https://svelte.dev/docs/kit/hooks#Server-hooks-handle
 */
export const handle: Handle = async ({ event, resolve }) => {
	/**
	 * A fresh Supabase client bound to this request's cookies. Created per
	 * request, never shared — see the warning in `request-client.ts`.
	 */
	event.locals.supabase = createRequestClient(event);

	/**
	 * Per-request memoisation of the verified user.
	 *
	 * `undefined` means "not asked yet"; `null` is a real, cached answer
	 * meaning "nobody is signed in". The two must stay distinct, otherwise
	 * every anonymous request would re-run verification on each call.
	 *
	 * This matters because of how data loading is structured: the root layout
	 * asks for the user on every navigation, and individual pages ask again
	 * when they need to scope a query. Without the cache, one navigation
	 * could trigger several signature checks — and, worse, several token
	 * refreshes racing each other.
	 */
	let verified: SessionUser | null | undefined;

	event.locals.getVerifiedUser = async () => {
		if (verified === undefined) {
			verified = await verifyUser(event.locals.supabase);
		}
		return verified;
	};

	return resolve(event);
};
