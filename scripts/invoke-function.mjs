/**
 * Invokes an Edge Function with the project's service role key.
 *
 *   node --env-file=.env scripts/invoke-function.mjs <name> ['<json body>']
 *
 * FOR OPERATOR USE ONLY. The service role bypasses Row Level Security
 * entirely, so this is the right tool for setup and scheduled work and the
 * wrong tool for anything a user could do for themselves — those paths must go
 * through the app, with the user's own session, so the function can tell who is
 * asking.
 *
 * Exists because several functions are deliberately unreachable from the UI:
 * `setup_platform_wallet` creates the treasury, `process_commitments` resolves
 * other people's commitments. Neither should have a button.
 */

const [name, rawBody] = process.argv.slice(2);

if (!name) {
	console.error('Usage: node --env-file=.env scripts/invoke-function.mjs <name> [json]');
	process.exit(1);
}

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
	console.error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env.');
	process.exit(1);
}

/** Validated here so a typo in the body is reported before the call, not as a 400. */
let body = '{}';

if (rawBody) {
	try {
		body = JSON.stringify(JSON.parse(rawBody));
	} catch {
		console.error(`The body is not valid JSON: ${rawBody}`);
		process.exit(1);
	}
}

const response = await fetch(`${url}/functions/v1/${name}`, {
	method: 'POST',
	headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
	body
});

const text = await response.text();

/** Pretty-printed when it parses, raw when it does not — a gateway error page is still worth seeing. */
try {
	console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
	console.log(text);
}

/** A non-2xx exits non-zero so a scheduler or CI step actually notices. */
if (!response.ok) process.exit(1);
