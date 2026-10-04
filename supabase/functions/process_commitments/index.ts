import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { privilegedCaller } from '../_shared/privileged.ts';
import { meetupDay } from '../_shared/meetup_day.ts';
import { settleStake, type Party, type SettlementType } from '../_shared/stake.ts';

/**
 * process_commitments — the single scheduled resolver.
 *
 *   POST /process_commitments        (service role, or an admin)
 *
 * ONE function rather than one endpoint per timeout. Every automatic outcome
 * is a deadline that passed with nobody acting, and they share the same
 * reasoning about evidence and fault — split across five endpoints, the fifth
 * would eventually disagree with the first about who was responsible.
 *
 * WHAT IT DECIDES
 * ---------------
 *   a request nobody answered      -> Expired.    Buyer refunded.
 *   one checked in, one did not    -> No-Show.    The absent party forfeits,
 *                                                the one who turned up is
 *                                                refunded.
 *   neither checked in             -> Stale.      Both refunded.
 *   both checked in, no QR #1      -> Stale.      Both refunded.
 *
 * Stale is the verdict when fault cannot be assigned fairly. Nobody is
 * penalised for a situation the evidence cannot explain — guessing would mean
 * donating a stranger's money to charity on a hunch.
 *
 * IT MUST BE SAFE TO RUN TWICE, and that is structural rather than careful:
 *
 *   * every status change is a compare-and-set, so a second run finds nothing
 *     left to claim
 *   * every settlement goes through `settle_stake`, whose idempotency key
 *     names the commitment, the party and the outcome — a replay returns the
 *     original transfer and moves nothing
 *
 * It also RECONCILES. A settlement that failed during a live request (a
 * decline, a cancellation, a completion) is retried here, which is what makes
 * those functions free to report a partial failure honestly instead of having
 * to unwind money.
 */

/** Bounds one run. A backlog is worked through over successive runs rather than in one long request. */
const BATCH_LIMIT = 200;

/** How far back reconciliation looks. Long enough to cover an outage, short enough to stay cheap. */
const RECONCILE_DAYS = 7;

type Db = ReturnType<typeof serviceClient>;

interface Settlement {
	readonly role: Party;
	readonly settlement: SettlementType;
}

interface Outcome {
	readonly commitment_id: string;
	readonly resolution: string;
	readonly settled: readonly string[];
	readonly failed: readonly string[];
}

/**
 * Applies the settlements an outcome requires, and reports each one.
 *
 * Attempted independently: one party's transfer failing must not prevent the
 * other's, and a failure here is recoverable because the next run will retry
 * it under the same key.
 */
async function settleAll(
	db: Db,
	commitmentId: string,
	settlements: readonly Settlement[]
): Promise<{ settled: string[]; failed: string[] }> {
	const settled: string[] = [];
	const failed: string[] = [];

	for (const { role, settlement } of settlements) {
		const result = await settleStake(db, commitmentId, role, settlement);

		if (result.ok) {
			settled.push(`${role}:${settlement}`);
		} else {
			/**
			 * NOTHING_STAKED is not a failure. A seller who declined never staked,
			 * and a request whose transfer failed has nothing held — in both cases
			 * there is correctly nothing to settle.
			 */
			if (result.code === 'NOTHING_STAKED') continue;

			failed.push(`${role}:${settlement} (${result.code})`);
			console.error(`[process_commitments] ${commitmentId} ${role}:${settlement}`, result);
		}
	}

	return { settled, failed };
}

/**
 * The settlements each resolved status is supposed to have produced.
 *
 * Declared once, here, and used for both resolving and reconciling — so the
 * retry path cannot drift from the original intent, which is precisely how a
 * reconciler ends up paying somebody twice or not at all.
 */
function expectedSettlements(
	status: string,
	responsibleParty: Party | null
): readonly Settlement[] {
	const refundBoth: readonly Settlement[] = [
		{ role: 'buyer', settlement: 'refund' },
		{ role: 'seller', settlement: 'refund' }
	];

	switch (status) {
		/** The meetup happened. Both stakes come back. */
		case 'completed':
			return refundBoth;

		/** Fault cannot be assigned, so nobody is penalised. */
		case 'stale':
			return refundBoth;

		/** Only the buyer ever staked on an unaccepted request. */
		case 'declined':
		case 'expired':
			return [{ role: 'buyer', settlement: 'refund' }];

		/** Whoever was responsible forfeits; the other is made whole. */
		case 'cancelled':
		case 'no_show': {
			if (!responsibleParty) return refundBoth;

			const other: Party = responsibleParty === 'buyer' ? 'seller' : 'buyer';

			return [
				{ role: other, settlement: 'refund' },
				{ role: responsibleParty, settlement: 'forfeit' }
			];
		}

		default:
			return [];
	}
}

/**
 * Requests the seller never answered.
 *
 * Declining promptly costs a seller nothing, so ignoring a request entirely is
 * the behaviour this records. The buyer gets their stake back in full — they
 * did everything asked of them and got no answer.
 */
