/**
 * Verifies reputation: the counters, the score, the market average, and the fee.
 *
 *   npm run verify:reputation
 *
 * ================================= WARNING =================================
 * THIS WRITES TO THE PROJECT IN .env. It creates two accounts and one
 * commitment, drives every outcome event against them, and deletes all of it
 * again. Run it against a development project only. KEEP=1 leaves the data.
 * ===========================================================================
 *
 * WHAT IT PROVES, AND HOW
 * -----------------------
 * Reputation is written entirely by database triggers, so the only honest way
 * to test it is to do what the application does -- insert a row into
 * `commitment_events` -- and then read what the database decided. Nothing here
 * calls a reputation function directly except to compare its answer with the
 * stored one.
 *
 * The expected score is computed in JavaScript from the weights read out of
 * `market_settings`, independently of the SQL. Every rate divides by
 * `commitments_total`. If the two ever disagree, one of
 * them is wrong and the test says so -- which is the whole point, and is why
 * the weights are read rather than hardcoded.
 */

const url = process.env.PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !service || !anon) {
	console.error('PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and PUBLIC_SUPABASE_ANON_KEY must be set.');
	process.exit(1);
}

const svc = { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
	if (condition) {
		passed += 1;
		console.log(`  PASS  ${label}`);
	} else {
		failed += 1;
		console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
	}
}

const rest = (path, init = {}) =>
	fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers ?? {}) } });

async function insert(table, row, returning = 'id') {
	const response = await rest(`${table}?select=${returning}`, {
		method: 'POST',
		headers: { Prefer: 'return=representation' },
		body: JSON.stringify(row)
	});
	const body = await response.json();
	if (!response.ok) throw new Error(`insert ${table}: ${JSON.stringify(body)}`);
	return body[0];
}

const PASSWORD = 'rep-Verify-7781!';
const created = { users: [], listing: null, location: null, commitment: null };

async function makeUser(email, displayName) {
	await fetch(`${url}/auth/v1/admin/users`, {
		method: 'POST',
		headers: svc,
		body: JSON.stringify({
			email,
			password: PASSWORD,
			email_confirm: true,
			user_metadata: { display_name: displayName }
		})
	});

	const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
		method: 'POST',
		headers: { apikey: anon, 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password: PASSWORD })
	}).then((r) => r.json());

	if (!signIn.access_token) throw new Error(`sign in ${email}: ${JSON.stringify(signIn)}`);

	return { id: signIn.user.id, token: signIn.access_token, email };
}

/** The counters and the stored score for one profile. */
async function profileOf(id) {
	const rows = await rest(
		`profiles?id=eq.${id}&select=commitments_total,commitments_successful,commitments_cancelled,commitment_checkins,commitments_ignored,commitments_expired,commitments_stale,reputation,reputation_updated_at`
	).then((r) => r.json());

	return rows[0];
}

/** Calls a database function the way the Edge Functions do. */
async function rpc(name, args = {}) {
	const response = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
	const body = await response.json();
	if (!response.ok) throw new Error(`${name}: ${JSON.stringify(body)}`);
	return body;
}

/**
 * Sets counters and then scores them, which is the order the application
 * uses.
 *
 * The score used to follow a counter write automatically, through a BEFORE
 * trigger. That trigger is gone: counters and reputation now have one
 * explicit writer each, called in sequence by the Edge Function. A test that
 * only wrote the counters would be asserting the old design.
 */
