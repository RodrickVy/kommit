/**
 * Verifies the commitment lifecycle functions against the LINKED PROJECT.
 *
 *   npm run verify:commitments
 *
 * ================================= WARNING =================================
 * THIS WRITES TO THE PROJECT IN .env. It creates three accounts, a listing, a
 * meetup location and several commitments, exercises every function against
 * them, and deletes all of it again. Run it against a development project
 * only. Set KEEP=1 to leave the data in place for inspection.
 * ===========================================================================
 *
 * WHAT IT CAN AND CANNOT PROVE
 * ----------------------------
 * It covers authorisation, preconditions, the QR token lifecycle, the geographic
 * validation, the no-show and stale verdicts, and idempotency. It does NOT
 * prove that SOL moves, because devnet wallets here hold none.
 *
 * That absence is used deliberately rather than worked around: with an empty
 * treasury every settlement must fail, so the script asserts that the
 * functions SAY SO — that a completed meetup reports `buyer_refunded: false`
 * instead of claiming the stake is back. Those are the assertions that matter
 * most, and a funded wallet would hide them.
 *
 * Once the Main Wallet and two user wallets hold devnet SOL, the same script
 * should be extended with the transfer assertions: stake locked, stake
 * returned, forfeit landing in the charity wallet, purchase arriving in the
 * seller's wallet.
 *
 * The commitment inserts go through `insertCommitment`, which exists only to
 * get around the insert trigger's lead-time rule — see the comment there.
 */

const url = process.env.PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY;

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

