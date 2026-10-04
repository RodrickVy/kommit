import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import type { Database } from '#lib/supabase/database.types';

/**
 * Creates the Supabase client for a single incoming request.
 *
 * Built once per request in `src/hooks.server.ts` and exposed as
 * `event.locals.supabase`. Every server-side query in the app goes through
 * that instance.
 *
 * ONE CLIENT PER REQUEST, NEVER A SHARED SINGLETON
 * ------------------------------------------------
 * The client is bound to this request's cookies, so it carries this user's
 * access token and nothing else. A module-scope singleton shared between
 * requests would leak one user's session to another under concurrency, the
 * most damaging bug available in an SSR app. Hence a factory, and hence no
 * caching here.
 *
 * It authenticates with the `anon` key, so every query it makes is still
 * subject to Row Level Security. That is deliberate: authorisation is
 * enforced by the database, which means a forgotten `.eq('user_id', ...)`
 * filter in application code cannot expose another user's rows. For the rare
 * operation that must bypass RLS, see `admin-client.ts`.
 */
export function createRequestClient(event: RequestEvent): SupabaseClient<Database> {
	/**
	 * Tracks which response headers have already been set, because
	 * `event.setHeaders` throws if the same header is set twice in one
	 * request. Supabase emits its cache headers only on the first cookie
	 * write, but a code path that re-entered this one would otherwise 500.
	 */
	const headersApplied = new Set<string>();

	return createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),

			/**
			 * Called when the Supabase client needs to persist a session, on
			 * sign-in, on sign-out, and whenever it silently refreshes an
			 * access token that was about to expire.
			 *
			 * Implementing BOTH `getAll` and `setAll` is required. With only
			 * `getAll`, refreshed tokens are never written back, and the
			 * symptoms are famously hard to diagnose: intermittent logouts,
			 * sessions that die early, a storm of refresh requests.
			 */
			setAll: (cookiesToSet, headers) => {
				for (const { name, value, options } of cookiesToSet) {
					/**
					 * SvelteKit requires an explicit `path` on every cookie,
					 * where the `cookie` library treats it as optional.
					 * Defaulting to `/` keeps the session cookie readable by
					 * every route, which is what an auth cookie needs.
					 */
					event.cookies.set(name, value, { ...options, path: options.path ?? '/' });
				}

				/**
				 * Supabase hands us `Cache-Control: private, no-store`,
				 * `Expires: 0` and `Pragma: no-cache` alongside the cookies.
				 * These MUST reach the response: a response that sets an auth
				 * cookie and is then cached by a CDN or reverse proxy will
				 * serve one user's session token to the next visitor. On
				 * Vercel, where responses sit behind a shared edge cache,
				 * that is not a theoretical risk.
				 */
				for (const [name, value] of Object.entries(headers)) {
					if (headersApplied.has(name)) continue;
					headersApplied.add(name);
					event.setHeaders({ [name]: value });
				}
			}
		}
	});
}
