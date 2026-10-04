import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2.117.0';

/**
 * The SOL price used to turn a listing's CAD price into lamports.
 *
 * WHY THIS EXISTS SEPARATELY FROM `market_settings.sol_price_cents`
 * ----------------------------------------------------------------
 * That column is a number an admin typed, and it is documented as display
 * only, fine for showing "about $42" beside a balance, wrong for deciding an
 * amount of money to move. Stakes avoid the problem entirely by recording the
 * exact lamports they transferred, so a refund never reconverts.
 *
 * A purchase cannot avoid it. The seller priced the item in dollars and the
 * buyer agreed to a dollar figure, so something has to convert at the moment
 * the buyer taps Pay. Doing that at a stale configured rate would mean the
 * seller receives an amount of SOL that has nothing to do with the price they
 * set.
 *
 * So a live quote is fetched, and the configured value becomes the fallback
 * for when it cannot be. The rate used and its source are both recorded on the
 * payment row, because a price that looks wrong a month later is unanswerable
 * otherwise.
 *
 * THIS IS STILL NOT A SETTLEMENT-GRADE PRICE FEED. One public endpoint, no
 * signing, no second opinion. Before real money it needs at least a second
 * source and a staleness bound; what makes it tolerable today is that devnet
 * SOL is worth nothing, and that the figure the buyer confirms is the dollar
 * price either way.
 */

export interface SolRate {
	readonly centsPerSol: number;
	/** `coingecko` or `configured`. Recorded so a past conversion can be explained. */
	readonly source: 'coingecko' | 'configured';
	readonly currencyCode: string;
}

/**
 * Plausibility bounds on a fetched quote, in cents per SOL.
 *
 * ABSOLUTE, not relative to the configured value. The configured value is
 * stale by design, so rejecting a quote for differing from it would reject
 * exactly the real market moves this function exists to follow. These bounds
 * only catch the failure that matters: a parse or API change that yields a
 * number which is not a price at all.
 */
const MIN_PLAUSIBLE_CENTS = 100; // $1
const MAX_PLAUSIBLE_CENTS = 10_000_000; // $100,000

/**
 * A quote has to arrive quickly or not at all.
 *
 * This runs with the buyer's thumb on the button at a meetup. Four seconds is
 * already a long pause; beyond that the stale configured rate is the better
 * answer, because an abandoned purchase is worse than a slightly off rate on a
 * devnet transfer.
 */
const QUOTE_TIMEOUT_MS = 4_000;

async function fetchLiveRate(currencyCode: string): Promise<number | null> {
	const currency = currencyCode.toLowerCase();

	try {
		const response = await fetch(
			`https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=${currency}`,
			{ signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS), headers: { accept: 'application/json' } }
		);

		if (!response.ok) {
			console.warn(`[sol_rate] quote endpoint returned ${response.status}`);
			return null;
		}

		const payload = (await response.json()) as { solana?: Record<string, unknown> };
		const quoted = payload.solana?.[currency];

		if (typeof quoted !== 'number' || !Number.isFinite(quoted) || quoted <= 0) {
			console.warn('[sol_rate] quote did not contain a usable number');
			return null;
		}

		const cents = Math.round(quoted * 100);

		if (cents < MIN_PLAUSIBLE_CENTS || cents > MAX_PLAUSIBLE_CENTS) {
			console.warn(`[sol_rate] quote of ${cents} cents per SOL is outside plausible bounds`);
			return null;
		}

		return cents;
	} catch (cause) {
		/**
		 * Swallowed on purpose: an unreachable price endpoint must not fail a
		 * purchase, and the fallback below is a real answer rather than a guess.
		 * Logged so a persistent outage is visible.
		 */
		console.warn('[sol_rate] live quote unavailable', cause);
		return null;
	}
}

/**
 * Resolves the rate to convert a CAD price at, preferring a live quote.
 *
 * @returns Never null. Market settings always hold a usable configured value,
 *          so there is no state in which a price cannot be determined.
 */
export async function getSolRate(db: SupabaseClient): Promise<SolRate | null> {
	const { data } = await db
		.from('market_settings')
		.select('sol_price_cents, currency_code')
		.eq('id', 1)
		.maybeSingle<{ sol_price_cents: number; currency_code: string }>();

	if (!data) return null;

	const live = await fetchLiveRate(data.currency_code);

	return live === null
		? { centsPerSol: data.sol_price_cents, source: 'configured', currencyCode: data.currency_code }
		: { centsPerSol: live, source: 'coingecko', currencyCode: data.currency_code };
}
