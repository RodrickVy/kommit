/**
 * Verifies the two /stats series: bucketing, carry-forward, counts and guards.
 *
 *   npm run verify:stats
 *
 * ================================= WARNING =================================
 * THIS WRITES TO THE PROJECT IN .env. It creates two accounts, a listing and
 * one commitment, records an event against them, and deletes all of it again.
 * Run it against a development project only.
 * ===========================================================================
 *
 * The guard assertions are the ones that matter most. Both functions build
 * their buckets with generate_series, so an unbounded window is not a slow
 * query but a way to exhaust the database from a public page's query string.
 * The guards were originally written as a CTE, which Postgres is free to
 * evaluate after the generate_series -- these tests are what caught it.
 */
const url = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };
const rest = (p, i = {}) => fetch(`${url}/rest/v1/${p}`, { ...i, headers: { ...h, ...(i.headers ?? {}) } });

let pass = 0, fail = 0;
const check = (label, ok, detail = '') => {
	if (ok) { pass++; console.log(`  PASS  ${label}`); }
	else { fail++; console.log(`  FAIL  ${label}${detail ? ' -- ' + detail : ''}`); }
};

const call = async (fn, body) => {
	const r = await rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
	return { status: r.status, body: await r.json() };
};

async function ins(table, row) {
	const r = await rest(`${table}?select=*`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
	const b = await r.json();
	if (!r.ok) throw new Error(`${table}: ${JSON.stringify(b)}`);
	return b[0];
}

const mk = async (email) => {
	await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: h, body: JSON.stringify({ email, password: 'Ser-5523!', email_confirm: true, user_metadata: { display_name: email } }) });
	const u = await (await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers: h })).json();
	return u.users.find((x) => x.email === email).id;
};

const ids = [];
try {
	console.log('GUARDS');

	const bad = await call('market_price_series', { bucket: 'fortnight', from_at: new Date(Date.now() - 3600_000).toISOString(), to_at: new Date().toISOString() });
	check('an unknown bucket unit is refused with a useful message',
		bad.status >= 400 && /second, minute, hour, day, week/.test(JSON.stringify(bad.body)), JSON.stringify(bad.body).slice(0, 150));

	const huge = await call('market_price_series', { bucket: 'second', from_at: new Date(Date.now() - 365 * 86400_000).toISOString(), to_at: new Date().toISOString() });
	check('a window too large for the bucket is refused, not attempted',
		huge.status >= 400 && /exceeds the limit/.test(JSON.stringify(huge.body)), JSON.stringify(huge.body).slice(0, 150));

	const backwards = await call('market_price_series', { bucket: 'hour', from_at: new Date().toISOString(), to_at: new Date(Date.now() - 3600_000).toISOString() });
	check('a reversed window is refused', backwards.status >= 400, String(backwards.status));

	console.log('\nBUCKETING AT EVERY GRANULARITY');

	const to = new Date().toISOString();
	for (const [bucket, ms, expected] of [
		['second', 60_000, 61],
		['minute', 20 * 60_000, 21],
		['hour', 6 * 3600_000, 7],
		['day', 7 * 86400_000, 8],
		['week', 28 * 86400_000, 5]
	]) {
		const r = await call('market_price_series', { bucket, from_at: new Date(Date.now() - ms).toISOString(), to_at: to });
		check(`${bucket}: returns a continuous grid (${r.body.length} rows)`,
			r.status === 200 && Math.abs(r.body.length - expected) <= 1, `status ${r.status}, rows ${r.body?.length}`);
	}

	console.log('\nA REAL EVENT SHOWS UP IN ITS BUCKET');

	const sellerId = await mk('ser-s@example.com');
	const buyerId = await mk('ser-b@example.com');
	ids.push(sellerId, buyerId);

	const loc = await ins('meetup_locations', { profile_id: sellerId, name: 'ser', latitude: 49.2, longitude: -123 });
	const lst = await ins('listings', { seller_id: sellerId, title: 'ser', price_cents: 1000, condition: 'used_good', status: 'active' });
	const cmt = await ins('commitments', {
		listing_id: lst.id, buyer_id: buyerId, seller_id: sellerId, meetup_location_id: loc.id,
		scheduled_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
		buyer_stake_cents: 200, seller_stake_cents: 200, status: 'accepted'
	});

	const ev = await ins('commitment_events', { commitment_id: cmt.id, event_type: 'buyer_cancelled', actor_profile_id: buyerId, actor_role: 'buyer' });
	check('the event carries a fee snapshot', ev.market_base_fee_cents !== null, String(ev.market_base_fee_cents));

	const minutes = await call('market_price_series', { bucket: 'minute', from_at: new Date(Date.now() - 5 * 60_000).toISOString(), to_at: new Date().toISOString() });
	const counted = minutes.body.reduce((n, row) => n + row.event_count, 0);
	check('event_count picks it up', counted >= 1, `counted ${counted}`);

	const withFee = minutes.body.filter((r) => r.close_fee_cents !== null);
	check('the close price is populated across the window', withFee.length === minutes.body.length, `${withFee.length}/${minutes.body.length}`);

	const last = minutes.body.at(-1);
	const live = Number((await (await rest('market_settings?id=eq.1&select=adjusted_base_fee_cents')).json())[0].adjusted_base_fee_cents);
	check('the final bucket closes at the live price', Number(last.close_fee_cents) === live, `${last.close_fee_cents} vs ${live}`);

	console.log('\nCHARITY DONATIONS');

	const don = await call('charity_donation_series', { bucket: 'day', from_at: new Date(Date.now() - 7 * 86400_000).toISOString(), to_at: new Date().toISOString() });
	check('the donation series returns a continuous grid', don.status === 200 && don.body.length >= 7, `status ${don.status}, rows ${don.body?.length}`);
	check('empty buckets are zero, not null', don.body.every((r) => r.lamports !== null && r.donation_count !== null), JSON.stringify(don.body.slice(0, 2)));
	check('the cumulative total never decreases',
		don.body.every((r, i, a) => i === 0 || Number(r.cumulative_lamports) >= Number(a[i - 1].cumulative_lamports)),
		JSON.stringify(don.body.map((r) => r.cumulative_lamports)));

	const donBad = await call('charity_donation_series', { bucket: 'century', from_at: new Date(Date.now() - 3600_000).toISOString(), to_at: new Date().toISOString() });
	check('it shares the same bucket guard', donBad.status >= 400, String(donBad.status));

	await rest(`commitments?id=eq.${cmt.id}`, { method: 'DELETE' });
	await rest(`listings?id=eq.${lst.id}`, { method: 'DELETE' });
	await rest(`meetup_locations?id=eq.${loc.id}`, { method: 'DELETE' });
} finally {
	for (const id of ids) await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: h });
	console.log(`\n${pass} passed, ${fail} failed.`);
	process.exit(fail > 0 ? 1 : 0);
}