async function resolveExpiredRequests(db: Db): Promise<Outcome[]> {
	const { data: candidates } = await db
		.from('commitments')
		.select('id')
		.eq('status', 'pending')
		.lte('request_expires_at', new Date().toISOString())
		.limit(BATCH_LIMIT);

	const outcomes: Outcome[] = [];

	for (const candidate of candidates ?? []) {
		/**
		 * Compare-and-set. A seller accepting at the same moment as this run
		 * wins or loses cleanly — whoever changes the row first — and the loser
		 * does nothing rather than resolving a commitment that moved on.
		 */
		const claimed = await db
			.from('commitments')
			.update({ status: 'expired' })
			.eq('id', candidate.id)
			.eq('status', 'pending')
			.select('id');

		if (claimed.error || (claimed.data?.length ?? 0) === 0) continue;

		/**
		 * `actor_profile_id` null: nobody acted. That is the whole content of
		 * the event — a deadline passed in silence.
		 *
		 * The seller's part is recorded in metadata rather than in
		 * `responsible_party`, which the schema restricts to `cancelled` and
		 * `no_show`. Ignoring a request is not a no-show; nothing was ever
		 * agreed. The reputation service reads these events and owns the
		 * counters on `profiles`.
		 */
		await db.from('commitment_events').insert({
			commitment_id: candidate.id,
			event_type: 'request_expired',
			metadata: { ignored_by: 'seller' }
		});

		const result = await settleAll(db, candidate.id, [{ role: 'buyer', settlement: 'refund' }]);

		outcomes.push({ commitment_id: candidate.id, resolution: 'expired', ...result });
	}

	return outcomes;
}

interface AcceptedRow {
	id: string;
	scheduled_at: string;
	check_in_window_ends_at: string | null;
	buyer_checked_in_at: string | null;
	seller_checked_in_at: string | null;
	meetup_verified_at: string | null;
}

interface Verdict {
	readonly status: 'no_show' | 'stale';
	readonly responsibleParty: Party | null;
	readonly resolution: string;
}

/**
 * Decides what an overdue accepted commitment has become, or null if it is not
 * overdue yet.
 *
 * Pure, and separated from the writing, because this is the only part worth
 * reasoning about carefully — the rest is bookkeeping.
 */
function verdictFor(commitment: AcceptedRow, now: number): Verdict | null {
	const buyerIn = commitment.buyer_checked_in_at;
	const sellerIn = commitment.seller_checked_in_at;

	/** Already verified: completion handles it, not this. */
	if (commitment.meetup_verified_at) return null;

	/**
	 * Everyone has the whole meetup day to check in and verify. Nothing is
	 * decided until that day is over.
	 */
	if (now < meetupDay(commitment.scheduled_at).end.getTime()) return null;

	/** Nobody turned up. Nothing distinguishes the two, so nobody is blamed. */
	if (!buyerIn && !sellerIn) {
		return { status: 'stale', responsibleParty: null, resolution: 'stale_no_check_ins' };
	}

	/** One of them turned up and the other never did that day. */
	if (!buyerIn || !sellerIn) {
		const absent: Party = buyerIn ? 'seller' : 'buyer';
		return { status: 'no_show', responsibleParty: absent, resolution: `no_show_${absent}` };
	}

	/**
	 * BOTH checked in but QR #1 was never scanned. Stale, not a no-show: both
	 * have location evidence that they were there, so neither can fairly be
	 * called absent.
	 */
	return { status: 'stale', responsibleParty: null, resolution: 'stale_not_verified' };
}

/** Applies `verdictFor` to every accepted commitment whose time has come. */
async function resolveOverdueCommitments(db: Db): Promise<Outcome[]> {
	const now = Date.now();

	/**
	 * Only commitments whose scheduled time has passed can be overdue, so that
	 * filter does the bulk of the narrowing in the database. The remaining
	 * decision needs four columns compared against each other, which is
	 * clearer in code than as a SQL expression nobody will want to edit.
	 */
	const { data: candidates } = await db
		.from('commitments')
		.select(
			'id, scheduled_at, check_in_window_ends_at, buyer_checked_in_at, seller_checked_in_at, meetup_verified_at'
		)
		.eq('status', 'accepted')
		.lte('scheduled_at', new Date(now).toISOString())
		.order('scheduled_at', { ascending: true })
		.limit(BATCH_LIMIT)
		.returns<AcceptedRow[]>();

	const outcomes: Outcome[] = [];

	for (const candidate of candidates ?? []) {
		const verdict = verdictFor(candidate, now);
		if (!verdict) continue;

		const claimed = await db
			.from('commitments')
			.update({
				status: verdict.status,
				responsible_party: verdict.responsibleParty,
				completed_at: new Date().toISOString()
			})
			.eq('id', candidate.id)
			.eq('status', 'accepted')
			.select('id');

		if (claimed.error || (claimed.data?.length ?? 0) === 0) {
			/**
			 * Someone cancelled, or completed the meetup, in the moment between
			 * the read and the write. Their resolution stands.
			 */
			continue;
		}

		if (verdict.status === 'no_show') {
			await db.from('commitment_events').insert({
				commitment_id: candidate.id,
				event_type: verdict.responsibleParty === 'buyer' ? 'buyer_no_show' : 'seller_no_show',
				actor_role: verdict.responsibleParty
			});
		} else {
			await db.from('commitment_events').insert({
				commitment_id: candidate.id,
				event_type: 'commitment_stale',
				metadata: { reason: verdict.resolution }
			});
		}

		const result = await settleAll(
			db,
			candidate.id,
			expectedSettlements(verdict.status, verdict.responsibleParty)
		);

		outcomes.push({ commitment_id: candidate.id, resolution: verdict.resolution, ...result });
	}

	return outcomes;
}

