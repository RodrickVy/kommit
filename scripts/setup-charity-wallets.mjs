/**
 * Gives every charity a wallet, and skips the ones that already have one.
 *
 *   npm run setup:charity-wallets
 *
 * A SETUP STEP, run by an operator with the service role. There is deliberately
 * no public path to this: the three charities are seeded by migration with
 * fixed ids, so wallet creation is a one-off, and an endpoint that minted
 * custodial keypairs for arbitrary charity ids would be a way to make the
 * service generate keys on demand with nobody attributable.
 *
 * IDEMPOTENT, twice over. It only asks for charities that have no wallet, and
 * `create_wallet` itself returns the existing wallet rather than creating a
 * second one. Safe to run again after adding a charity through /admin.
 *
 * A charity's wallet address must never change once it exists. It is recorded
 * on every forfeit transaction, so replacing it would leave donations sitting
 * at an address nothing points at any more.
 */

const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
	console.error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env.');
	process.exit(1);
}

const headers = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };

/**
 * Charities, with their wallet address where one exists.
 *
 * Read in one request rather than once per charity, so the two halves cannot
 * disagree.
 *
 * The relation arrives as a single OBJECT, not an array, because
 * `wallets.charity_id` is unique — PostgREST therefore knows a charity has at
 * most one wallet. Indexing it as a list yields undefined, which reads as "no
 * wallet yet" and would make this call the function for every charity on every
 * run.
 */
const charities = await fetch(
	`${url}/rest/v1/charities?select=id,short_name,name,wallets(solana_address)&order=name`,
	{ headers }
).then((response) => response.json());

if (!Array.isArray(charities)) {
	console.error('Could not read charities:', JSON.stringify(charities));
	process.exit(1);
}

let created = 0;
let present = 0;
let failed = 0;

for (const charity of charities) {
	const label = charity.short_name ?? charity.name;
	const existing = charity.wallets?.solana_address;

	if (existing) {
		console.log(`- ${label} already has ${existing}`);
		present += 1;
		continue;
	}

	const response = await fetch(`${url}/functions/v1/create_wallet/create_charity_wallet`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ charity_id: charity.id })
	});

	const payload = await response.json();

	if (!response.ok) {
		console.error(`FAILED ${label}: ${payload?.error?.message ?? response.status}`);
		failed += 1;
		continue;
	}

	/**
	 * `created` comes from the function, not from the status code. It answers
	 * 200 whether it made a wallet or found one, so counting responses would
	 * report work that never happened.
	 */
	if (payload.created) {
		console.log(`NEW  ${label} ${payload.solana_address}`);
		created += 1;
	} else {
		console.log(`- ${label} already has ${payload.solana_address}`);
		present += 1;
	}
}

console.log(`\n${created} created, ${present} already present, ${failed} failed.`);

if (failed > 0) process.exit(1);