/** Calls an Edge Function as a given access token. */
async function call(name, token, body) {
	const response = await fetch(`${url}/functions/v1/${name}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body ?? {})
	});
	const text = await response.text();
	let payload;
	try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
	return { status: response.status, code: payload?.error?.code ?? null, payload };
}

/** Creates a confirmed account and returns its id plus an access token. */
async function makeUser(email, password, displayName) {
	await fetch(`${url}/auth/v1/admin/users`, {
		method: 'POST',
		headers: svc,
		body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: displayName } })
	});

	const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
		method: 'POST',
		headers: { apikey: anon, 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password })
	}).then((r) => r.json());

	if (!signIn.access_token) throw new Error(`sign in ${email}: ${JSON.stringify(signIn)}`);

	return { id: signIn.user.id, token: signIn.access_token, email };
}

/**
 * Inserts a commitment at whatever time the test needs.
 *
 * `set_commitment_request_expiry` rejects an insert whose meetup is less than
 * `minimum_acceptance_lead_hours` away — correct for real requests, and in the
 * way here, where the point is to test what happens at and after the meetup.
 * The row goes in with a legal future time and is then moved; the trigger is
 * BEFORE INSERT only, so the update is not re-checked.
 */
async function insertCommitment(row) {
	const { scheduled_at, request_expires_at, ...rest_of_row } = row;

	const inserted = await insert('commitments', {
		...rest_of_row,
		scheduled_at: new Date(Date.now() + 48 * 3600_000).toISOString()
	});

	const moved = { scheduled_at };
	if (request_expires_at) moved.request_expires_at = request_expires_at;

	await rest(`commitments?id=eq.${inserted.id}`, {
		method: 'PATCH',
		body: JSON.stringify(moved)
	});

	return inserted;
}

const PASSWORD = 'e2e-Verify-9134!';
const LOCATION = { latitude: 49.2276, longitude: -123.0076 };

const created = { users: [], listing: null, location: null, commitment: null };

async function cleanup() {
	if (process.env.KEEP === '1') {
		console.log('\nKEEP=1 — test data left in place.');
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

	const seller = await makeUser('e2e-seller@example.com', PASSWORD, 'E2E Seller');
	const buyer = await makeUser('e2e-buyer@example.com', PASSWORD, 'E2E Buyer');
	const outsider = await makeUser('e2e-outsider@example.com', PASSWORD, 'E2E Outsider');
	created.users.push(seller, buyer, outsider);

	for (const user of [seller, buyer, outsider]) {
		const wallet = await call('create_wallet/create_user_wallet', service, { profile_id: user.id });
		check(`wallet for ${user.email}`, wallet.status === 200, JSON.stringify(wallet.payload));
	}

	const location = await insert('meetup_locations', {
		profile_id: seller.id,
		name: 'Metrotown, main entrance',
		...LOCATION
	});
	created.location = location.id;

	const listing = await insert('listings', {
		seller_id: seller.id,
		title: 'E2E test item',
		price_cents: 4500,
		condition: 'used_good',
		status: 'active'
	});
	created.listing = listing.id;

	/**
	 * Inserted already accepted, with stake lamports set, because taking the
	 * stakes for real needs funded wallets. Everything downstream of acceptance
	 * is what this script exists to verify.
	 */
	const scheduled = new Date(Date.now() + 10 * 60_000).toISOString();

	const commitment = await insertCommitment({
		listing_id: listing.id,
		buyer_id: buyer.id,
		seller_id: seller.id,
		meetup_location_id: location.id,
		scheduled_at: scheduled,
		buyer_stake_cents: 1000,
		seller_stake_cents: 1000,
		buyer_stake_lamports: 40000,
		seller_stake_lamports: 40000,
		status: 'accepted',
		accepted_at: new Date().toISOString()
	});
	created.commitment = commitment.id;
	console.log(`  commitment ${commitment.id}`);

	console.log('\n7. check_in');

	const far = await call('check_in', buyer.token, {
		commitment_id: commitment.id,
		latitude: 49.2827,
		longitude: -123.1207
	});
	check('refuses a position outside the radius', far.code === 'OUTSIDE_RADIUS', JSON.stringify(far.payload));
	check('reports the distance', typeof far.payload?.error?.details?.distance_metres === 'number',
		JSON.stringify(far.payload?.error?.details));

	const noFix = await call('check_in', buyer.token, { commitment_id: commitment.id, latitude: null, longitude: null });
	check('distinguishes a missing location from being far away', noFix.code === 'LOCATION_UNAVAILABLE', noFix.code);

	const nonsense = await call('check_in', buyer.token, { commitment_id: commitment.id, latitude: 999, longitude: 0 });
	check('rejects an impossible coordinate', nonsense.code === 'LOCATION_UNAVAILABLE', nonsense.code);

	const stranger = await call('check_in', outsider.token, { commitment_id: commitment.id, ...LOCATION });
	check('refuses someone else\'s commitment', stranger.code === 'UNAUTHORIZED', stranger.code);

	const buyerIn = await call('check_in', buyer.token, { commitment_id: commitment.id, ...LOCATION });
	check('accepts the buyer at the location', buyerIn.payload?.verified === true, JSON.stringify(buyerIn.payload));
	check('does not claim both are present yet', buyerIn.payload?.both_checked_in === false, String(buyerIn.payload?.both_checked_in));
	check('sets the deadline for the other party', typeof buyerIn.payload?.deadline === 'string', String(buyerIn.payload?.deadline));

	const buyerAgain = await call('check_in', buyer.token, { commitment_id: commitment.id, ...LOCATION });
	check('a repeat check-in is not an error', buyerAgain.payload?.already_checked_in === true, JSON.stringify(buyerAgain.payload));

	console.log('\n8. create_commitment_qr');

	const buyerQr = await call('create_commitment_qr', buyer.token, { commitment_id: commitment.id });
	check('only the seller may issue QR #1', buyerQr.code === 'UNAUTHORIZED', buyerQr.code);

	const tooEarly = await call('create_commitment_qr', seller.token, { commitment_id: commitment.id });
	check('refuses before both have checked in', tooEarly.code === 'AWAITING_OTHER_PARTY', tooEarly.code);

	const sellerIn = await call('check_in', seller.token, { commitment_id: commitment.id, ...LOCATION });
	check('accepts the seller at the location', sellerIn.payload?.verified === true, JSON.stringify(sellerIn.payload));
	check('now reports both present', sellerIn.payload?.both_checked_in === true, String(sellerIn.payload?.both_checked_in));

	const firstQr = await call('create_commitment_qr', seller.token, { commitment_id: commitment.id });
	check('issues a token once both are checked in', typeof firstQr.payload?.token === 'string', JSON.stringify(firstQr.payload));
	check('returns a relative path, not an absolute URL', firstQr.payload?.path?.startsWith('/commitment/'), String(firstQr.payload?.path));
	check('the response carries no key material', !JSON.stringify(firstQr.payload).includes('secret'), '');

	const secondQr = await call('create_commitment_qr', seller.token, { commitment_id: commitment.id });
	check('refreshing issues a different token', secondQr.payload?.token !== firstQr.payload?.token, '');

	const liveTokens = await rest(
		`qr_tokens?commitment_id=eq.${commitment.id}&purpose=eq.meetup_verification&consumed_at=is.null&revoked_at=is.null&select=id`
	).then((r) => r.json());
	check('only one token stays live after a refresh', liveTokens.length === 1, `${liveTokens.length} live`);

	const stored = await rest(`qr_tokens?commitment_id=eq.${commitment.id}&select=token_hash`).then((r) => r.json());
	check('the raw token is never stored', !stored.some((row) => row.token_hash === firstQr.payload.token), '');

	console.log('\n9. complete_commitment');

	const sellerComplete = await call('complete_commitment', seller.token, {
		commitment_id: commitment.id,
		token: secondQr.payload.token
	});
	check('the seller cannot complete their own meetup', sellerComplete.code === 'UNAUTHORIZED', sellerComplete.code);

	const revoked = await call('complete_commitment', buyer.token, {
		commitment_id: commitment.id,
		token: firstQr.payload.token
	});
	check('a replaced token no longer works', revoked.code === 'QR_EXPIRED', revoked.code);

	const garbage = await call('complete_commitment', buyer.token, {
		commitment_id: commitment.id,
		token: 'not-a-real-token-but-long-enough'
	});
	check('an unknown token is refused', garbage.code === 'QR_INVALID', garbage.code);

	const completed = await call('complete_commitment', buyer.token, {
		commitment_id: commitment.id,
		token: secondQr.payload.token
	});
	check('completes with a valid token', completed.payload?.status === 'completed', JSON.stringify(completed.payload));

	/**
	 * The Main Wallet is empty, so both refunds must fail — and the function
	 * must say so rather than claiming the stakes are back. This is the
	 * assertion that matters most in the whole script.
	 */
	check('does not claim the buyer was refunded from an empty treasury',
		completed.payload?.buyer_refunded === false, String(completed.payload?.buyer_refunded));
	check('does not claim the seller was refunded either',
		completed.payload?.seller_refunded === false, String(completed.payload?.seller_refunded));
	check('says the refunds are still processing',
		/still processing/.test(completed.payload?.message ?? ''), completed.payload?.message);

	const replay = await call('complete_commitment', buyer.token, {
		commitment_id: commitment.id,
		token: secondQr.payload.token
	});
	check('a second scan reports success, not a used-code error',
		replay.payload?.already_completed === true, JSON.stringify(replay.payload));

	const verifications = await rest(`meetup_verifications?commitment_id=eq.${commitment.id}&select=id`).then((r) => r.json());
	check('exactly one verification row exists', verifications.length === 1, `${verifications.length} rows`);

	console.log('\n10. create_payment_qr');

	const buyerPayQr = await call('create_payment_qr', buyer.token, { commitment_id: commitment.id });
	check('only the seller may issue QR #2', buyerPayQr.code === 'UNAUTHORIZED', buyerPayQr.code);

	const payQr = await call('create_payment_qr', seller.token, { commitment_id: commitment.id });
	check('issues a purchase token after verification', typeof payQr.payload?.token === 'string', JSON.stringify(payQr.payload));
	check('the purchase path differs from the meetup path', payQr.payload?.path?.includes('/pay?'), String(payQr.payload?.path));

	console.log('\n11. pay_commitment');

	const crossPurpose = await call('pay_commitment', buyer.token, {
		commitment_id: commitment.id,
		token: secondQr.payload.token,
		confirm: true
	});
	check('a meetup token cannot be used to pay', crossPurpose.code === 'QR_INVALID', crossPurpose.code);

	const quote = await call('pay_commitment', buyer.token, {
		commitment_id: commitment.id,
		token: payQr.payload.token
	});
	check('quotes without charging', quote.payload?.quote === true, JSON.stringify(quote.payload));
	check('quotes the listing price, not a value from the request',
		quote.payload?.amount_cents === 4500, String(quote.payload?.amount_cents));
	check('converts to a positive lamport amount', quote.payload?.amount_lamports > 0, String(quote.payload?.amount_lamports));
	check('names the rate source', ['coingecko', 'configured'].includes(quote.payload?.rate_source), String(quote.payload?.rate_source));
	check('reports that the buyer cannot afford it', quote.payload?.sufficient === false, String(quote.payload?.sufficient));

	const unsent = await rest(`payments?commitment_id=eq.${commitment.id}&select=id`).then((r) => r.json());
	check('a quote writes no payment row', unsent.length === 0, `${unsent.length} rows`);

	const strangerPay = await call('pay_commitment', outsider.token, {
		commitment_id: commitment.id,
		token: payQr.payload.token,
		confirm: true
	});
	check('another user scanning the code cannot pay', strangerPay.code === 'UNAUTHORIZED', strangerPay.code);

	const attempt = await call('pay_commitment', buyer.token, {
		commitment_id: commitment.id,
		token: payQr.payload.token,
		confirm: true
	});
	check('refuses the payment for insufficient funds', attempt.code === 'INSUFFICIENT_FUNDS', attempt.code);

	const afterFail = await rest(`payments?commitment_id=eq.${commitment.id}&select=status`).then((r) => r.json());
	check('a failed payment is recorded as failed, not pending',
		afterFail.length === 1 && afterFail[0].status === 'failed', JSON.stringify(afterFail));

	const tokenAfterFail = await rest(
		`qr_tokens?commitment_id=eq.${commitment.id}&purpose=eq.purchase&select=consumed_at`
	).then((r) => r.json());
	check('the purchase code survives a failed payment, so it can be retried',
		tokenAfterFail.every((row) => row.consumed_at === null), JSON.stringify(tokenAfterFail));

	const listingAfter = await rest(`listings?id=eq.${listing.id}&select=status`).then((r) => r.json());
	check('the listing is not marked sold when payment failed',
		listingAfter[0]?.status !== 'sold', listingAfter[0]?.status);

	console.log('\n12. process_commitments');

	const asUser = await call('process_commitments', buyer.token);
	check('an ordinary user cannot run the resolver', asUser.code === 'UNAUTHORIZED', asUser.code);

	const run = await call('process_commitments', service);
	check('runs for the service role', run.status === 200, JSON.stringify(run.payload).slice(0, 200));
	check('reports the settlements it could not pay',
		run.payload?.settlements_outstanding >= 1, String(run.payload?.settlements_outstanding));

	const reconciled = (run.payload?.outcomes ?? []).find(
		(outcome) => outcome.commitment_id === created.commitment
	);
	check('retried this commitment\'s outstanding refunds',
		Boolean(reconciled) && reconciled.failed.length === 2, JSON.stringify(reconciled));

	const rerun = await call('process_commitments', service);
	check('a second run is safe and finds the same work, not new work',
		rerun.payload?.resolved === 0, String(rerun.payload?.resolved));

	console.log('\nEXPIRY AND NO-SHOW VERDICTS');

	/** A pending request already past its deadline. */
	const ignoredSlot = new Date(Date.now() + 6 * 3600_000).toISOString();

	const ignored = await insertCommitment({
		listing_id: listing.id,
		buyer_id: buyer.id,
		seller_id: seller.id,
		meetup_location_id: location.id,
		scheduled_at: ignoredSlot,
		buyer_stake_cents: 1000,
		seller_stake_cents: 1000,
		buyer_stake_lamports: 40000,
		status: 'pending',
		request_expires_at: new Date(Date.now() - 3600_000).toISOString()
	});

	const expiryRun = await call('process_commitments', service);
	check('expires a request the seller never answered', expiryRun.payload?.expired >= 1, String(expiryRun.payload?.expired));

	const expiredRow = await rest(`commitments?id=eq.${ignored.id}&select=status`).then((r) => r.json());
	check('the request is marked expired', expiredRow[0]?.status === 'expired', expiredRow[0]?.status);

	const expiryEvent = await rest(
		`commitment_events?commitment_id=eq.${ignored.id}&event_type=eq.request_expired&select=metadata`
	).then((r) => r.json());
	check('records that the seller ignored it', expiryEvent[0]?.metadata?.ignored_by === 'seller', JSON.stringify(expiryEvent));

	await rest(`commitments?id=eq.${ignored.id}`, { method: 'DELETE' });

	/** Seller turned up, buyer did not, and the window has closed. */
	const noShowSlot = new Date(Date.now() - 4 * 3600_000).toISOString();

	const noShow = await insertCommitment({
		listing_id: listing.id,
		buyer_id: buyer.id,
		seller_id: seller.id,
		meetup_location_id: location.id,
		scheduled_at: noShowSlot,
		buyer_stake_cents: 1000,
		seller_stake_cents: 1000,
		buyer_stake_lamports: 40000,
		seller_stake_lamports: 40000,
		status: 'accepted',
		seller_checked_in_at: noShowSlot,
		check_in_window_ends_at: new Date(Date.now() - 3 * 3600_000).toISOString()
	});

	const noShowRun = await call('process_commitments', service);
	check('resolves an overdue commitment', noShowRun.payload?.resolved >= 1, String(noShowRun.payload?.resolved));

	const noShowRow = await rest(`commitments?id=eq.${noShow.id}&select=status,responsible_party`).then((r) => r.json());
	check('records it as a no-show', noShowRow[0]?.status === 'no_show', noShowRow[0]?.status);
	check('blames the party who did not arrive', noShowRow[0]?.responsible_party === 'buyer', noShowRow[0]?.responsible_party);

	await rest(`commitments?id=eq.${noShow.id}`, { method: 'DELETE' });

	/** Neither turned up: nobody can fairly be blamed. */
	const staleSlot = new Date(Date.now() - 4 * 3600_000).toISOString();

	const stale = await insertCommitment({
		listing_id: listing.id,
		buyer_id: buyer.id,
		seller_id: seller.id,
		meetup_location_id: location.id,
		scheduled_at: staleSlot,
		buyer_stake_cents: 1000,
		seller_stake_cents: 1000,
		buyer_stake_lamports: 40000,
		seller_stake_lamports: 40000,
		status: 'accepted'
	});

	await call('process_commitments', service);

	const staleRow = await rest(`commitments?id=eq.${stale.id}&select=status,responsible_party`).then((r) => r.json());
	check('marks it stale when neither party checked in', staleRow[0]?.status === 'stale', staleRow[0]?.status);
	check('blames nobody for a stale commitment', staleRow[0]?.responsible_party === null, String(staleRow[0]?.responsible_party));

	await rest(`commitments?id=eq.${stale.id}`, { method: 'DELETE' });
} catch (cause) {
	failed += 1;
	console.error('\nABORTED:', cause.message);
} finally {
	await cleanup();
	console.log(`\n${passed} passed, ${failed} failed.`);
	process.exit(failed > 0 ? 1 : 0);
}
