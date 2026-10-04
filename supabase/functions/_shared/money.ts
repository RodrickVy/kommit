import { LAMPORTS_PER_SOL } from './solana.ts';

/**
 * Converting between what a user is quoted and what actually moves.
 *
 * Commitment stakes are denominated in CAD, that is the number shown before
 * someone commits, and the number they decide against. SOL is what leaves the
 * wallet. These are the only two functions allowed to cross between them, so
 * the rate is applied in one place and the rounding rule is stated once.
 */

/**
 * Converts a CAD amount into lamports at the configured rate.
 *
 * @param cents         CAD minor units, a $10 stake is 1000.
 * @param solPriceCents Cents per 1 SOL, from `market_settings`.
 * @returns Whole lamports, never less than 1: a transfer of nothing is not a
 *          transfer.
 *
 * Rounds UP, deliberately. Rounding down would shave a fraction of a lamport
 * off every stake, and since the treasury refunds exactly what it received,
 * that shortfall would accumulate as dust belonging to users but held by the
 * platform. Rounding up costs the staker at most one lamport, a billionth of
 * a SOL, and keeps any imbalance on the side that cannot harm anyone.
 */
export function cadCentsToLamports(cents: number, solPriceCents: number): number {
	if (!Number.isFinite(cents) || cents <= 0) {
		throw new Error('A stake must be a positive amount.');
	}

	if (!Number.isFinite(solPriceCents) || solPriceCents <= 0) {
		throw new Error('market_settings.sol_price_cents must be a positive number.');
	}

	return Math.max(1, Math.ceil((cents / solPriceCents) * LAMPORTS_PER_SOL));
}

/**
 * Converts lamports to CAD cents for display beside a balance.
 *
 * DISPLAY ONLY. Never use it to decide an amount to transfer: the rate is a
 * configured value an admin can change, so a round trip through CAD and back
 * would not return the lamports you started with. That is exactly why a
 * settled stake refunds its recorded lamports rather than reconverting.
 */
export function lamportsToCadCents(lamports: number, solPriceCents: number): number {
	return Math.round((lamports / LAMPORTS_PER_SOL) * solPriceCents);
}
