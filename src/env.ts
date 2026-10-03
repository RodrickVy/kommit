import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Environment variable declarations.
 *
 * This file is the single, authoritative list of every environment variable
 * kommitly reads. SvelteKit loads it at startup, runs each validator below, and
 * generates typed modules from the result:
 *
 *     import { PUBLIC_SUPABASE_URL } from '$app/env/public';        // anywhere
 *     import { SUPABASE_SERVICE_ROLE_KEY } from '$app/env/private'; // server only
 *
 * Nothing reads `process.env` directly, and there is no hand-written config
 * accessor — the framework supplies both the validation and the types. Each
 * `description` below becomes a JSDoc comment on the generated export, so it
 * shows on hover wherever the variable is used.
 *
 * WHAT `public` MEANS
 * -------------------
 * `public: true` makes a variable importable from `$app/env/public`, which is
 * bundled into the JavaScript sent to the browser. Anyone can read it with
 * view-source. A variable left private is importable only from
 * `$app/env/private`, and SvelteKit fails the build if client code reaches
 * it — so a leak is a compile error rather than a breach.
 *
 * WHY NOTHING IS `static`
 * -----------------------
 * `static: true` inlines a value into the bundle at build time, which permits
 * dead-code elimination. Every variable here is left dynamic (read at
 * startup) instead, so one build artefact can be promoted from preview to
 * production without rebuilding, and a misconfigured deployment reports the
 * missing variable by name rather than failing as a module resolution error.
 *
 * REQUIRED VERSUS OPTIONAL
 * ------------------------
 * Public variables are required. The app cannot usefully serve a page without
 * them, so it should refuse to start rather than fail later in a confusing
 * way. `.env.example` ships working values for all but the two Supabase
 * credentials, so in practice only those need pasting in.
 *
 * Secrets are optional at startup and required at the point of use. Each is
 * needed by exactly one feature, and demanding a treasury private key before
 * the home page will render would be wrong. See
 * `src/lib/server/config/require-secret.ts`.
 */

/** The Solana clusters the app supports. */
const SOLANA_NETWORKS = ['devnet', 'testnet', 'mainnet-beta'] as const;

/**
 * Requires a non-empty value.
 *
 * An empty string counts as absent. `.env.example` ships keys with no value
 * (`PUBLIC_SUPABASE_URL=`), so a half-filled `.env` is the likeliest mistake
 * and must be caught here rather than treated as configured.
 *
 * Validator messages never name the variable — SvelteKit already prints the
 * name as a heading above them.
 */
function required(value: string | undefined): string {
	const trimmed = value?.trim();

	if (!trimmed) {
		throw new Error('must be set to a non-empty value — see .env.example');
	}

	return trimmed;
}

/**
 * Requires an absolute `http`/`https` URL, and strips any trailing slash.
 *
 * The slash is normalised away rather than rejected: a trailing slash is the
 * usual cause of a URL like `https://host//auth/callback`, and removing it is
 * unambiguous, so erroring would be pedantry rather than safety.
 */
function requiredHttpUrl(value: string | undefined): string {
	const raw = required(value);

	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`must be an absolute URL including the scheme (received "${raw}")`);
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`must use http or https (received "${parsed.protocol}")`);
	}

	return raw.replace(/\/+$/, '');
}

/**
 * Requires one of a fixed set of values, and narrows the type to that set.
 *
 * Used where a typo is silently destructive. `PUBLIC_SOLANA_NETWORK=mainnet`
 * instead of `mainnet-beta` would otherwise surface only at the moment a real
 * transaction was submitted against the wrong chain.
 */
function requiredOneOf<const T extends readonly string[]>(allowed: T) {
	return (value: string | undefined): T[number] => {
		const raw = required(value);

		/**
		 * `find` rather than `includes`, because it returns the matched member
		 * and therefore narrows the type without a cast.
		 */
		const match = allowed.find((candidate) => candidate === raw);

		if (match === undefined) {
			throw new Error(`must be one of: ${allowed.join(', ')} (received "${raw}")`);
		}

		return match;
	};
}

/**
 * Accepts a value that may not be configured yet, normalising blank to
 * `undefined` so there is one representation of "absent".
 *
 * Used for anything belonging to a feature that is not built yet: the app must
 * start without it, and the resulting `string | undefined` type forces
 * whichever feature needs it to acknowledge that it might be missing — see
 * `requireSecret` in `src/lib/server/config/require-secret.ts`.
 */
function optional(value: string | undefined): string | undefined {
	return value?.trim() || undefined;
}

