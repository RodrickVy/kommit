import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2.117.0';

/**
 * Recording an outcome, and everything derived from it, in a stated order.
 *
 * Every commitment flow ends the same way: an event is recorded, counters
 * move, the affected scores are recalculated, and the marketplace reprices.
 * That used to happen through a chain of database triggers hanging off the
 * event INSERT. It worked, but the order was implicit and a failure anywhere
 * surfaced as one error on the insert with nothing to say which step produced
 * it.
 *
 * Now the steps are explicit, sequential, and logged:
 *
 *   1. event        insert the commitment_event
 *   2. counters     apply_event_counters, which returns whose score moved
 *   3. reputation   calculate_reputation for exactly those profiles
 *   4. market       recalculate_market, one UPDATE to market_settings
 *
 * CALLED ONLY AFTER THE CORE ACTION HAS SUCCEEDED, and it NEVER THROWS.
 *
 * That second part is the important one. By the time this runs, money has
 * moved and a commitment has changed state. If recalculating a reputation
 * fails, the caller must not unwind any of that, must not retry the transfer,
 * and must not return an error that invites the user to try again — they would
 * be charged twice and the commitment accepted twice. So every failure here is
 * captured and reported in the result for the caller to log, never raised.
 *
 * IDEMPOTENCY IS THE CALLER'S, NOT THIS FUNCTION'S. Counters increment once
 * per call, so calling this twice for one logical event double-counts. Each
 * flow guards that with a compare-and-set on the thing it owns — a status
 * transition, a consumed QR token, an already-recorded check-in — and only
 * calls this once it has won that claim.
 */

export type EventType =
	| 'request_created'
	| 'seller_accepted'
	| 'seller_declined'
	| 'buyer_withdrew'
	| 'request_expired'
	| 'buyer_cancelled'
	| 'seller_cancelled'
	| 'buyer_checked_in'
	| 'seller_checked_in'
	| 'buyer_no_show'
	| 'seller_no_show'
	| 'meetup_verified'
	| 'commitment_stale'
	| 'commitment_completed'
	| 'purchase_completed';

export interface OutcomeInput {
	readonly commitmentId: string;
	readonly eventType: EventType;
	/** Null for system events such as expiry, where no person acted. */
	readonly actorId?: string | null;
	readonly actorRole?: 'buyer' | 'seller' | null;
	readonly metadata?: Record<string, unknown> | null;

	/**
	 * Skips step 4 so a batch can reprice once at the end instead of once per
	 * commitment. `process_commitments` resolves many in a run, and each
	 * market recalculation is a write to `market_settings` and a row in its
	 * history — fifty of them for one run would be forty-nine writes recording
	 * nothing anybody chose.
	 */
	readonly deferMarket?: boolean;
}

export interface OutcomeResult {
	readonly eventId: string | null;
	/** Profiles whose score was recalculated. Empty is normal and not a failure. */
	readonly rescored: readonly string[];
	readonly marketReputation: number | null;
	readonly baseFeeCents: number | null;
	/** The step that failed, or null. The core action is unaffected either way. */
	readonly failedAt: 'event' | 'counters' | 'reputation' | 'market' | null;
	readonly failure: string | null;
}

/** One line per write, so a failure names its step instead of being guessed at. */
export function logStep(fn: string, step: string, detail?: unknown): void {
	console.log(`[${fn}] step=${step}`, detail === undefined ? '' : JSON.stringify(detail));
}

export async function recordOutcome(
	db: SupabaseClient,
	fn: string,
	input: OutcomeInput
): Promise<OutcomeResult> {
	const base = {
		eventId: null,
		rescored: [] as string[],
		marketReputation: null,
		baseFeeCents: null
	};

	/** 1. The event. Its snapshot columns are filled by a BEFORE trigger. */
	const inserted = await db
		.from('commitment_events')
		.insert({
			commitment_id: input.commitmentId,
			event_type: input.eventType,
			actor_profile_id: input.actorId ?? null,
			actor_role: input.actorRole ?? null,
			metadata: input.metadata ?? null
		})
		.select('id')
		.single<{ id: string }>();

	if (inserted.error) {
		console.error(`[${fn}] step=event FAILED`, inserted.error);
		return { ...base, failedAt: 'event', failure: inserted.error.message };
	}

	const eventId = inserted.data.id;
	logStep(fn, 'event', { eventId, type: input.eventType });

	/** 2. Counters, which report whose score actually moved. */
	const counted = await db.rpc('apply_event_counters', {
		p_commitment_id: input.commitmentId,
		p_event_type: input.eventType
	});

	if (counted.error) {
		console.error(`[${fn}] step=counters FAILED`, counted.error);
		return { ...base, eventId, failedAt: 'counters', failure: counted.error.message };
	}

	const rescore: string[] = Array.isArray(counted.data) ? counted.data : [];
	logStep(fn, 'counters', { rescore: rescore.length });

	/**
	 * 3. Reputation, for exactly the profiles whose scoring counters moved.
	 *
	 * Sequential rather than parallel: both parties can be in the list, and two
	 * concurrent UPDATEs to `profiles` rows that a later statement will average
	 * together is a race worth not having for the sake of one round trip.
	 */
	for (const profileId of rescore) {
		const scored = await db.rpc('calculate_reputation', { target: profileId });

		if (scored.error) {
			console.error(`[${fn}] step=reputation FAILED`, { profileId, error: scored.error });
			return {
				...base,
				eventId,
				rescored: rescore,
				failedAt: 'reputation',
				failure: scored.error.message
			};
		}
	}

	if (rescore.length > 0) logStep(fn, 'reputation', { profiles: rescore.length });

	/**
	 * 4. The market average and the base fee it implies.
	 *
	 * Skipped when nobody's score moved: the average cannot have changed, and
	 * the call would write nothing while still costing a round trip.
	 */
	if (input.deferMarket || rescore.length === 0) {
		return { ...base, eventId, rescored: rescore, failedAt: null, failure: null };
	}

	const market = await recalculateMarket(db, fn);

	if (!market.ok) {
		return { ...base, eventId, rescored: rescore, failedAt: 'market', failure: market.failure };
	}

	return {
		eventId,
		rescored: rescore,
		marketReputation: market.marketReputation,
		baseFeeCents: market.baseFeeCents,
		failedAt: null,
		failure: null
	};
}

/**
 * Step 4 on its own, for a batch that defers it.
 *
 * `process_commitments` resolves many commitments in one run and calls this
 * once at the end, so the settings row is written once rather than once per
 * commitment.
 */
export async function recalculateMarket(
	db: SupabaseClient,
	fn: string
): Promise<
	| { ok: true; marketReputation: number | null; baseFeeCents: number | null }
	| { ok: false; failure: string }
> {
	const { data, error } = await db.rpc('recalculate_market').maybeSingle<{
		market_reputation: number | null;
		adjusted_base_fee_cents: number | null;
	}>();

	if (error) {
		console.error(`[${fn}] step=market FAILED`, error);
		return { ok: false, failure: error.message };
	}

	const marketReputation = data?.market_reputation ?? null;
	const baseFeeCents = data?.adjusted_base_fee_cents ?? null;

	logStep(fn, 'market', { marketReputation, baseFeeCents });

	return { ok: true, marketReputation, baseFeeCents };
}