async function setCounters(id, counters) {
	await rest(`profiles?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(counters) });
	await rpc('calculate_reputation', { target: id });
}

/**
 * Records an outcome exactly as the application does: the event, then the
 * counters it implies, then the score for whoever those counters moved.
 *
 * Mirrors `recordOutcome` in `supabase/functions/_shared/outcome.ts`. The
 * market recalculation is left to the caller, as it is there.
 */
async function emit(commitmentId, eventType, extra = {}) {
	const event = await insert('commitment_events', {
		commitment_id: commitmentId,
		event_type: eventType,
		...extra
	});

	const rescore = await rpc('apply_event_counters', {
		p_commitment_id: commitmentId,
		p_event_type: eventType
	});

	for (const profileId of rescore ?? []) {
		await rpc('calculate_reputation', { target: profileId });
	}

	return { event, rescore: rescore ?? [] };
}

async function settings() {
	const rows = await rest(
		'market_settings?id=eq.1&select=reputation_outcome_weight,reputation_checkin_weight,base_commitment_fee_cents,min_commitment_fee_cents,max_commitment_fee_cents,market_reputation,market_reputation_weight,adjusted_base_fee_cents'
	).then((r) => r.json());

	return rows[0];
}

/**
 * The formula, written independently of the SQL that implements it.
 *
 * Deliberately a second implementation. Comparing the database against a
 * restatement of the rule is what makes this a test rather than a tautology.
 */
function expectedScore(successful, cancelled, checkins, total, outcomeWeight, checkinWeight) {
	if (total === 0) return 1;

	const raw =
		1 +
		(successful / total) * outcomeWeight -
		(cancelled / total) * outcomeWeight +
		(checkins / total) * checkinWeight;

	/** Three decimals, matching `round(..., 3)` in `reputation_score`. */
	return Math.round(raw * 1000) / 1000;
}

async function cleanup() {
	if (process.env.KEEP === '1') {
		console.log('\nKEEP=1 -- test data left in place.');
		return;
	}
	if (created.commitment) await rest(`commitments?id=eq.${created.commitment}`, { method: 'DELETE' });
	if (created.listing) await rest(`listings?id=eq.${created.listing}`, { method: 'DELETE' });
	if (created.location) await rest(`meetup_locations?id=eq.${created.location}`, { method: 'DELETE' });
	for (const user of created.users) {
		await fetch(`${url}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: svc });
	}
	console.log('\nTest data removed.');
}

