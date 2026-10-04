import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '#lib/supabase/database.types';
import type { SessionUser } from '#lib/types/auth';

/**
 * Ambient type declarations for SvelteKit's `App` namespace.
 *
 * Populating `App.Locals` is what makes `event.locals` typed inside
 * `hooks.server.ts`, every `+page.server.ts`, every `+layout.server.ts` and
 * every `+server.ts`. Without it, `locals` is an empty object and the
 * Supabase client we attach in the hook would be invisible to the type
 * checker.
 *
 * `App.PageData` is deliberately left alone. SvelteKit infers each route's
 * `data` from that route's own `load` return type, which is more precise than
 * anything we could declare globally here.
 *
 * @see https://svelte.dev/docs/kit/types#app
 */
declare global {
	namespace App {
		interface Locals {
			/**
			 * The Supabase client for this request, created in
			 * `src/hooks.server.ts`.
			 *
			 * Scoped to this request's cookies, so it acts as the signed-in
			 * user and every query it makes is filtered by Row Level
			 * Security. This is the client all server-side data loading
			 * should use.
			 */
			supabase: SupabaseClient<Database>;

			/**
			 * Returns the verified user for this request, or `null` if the
			 * request is anonymous.
			 *
			 * Memoised per request: the underlying signature check runs at
			 * most once no matter how many `load` functions ask. That is what
			 * makes it safe to call from a layout and a page in the same
			 * navigation.
			 *
			 * "Verified" means the access token's signature was checked, see
			 * `src/lib/server/auth/verify-user.ts`. Authorisation decisions
			 * may be based on this and on nothing else.
			 */
			getVerifiedUser: () => Promise<SessionUser | null>;
		}
	}
}

export {};