/**
 * Retries settlements that were supposed to have happened and did not.
 *
 * This is what lets `respond_to_commitment`, `cancel_commitment` and
 * `complete_commitment` say "the refund is still processing" truthfully
 * instead of either lying or attempting to unwind money inside an
 * already-failing request.
 *
 * It decides what to retry from `wallet_transactions`: a settlement is
 * outstanding when no COMPLETED row exists for its idempotency key. Calling
 * `settle_stake` again is then safe by construction — a completed transfer
 * replays and moves nothing, a failed one is retried, and one still pending is
 * refused as in-flight.
 */
async function reconcileSettlements(db: Db): Promise<Outcome[]> {
	const since = new Date(Date.now() - RECONCILE_DAYS * 86_400_000).toISOString();

	const { data: resolved } = await db
		.from('commitments')
		.select('id, status, responsible_party, buyer_stake_lamports, seller_stake_lamports')
		.in('status', ['completed', 'stale', 'no_show', 'cancelled', 'declined', 'expired'])
		.gte('created_at', since)
		.limit(BATCH_LIMIT)
		.returns<
			{
				id: string;
				status: string;
				responsible_party: Party | null;
				buyer_stake_lamports: number | null;
				seller_stake_lamports: number | null;
			}[]
		>();

	const outcomes: Outcome[] = [];

	for (const commitment of resolved ?? []) {
		const expected = expectedSettlements(commitment.status, commitment.responsible_party).filter(
			/** A party with nothing held has nothing to settle. */
			({ role }) =>
				role === 'buyer'
					? commitment.buyer_stake_lamports !== null
					: commitment.seller_stake_lamports !== null
		);

		if (expected.length === 0) continue;

		const keys = expected.map(
			({ role, settlement }) => `commitment:${commitment.id}:${role}:${settlement}`
		);

		const { data: done } = await db
			.from('wallet_transactions')
			.select('idempotency_key')
			.in('idempotency_key', keys)
			.eq('status', 'completed')
			.returns<{ idempotency_key: string }[]>();

		const complete = new Set((done ?? []).map((row) => row.idempotency_key));

		const outstanding = expected.filter(
			({ role, settlement }) =>
				!complete.has(`commitment:${commitment.id}:${role}:${settlement}`)
		);

		if (outstanding.length === 0) continue;

		const result = await settleAll(db, commitment.id, outstanding);

		/** Only reported when something actually changed, to keep a quiet run quiet. */
		if (result.settled.length > 0 || result.failed.length > 0) {
			outcomes.push({
				commitment_id: commitment.id,
				resolution: `reconciled_${commitment.status}`,
				...result
			});
		}
	}

	return outcomes;
}

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const db = serviceClient();

	/**
	 * Not reachable by an ordinary user. It resolves other people's
	 * commitments and moves their stakes, so the only legitimate callers are
	 * the scheduler holding the service key and an administrator running it by
	 * hand.
	 */
	const caller = await privilegedCaller(request, db, await callerId(request));

	if (!caller) {
		return fail('UNAUTHORIZED', 'This is a scheduled operation and requires elevated access.', 403);
	}

	try {
		/**
		 * Sequential, not parallel. The three phases read and write the same
		 * rows, and running them concurrently would mean two of them racing to
		 * claim one commitment — survivable, because of the compare-and-sets,
		 * but it would make a run's output impossible to read.
		 */
		const expired = await resolveExpiredRequests(db);
		const overdue = await resolveOverdueCommitments(db);
		const reconciled = await reconcileSettlements(db);

		/** Listings whose post-meetup purchase window lapsed without payment. */
		const { data: released, error: releaseError } = await db.rpc('release_purchase_holds');
		if (releaseError) console.error('[process_commitments] holds not released', releaseError);

		const outcomes = [...expired, ...overdue, ...reconciled];
		const failures = outcomes.filter((outcome) => outcome.failed.length > 0);

		if (failures.length > 0) {
			console.error('[process_commitments] settlements outstanding', failures);
		}

		return json({
			ran_at: new Date().toISOString(),
			run_by: caller.adminId ?? 'service_role',
			expired: expired.length,
			resolved: overdue.length,
			reconciled: reconciled.length,
			listings_released: released ?? 0,

			/**
			 * Reported rather than hidden behind a 200. A run that resolved ten
			 * commitments and could not pay three of them is not a success, and a
			 * scheduler watching only the status code would never know.
			 */
			settlements_outstanding: failures.length,
			outcomes
		});
	} catch (error) {
		console.error('[process_commitments]', error);
		return fail('INTERNAL', 'The scheduled run did not complete.', 500);
	}
});