export const variables = defineEnvVars({
	// -- App ----------------------------------------------------------------

	PUBLIC_APP_URL: {
		public: true,
		schema: requiredHttpUrl,
		description:
			'Absolute origin the app is served from, with no trailing slash.\n' +
			'Used wherever an absolute URL cannot be derived from the request:\n' +
			'auth email redirects, OAuth callbacks, share links.\n\n' +
			'local       http://localhost:5173\n' +
			'preview     https://<deployment>.vercel.app\n' +
			'production  https://<your-domain>'
	},

	// -- Supabase -----------------------------------------------------------

	PUBLIC_SUPABASE_URL: {
		public: true,
		schema: requiredHttpUrl,
		description:
			'Base URL of the Supabase project, from Project Settings -> API.\n' +
			'For local development against `supabase start`: http://127.0.0.1:54321'
	},

	PUBLIC_SUPABASE_ANON_KEY: {
		public: true,
		schema: required,
		description:
			'Supabase `anon` key, from Project Settings -> API.\n\n' +
			'Public by design: it grants no privileges of its own, and every\n' +
			'request made with it is still filtered by Row Level Security.'
	},

	SUPABASE_SERVICE_ROLE_KEY: {
		schema: optional,
		description:
			'Supabase `service_role` key. SECRET.\n\n' +
			'BYPASSES Row Level Security entirely and can read or write any row\n' +
			'in the database. Only `src/lib/server/supabase/admin-client.ts` may\n' +
			'read it, and only for work that is deliberately not user-scoped:\n' +
			'webhooks, scheduled jobs, administrative repair.'
	},

	// -- Storage ------------------------------------------------------------

	PUBLIC_SUPABASE_LISTINGS_BUCKET: {
		public: true,
		schema: required,
		description:
			'Name of the Supabase Storage bucket holding listing images.\n\n' +
			'Public because the browser needs it to build image URLs. Access to\n' +
			'the objects themselves is governed by the bucket storage policies,\n' +
			'not by keeping this name secret.'
	},

	// -- Solana -------------------------------------------------------------

	PUBLIC_SOLANA_NETWORK: {
		public: true,
		schema: requiredOneOf(SOLANA_NETWORKS),
		description:
			'Which Solana cluster the app is pointed at.\n\n' +
			'Drives explorer links and is surfaced in the UI, so it is always\n' +
			'obvious whether a balance or a signature belongs to a test network\n' +
			'or to mainnet.'
	},

	PUBLIC_SOLANA_RPC_URL: {
		public: true,
		schema: requiredHttpUrl,
		description:
			'JSON-RPC endpoint used to read chain state and submit transactions.\n\n' +
			'The public Solana endpoints are heavily rate-limited and suitable\n' +
			'for development only; production should use a dedicated provider.'
	},

	// -- Wallet / Treasury --------------------------------------------------

	SOLANA_TREASURY_PUBLIC_KEY: {
		schema: optional,
		description:
			'Base58 public key of the treasury account holding staked commitment\n' +
			'funds.\n\n' +
			'Not secret in itself, since it is an on-chain address, but kept\n' +
			'server-side because nothing in the UI needs it yet.'
	},

	SOLANA_TREASURY_PRIVATE_KEY: {
		schema: optional,
		description:
			'Secret key for the treasury account. SECRET, AND IRREVERSIBLE IF\n' +
			'LEAKED: whoever holds it can move every lamport in the treasury.\n\n' +
			'Never log it, never include it in an error, never return it from a\n' +
			'load function or a form action.\n\n' +
			'Beyond development this should not be an environment variable at\n' +
			'all: a signing service, HSM or KMS should hold the key and expose\n' +
			'only a "sign this transaction" operation, so the application\n' +
			'process never sees the raw bytes.'
	},

	// -- Email (SendGrid) ---------------------------------------------------
	//
	// NOT WIRED UP YET. Declared now so the deployment environments can be
	// configured ahead of the feature, and left empty until then.
	//
	// There are two ways to combine Supabase Auth with SendGrid, and they need
	// different things. Decide which before writing any code:
	//
	//   1. SMTP. Supabase Auth sends its own verification and recovery emails
	//      through SendGrid's SMTP relay. Configured entirely in the Supabase
	//      dashboard under Authentication -> SMTP Settings; the credentials
	//      live there, not here, so NONE of the variables below are used.
	//      Less code, but the email templates are Supabase's.
	//
	//   2. The SendGrid API. We send the mail ourselves, which is what the
	//      variables below are for. Full control over templates and sending
	//      logic, at the cost of owning the delivery path.
	//
	// These variables exist for option 2. If option 1 is chosen, delete them
	// rather than leaving dead configuration behind.

	SENDGRID_API_KEY: {
		schema: optional,
		description:
			'SendGrid API key. SECRET.\n\n' +
			'Grants the ability to send mail as our verified domain, so a leak\n' +
			'means someone else can send email that appears to come from us.\n' +
			'Scope the key to "Mail Send" only — a full-access key can also read\n' +
			'contacts and suppression lists.'
	},

	SENDGRID_FROM_EMAIL: {
		schema: optional,
		description:
			'Address that outbound mail is sent from.\n\n' +
			'Must be a sender SendGrid has verified, or delivery fails outright.\n' +
			'Not secret, but server-only because nothing in the browser sends mail.'
	},

	SENDGRID_FROM_NAME: {
		schema: optional,
		description:
			'Display name shown beside the from address in a mail client, e.g.\n' +
			'"kommitly". Optional even once email is live; SendGrid falls back to\n' +
			'showing the bare address.'
	}
});
