import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/**
 * Vite + SvelteKit configuration.
 *
 * As of SvelteKit 3 there is no `svelte.config.js`. Framework options are
 * passed straight to the `sveltekit()` plugin, which also forwards any
 * unrecognised option to `vite-plugin-svelte`.
 *
 * @see https://svelte.dev/docs/kit/configuration
 */
export default defineConfig({
	plugins: [
		sveltekit({
			/**
			 * Deploy target is Vercel.
			 *
			 * `runtime: 'nodejs22.x'` pins every server route to the Node.js
			 * runtime instead of the Edge runtime. This is a deliberate
			 * choice, not a default: the Solana libraries we will add for the
			 * wallet and treasury depend on Node built-ins (`crypto`,
			 * `buffer`) that the Edge runtime does not implement.
			 */
			adapter: adapter({
				runtime: 'nodejs22.x'
			})

			/**
			 * NOT CONFIGURED YET — Content Security Policy.
			 *
			 * A CSP belongs here, but it can only be written once we know
			 * every origin the app actually talks to (Supabase REST/Auth,
			 * Supabase Storage for listing images, the Solana RPC endpoint).
			 * A guessed policy fails silently in production — assets simply
			 * stop loading — so we add it as its own reviewed change rather
			 * than approximating it now.
			 */
		})
	]
});
