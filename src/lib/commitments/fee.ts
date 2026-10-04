/**
 * The commitment fee, broken into the steps that produced it.
 *
 * Shared rather than declared per consumer. It is read by a server load
 * (`#lib/server/request-options`), forwarded through a client component
 * (`RequestDialog`) and rendered by another (`RequestPanel`) — three places
 * that must agree about the shape, and did not when each kept its own copy.
 *
 * It lives here, outside `#lib/server`, because SvelteKit refuses a
 * server-only import from client code: a component cannot import a type from
 * a module that also reaches the database.
 *
 * EVERY FIGURE IS COMPUTED IN THE DATABASE. `my_commitment_fee()` returns all
 * of them, from the same two functions the Edge Functions call to take the
 * stake — `adjusted_base_fee_cents()` and `commitment_fee_cents()`. Nothing in
 * the browser or in a load function recalculates a fee, so the number on the
 * button is the number charged rather than one that merely agrees with it
 * today.
 */
export interface CommitmentFee {
	/** The marketplace-wide base, before any adjustment. Nobody pays exactly this. */
	readonly baseFeeCents: number;

	/** Average reputation across all members. 1.000 is the neutral point. */
	readonly marketReputation: number;

	/** How hard the market average pulls the base fee. */
	readonly marketReputationWeight: number;

	/**
	 * `(1.000 − marketReputation) × marketReputationWeight`.
	 *
	 * Positive when the market is below neutral, which makes stakes dearer;
	 * negative when it is above, which makes them cheaper.
	 */
	readonly marketAdjustment: number;

	/**
	 * The base after the market adjustment — what a member of exactly average
	 * reliability puts down. This, not `baseFeeCents`, is the figure an
	 * individual's reputation should be compared against.
	 */
	readonly adjustedBaseFeeCents: number;

	/** This person's own score, which divides the adjusted base. */
	readonly reputation: number;

	/** What they actually put down, held between the configured floor and ceiling. */
	readonly feeCents: number;
}