try {
	console.log('SETUP');

	const cfg = await settings();
	const outcomeWeight = Number(cfg.reputation_outcome_weight);
	const checkinWeight = Number(cfg.reputation_checkin_weight);
	console.log(`  weights: outcome ${outcomeWeight}, check-in ${checkinWeight}`);
	console.log(`  base fee: ${cfg.base_commitment_fee_cents}c, bounds ${cfg.min_commitment_fee_cents}-${cfg.max_commitment_fee_cents}c`);

	const seller = await makeUser('rep-seller@example.com', 'Rep Seller');
	const buyer = await makeUser('rep-buyer@example.com', 'Rep Buyer');
	created.users.push(seller, buyer);

	/** A brand-new account must score the formula's value for an empty record. */
	const fresh = await profileOf(buyer.id);
	check('a new account starts at 1.000', Number(fresh.reputation) === 1, String(fresh.reputation));
	check('a new account has no history', fresh.commitments_total === 0 && fresh.commitments_successful === 0,
		JSON.stringify(fresh));

	const location = await insert('meetup_locations', {
		profile_id: seller.id,
		name: 'Reputation test location',
		latitude: 49.2276,
		longitude: -123.0076
	});
	created.location = location.id;

	const listing = await insert('listings', {
		seller_id: seller.id,
		title: 'Reputation test item',
		price_cents: 4500,
		condition: 'used_good',
		status: 'active'
	});
	created.listing = listing.id;

	const commitment = await insert('commitments', {
		listing_id: listing.id,
		buyer_id: buyer.id,
		seller_id: seller.id,
		meetup_location_id: location.id,
		scheduled_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
		buyer_stake_cents: 200,
		seller_stake_cents: 200,
		status: 'pending'
	});
	created.commitment = commitment.id;

	console.log('\nCOUNTERS -- one event at a time');

	/**
	 * Each case states which counter should move, on whom, and asserts that
	 * NOBODY ELSE moved. A trigger that credits the wrong party is the failure
	 * mode that matters here, and only a before/after comparison of both
	 * profiles catches it.
	 */
	const cases = [
		['request_created', 'commitments_total', ['buyer', 'seller']],
		['buyer_checked_in', 'commitment_checkins', ['buyer']],
		['seller_checked_in', 'commitment_checkins', ['seller']],
		['meetup_verified', 'commitments_successful', ['buyer', 'seller']],
		['seller_declined', 'commitments_ignored', ['seller']],
		['buyer_cancelled', 'commitments_cancelled', ['buyer']],
		['seller_cancelled', 'commitments_cancelled', ['seller']],
		/**
		 * A no-show shares a counter with a cancellation: both are commitments
		 * the person broke themselves. Only the absent party is counted, which
		 * is why these assert one side each and not both.
		 */
		['buyer_no_show', 'commitments_cancelled', ['buyer']],
		['seller_no_show', 'commitments_cancelled', ['seller']],
		['commitment_stale', 'commitments_stale', ['buyer', 'seller']],
		['buyer_withdrew', null, []]
	];

	for (const [event, column, who] of cases) {
		const before = { buyer: await profileOf(buyer.id), seller: await profileOf(seller.id) };

		await emit(commitment.id, event);

		const after = { buyer: await profileOf(buyer.id), seller: await profileOf(seller.id) };

		const moved = [];
		for (const role of ['buyer', 'seller']) {
			for (const key of Object.keys(before[role])) {
				if (key.startsWith('reputation')) continue;
				if (before[role][key] !== after[role][key]) moved.push(`${role}.${key}`);
			}
		}

		const wanted = who.map((role) => `${role}.${column}`).sort();

		check(
			column === null
				? `${event} changes no counter`
				: `${event} increments ${column} for ${who.join(' and ')}`,
			JSON.stringify(moved.sort()) === JSON.stringify(wanted),
			`moved ${JSON.stringify(moved.sort())}, wanted ${JSON.stringify(wanted)}`
		);
	}

	/** request_expired hits two DIFFERENT counters on two different people. */
	{
		const before = { buyer: await profileOf(buyer.id), seller: await profileOf(seller.id) };
		await emit(commitment.id, 'request_expired');
		const after = { buyer: await profileOf(buyer.id), seller: await profileOf(seller.id) };

		check(
			"request_expired counts the buyer's expired and the seller's ignored",
			after.buyer.commitments_expired === before.buyer.commitments_expired + 1 &&
				after.seller.commitments_ignored === before.seller.commitments_ignored + 1 &&
				after.buyer.commitments_ignored === before.buyer.commitments_ignored &&
				after.seller.commitments_expired === before.seller.commitments_expired,
			JSON.stringify({ before, after })
		);
	}

	console.log('\nTHE SCORE');

	/**
	 * Counters set directly, so the score can be checked at inputs chosen to be
	 * awkward rather than whatever the event sequence above happened to leave.
	 *
	 * Writing the counters is not cheating: the trigger that scores them is the
	 * thing under test, and it fires on any statement targeting those columns
	 * whatever set them. The cases above already proved the events reach the
	 * right counters.
	 */
	const scoreCases = [
		{ label: 'no commitments at all', successful: 0, cancelled: 0, checkins: 0, total: 0 },
		{ label: 'a perfect record', successful: 10, cancelled: 0, checkins: 10, total: 10 },
		{ label: 'nothing but cancellations', successful: 0, cancelled: 7, checkins: 0, total: 7 },
		{ label: 'a mixed record', successful: 15, cancelled: 3, checkins: 15, total: 18 },
		{ label: 'one of each', successful: 1, cancelled: 1, checkins: 1, total: 2 },
		/** A rate that does not terminate in decimal, to pin the rounding. */
		{ label: 'a recurring rate (1/3)', successful: 1, cancelled: 2, checkins: 2, total: 3 },
		/**
		 * Dilution, which exists only under this denominator. Ten commitments
		 * taken part in, one of them successful -- a seller who declines almost
		 * everything. No penalty is applied; the rates simply fall.
		 */
		{ label: 'diluted by unresolved commitments', successful: 1, cancelled: 0, checkins: 1, total: 10 },
		/**
		 * Turned up every time and the other party kept abandoning the meetup:
		 * check-ins without successes. Under the old denominator this pushed the
		 * score above its nominal ceiling; against the total it cannot.
		 */
		{ label: 'check-ins without successes', successful: 0, cancelled: 0, checkins: 5, total: 5 }
	];

	for (const c of scoreCases) {
		await setCounters(buyer.id, {
			commitments_successful: c.successful,
			commitments_cancelled: c.cancelled,
			commitment_checkins: c.checkins,
			commitments_total: c.total
		});

		const stored = Number((await profileOf(buyer.id)).reputation);
		const expected = expectedScore(
			c.successful, c.cancelled, c.checkins, c.total, outcomeWeight, checkinWeight
		);

		check(
			`${c.label}: ${c.successful}/${c.cancelled}/${c.checkins} of ${c.total} scores ${expected.toFixed(3)}`,
			stored === expected,
			`stored ${stored}, expected ${expected}`
		);
	}

	/** `calculate_reputation` is the writer, and it stamps the row. */
	{
		const before = await profileOf(buyer.id);
		await setCounters(buyer.id, { commitments_successful: before.commitments_successful + 1 });
		const after = await profileOf(buyer.id);

		check(
			'calculate_reputation writes the new score',
			Number(after.reputation) !== Number(before.reputation),
			`${before.reputation} -> ${after.reputation}`
		);
		check(
			'reputation_updated_at is stamped',
			after.reputation_updated_at !== before.reputation_updated_at,
			String(after.reputation_updated_at)
		);
	}

	console.log('\nONE WRITER PER PIECE OF STATE');

	/**
	 * The point of the refactor. Each of these used to happen automatically
	 * through a trigger; each now has exactly one explicit writer, so nothing
	 * else may move it.
	 */
	{
		const before = await profileOf(buyer.id);

		/** A bare event insert, with no apply_event_counters call after it. */
		await insert('commitment_events', {
			commitment_id: commitment.id,
			event_type: 'meetup_verified'
		});

		const after = await profileOf(buyer.id);

		check(
			'an event insert alone moves no counter',
			after.commitments_successful === before.commitments_successful,
			`${before.commitments_successful} -> ${after.commitments_successful}`
		);
		check(
			'an event insert alone does not rescore',
			Number(after.reputation) === Number(before.reputation),
			`${before.reputation} -> ${after.reputation}`
		);
	}

	{
		const before = await profileOf(buyer.id);

		/** A bare counter write, with no calculate_reputation call after it. */
		await rest(`profiles?id=eq.${buyer.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ commitments_successful: before.commitments_successful + 3 })
		});

		const after = await profileOf(buyer.id);

		check(
			'a counter write alone does not rescore',
			Number(after.reputation) === Number(before.reputation),
			`${before.reputation} -> ${after.reputation}`
		);

		/** And the explicit call brings it back in step. */
		await rpc('calculate_reputation', { target: buyer.id });
		const scored = await profileOf(buyer.id);

		check(
			'calculate_reputation brings it back in step',
			Number(scored.reputation) !== Number(before.reputation),
			`${before.reputation} -> ${scored.reputation}`
		);
	}

	/**
	 * The counters that are recorded but deliberately NOT scored. A change to
	 * any of them must leave the score alone -- if one of these ever starts
	 * moving it, that is a silent repricing of everybody.
	 */
	for (const column of ['commitments_ignored', 'commitments_expired', 'commitments_stale']) {
		const before = await profileOf(buyer.id);
		await setCounters(buyer.id, { [column]: before[column] + 1 });
		const after = await profileOf(buyer.id);

		check(
			`${column} does not change the score`,
			Number(after.reputation) === Number(before.reputation),
			`${before.reputation} -> ${after.reputation}`
		);
	}

	/**
	 * The denominator is an input now, so changing it must re-score. Asserted
	 * in its own right because it is the one counter that changed sides in this
	 * revision -- it used to be tracked and nothing more.
	 */
	{
		await setCounters(buyer.id, {
			commitments_successful: 5,
			commitments_cancelled: 0,
			commitment_checkins: 5,
			commitments_total: 5
		});
		const tight = Number((await profileOf(buyer.id)).reputation);

		await setCounters(buyer.id, { commitments_total: 10 });
		const diluted = Number((await profileOf(buyer.id)).reputation);

		check(
			'commitments_total changes the score, and more of it dilutes',
			diluted < tight,
			`total 5 -> ${tight}, total 10 -> ${diluted}`
		);
	}

	console.log('\nMARKET REPUTATION');

	/**
	 * The market average is now the LAST explicit step, not a consequence of
	 * writing a score. These two assertions are a pair, and the first is the
	 * one that would catch a trigger creeping back in.
	 */
	{
		const before = (await settings()).market_reputation;

		await setCounters(buyer.id, {
			commitments_successful: 50,
			commitments_cancelled: 0,
			commitments_total: 50
		});

		const between = (await settings()).market_reputation;

		check(
			'a score change alone does not move the market average',
			Number(between) === Number(before),
			`${before} -> ${between} (a trigger is chaining this again)`
		);

		const recalculated = await rpc('recalculate_market');
		const after = (await settings()).market_reputation;

		check(
			'recalculate_market moves it',
			Number(after) !== Number(before),
			`${before} -> ${after}`
		);

		const row = Array.isArray(recalculated) ? recalculated[0] : recalculated;

		check(
			'it returns the average and the fee it produced',
			Number(row.market_reputation) === Number(after) &&
				Number(row.adjusted_base_fee_cents) ===
					Number((await settings()).adjusted_base_fee_cents),
			JSON.stringify(row)
		);
	}

	/** And it must equal the actual average of every stored score. */
	{
		await rpc('recalculate_market');
		const all = await rest('profiles?select=reputation').then((r) => r.json());
		const scores = all.map((row) => Number(row.reputation)).filter((n) => Number.isFinite(n));
		const average = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000;

		const stored = Number((await settings()).market_reputation);

		check(
			`market reputation is the average of all ${scores.length} scores`,
			Math.abs(stored - average) <= 0.001,
			`stored ${stored}, computed ${average}`
		);
	}

	console.log('\nTHE FEE');

	/**
	 * `commitment_fee_cents` is service-role only, which is correct -- a page
	 * must not be able to ask what someone else would pay. Called here with the
	 * service key because that is exactly what the Edge Functions do.
	 */
	const feeFor = async (profileId) => {
		const response = await rest('rpc/commitment_fee_cents', {
			method: 'POST',
			body: JSON.stringify({ target: profileId })
		});
		const body = await response.json();
		if (!response.ok) throw new Error(`commitment_fee_cents: ${JSON.stringify(body)}`);
		return Number(body);
	};

	/** The adjusted base, read from the database. */
	const adjustedBase = async () => {
		const response = await rest('rpc/adjusted_base_fee_cents', { method: 'POST', body: '{}' });
		const body = await response.json();
		if (!response.ok) throw new Error(`adjusted_base_fee_cents: ${JSON.stringify(body)}`);
		return Number(body);
	};

	/**
	 * THE MARKET HALF, restated independently:
	 *
	 *   adjustment = (1.000 - market_reputation) * market_reputation_weight
	 *   adjusted   = round(base * (1 + adjustment))
	 *
	 * Read fresh, because the test's own profiles move the market average
	 * while it runs -- which is itself the behaviour being relied on.
	 */
	{
		const cfg2 = await settings();
		const base = Number(cfg2.base_commitment_fee_cents);
		const market = Number(cfg2.market_reputation);
		const weight = Number(cfg2.market_reputation_weight);

		const expected = Math.max(Math.round(base * (1 + (1 - market) * weight)), 1);

		check(
			'the adjusted base is base * (1 + (1 - market reputation) * weight)',
			(await adjustedBase()) === expected,
			`got ${await adjustedBase()}, expected ${expected} (base ${base}, market ${market}, weight ${weight})`
		);

		/** 1.000 is the neutral point: an average market leaves the base alone. */
		check(
			market > 1
				? 'a market above 1.000 reduces the base fee'
				: market < 1
					? 'a market below 1.000 raises the base fee'
					: 'a market at exactly 1.000 leaves the base fee alone',
			market > 1 ? expected < base : market < 1 ? expected > base : expected === base,
			`market ${market}, base ${base}, adjusted ${expected}`
		);
	}

	/** THE INDIVIDUAL HALF: the adjusted base divided by your own score. */
	{
		const cfg2 = await settings();
		const mine = Number((await profileOf(buyer.id)).reputation);
		const adjusted = await adjustedBase();

		const expected = Math.min(
			Math.max(
				Math.round(adjusted / Math.max(mine, 0.001)),
				Number(cfg2.min_commitment_fee_cents)
			),
			Number(cfg2.max_commitment_fee_cents)
		);

		check(
			'the fee is the adjusted base / your reputation, clamped',
			(await feeFor(buyer.id)) === expected,
			`got ${await feeFor(buyer.id)}, expected ${expected} (adjusted ${adjusted}, mine ${mine})`
		);
	}

	/**
	 * The DIRECTION is the part worth protecting. The arithmetic above would
	 * pass just as happily if the formula multiplied by reputation instead of
	 * dividing -- which is the mistake that was in the code until now, in the
	 * market term. A better record must cost less.
	 */
	{
		await setCounters(buyer.id, {
			commitments_successful: 20,
			commitments_cancelled: 0,
			commitment_checkins: 20,
			commitments_total: 20
		});
		await rpc('recalculate_market');
		const reliable = { reputation: Number((await profileOf(buyer.id)).reputation), fee: await feeFor(buyer.id) };

		await setCounters(buyer.id, {
			commitments_successful: 0,
			commitments_cancelled: 20,
			commitment_checkins: 0,
			commitments_total: 20
		});
		await rpc('recalculate_market');
		const unreliable = { reputation: Number((await profileOf(buyer.id)).reputation), fee: await feeFor(buyer.id) };

		check(
			'a better record scores higher',
			reliable.reputation > unreliable.reputation,
			`${reliable.reputation} vs ${unreliable.reputation}`
		);
		check(
			'a better record stakes less',
			reliable.fee < unreliable.fee,
			`${reliable.fee}c vs ${unreliable.fee}c -- if reversed, the fee is multiplying where it should divide`
		);
	}

	/** A reputation of 0.001 would otherwise ask for a fortune; the ceiling holds. */
	{
		const cfg3 = await settings();
		await rest(`profiles?id=eq.${buyer.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ reputation: 0.001 })
		});

		const fee = await feeFor(buyer.id);

		check(
			'the ceiling bounds an extreme reputation',
			fee === Number(cfg3.max_commitment_fee_cents),
			`${fee}c, ceiling ${cfg3.max_commitment_fee_cents}c`
		);
	}

	console.log('\nTHE BREAKDOWN SHOWN ON /account');

	/**
	 * Called with the USER's token, because `my_reputation_breakdown` resolves
	 * the profile from `auth.uid()`. That is also what makes it safe to expose:
	 * there is no argument to point at somebody else.
	 */
	const breakdownAs = async (user) => {
		const response = await fetch(`${url}/rest/v1/rpc/my_reputation_breakdown`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${user.token}`, apikey: anon, 'Content-Type': 'application/json' },
			body: '{}'
		});
		const body = await response.json();
		if (!response.ok) throw new Error(`my_reputation_breakdown: ${JSON.stringify(body)}`);
		return Array.isArray(body) ? body[0] : body;
	};

	{
		await setCounters(buyer.id, {
			commitments_successful: 15,
			commitments_cancelled: 3,
			commitment_checkins: 15,
			commitments_total: 20
		});

		const b = await breakdownAs(buyer);
		const profile = await profileOf(buyer.id);

		check('the breakdown reports the caller\'s own counters',
			b.successful === 15 && b.cancelled === 3 && b.checkins === 15, JSON.stringify(b));

		check('it reports the total it divided by', b.total === 20, String(b.total));

		check('the rates are the counters over the total',
			Math.abs(Number(b.success_rate) - 15 / 20) < 1e-4 &&
				Math.abs(Number(b.cancel_rate) - 3 / 20) < 1e-4 &&
				Math.abs(Number(b.checkin_rate) - 15 / 20) < 1e-4,
			JSON.stringify([b.success_rate, b.cancel_rate, b.checkin_rate]));

		check('it reports the weights actually in force',
			Number(b.outcome_weight) === outcomeWeight && Number(b.checkin_weight) === checkinWeight,
			JSON.stringify([b.outcome_weight, b.checkin_weight]));

		/**
		 * THE ASSERTION THE PANEL RESTS ON. The page shows each contribution as
		 * a line of working and the score as the total. If the parts do not add
		 * up to the number beside them, the explanation is worse than no
		 * explanation.
		 */
		const sum =
			1 + Number(b.success_points) - Number(b.cancel_points) + Number(b.checkin_points);

		check('the parts add up to the score it displays',
			Math.round(sum * 1000) / 1000 === Number(b.reputation),
			`parts sum to ${sum}, score is ${b.reputation}`);

		check('the score matches the stored one',
			Number(b.reputation) === Number(profile.reputation),
			`${b.reputation} vs ${profile.reputation}`);

		check('the fee matches what the Edge Functions would charge',
			Number(b.fee_cents) === (await feeFor(buyer.id)),
			`${b.fee_cents} vs ${await feeFor(buyer.id)}`);
	}

	/** With no history, the rates are null rather than a 0% that reads as judgement. */
	{
		await setCounters(buyer.id, {
			commitments_successful: 0,
			commitments_cancelled: 0,
			commitment_checkins: 0,
			commitments_total: 0
		});

		const b = await breakdownAs(buyer);

		check('with no history the rates are null, not zero',
			b.success_rate === null && b.cancel_rate === null && b.checkin_rate === null,
			JSON.stringify([b.success_rate, b.cancel_rate, b.checkin_rate]));

		check('with no history the score is the starting 1.000',
			Number(b.reputation) === 1, String(b.reputation));
	}

	/** Two users get their own numbers, not each other's. */
	{
		await setCounters(seller.id, {
			commitments_successful: 4,
			commitments_cancelled: 1,
			commitment_checkins: 4,
			commitments_total: 5
		});

		const asBuyer = await breakdownAs(buyer);
		const asSeller = await breakdownAs(seller);

		check('the breakdown is scoped to whoever asked',
			asBuyer.successful === 0 && asSeller.successful === 4,
			`buyer ${asBuyer.successful}, seller ${asSeller.successful}`);
	}
} catch (cause) {
	failed += 1;
	console.error('\nABORTED:', cause.message);
} finally {
	await cleanup();
	console.log(`\n${passed} passed, ${failed} failed.`);
	process.exit(failed > 0 ? 1 : 0);
}
