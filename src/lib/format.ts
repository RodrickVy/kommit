/**
 * Display formatting shared across the app.
 */

/**
 * Formats an amount of CAD cents for display.
 *
 * @param cents Integer minor units, as every money value is stored.
 * @returns e.g. `$45.00`
 */
export function formatPrice(cents: number): string {
	/**
	 * The division to dollars happens here and nowhere else, at the very edge
	 * of the system. Everything upstream, the database, the ledger, the
	 * arithmetic, stays in integer cents, because floating point cannot
	 * represent `0.1 + 0.2` exactly and money must never be approximate.
	 *
	 * It is safe at this one point because the result is immediately rendered
	 * to a string and never calculated with.
	 */
	return new Intl.NumberFormat('en-CA', {
		style: 'currency',
		currency: 'CAD'
	}).format(cents / 100);
}

/**
 * Parses a price typed by a person into integer cents.
 *
 * Accepts `45`, `45.5`, `45.50`, `$45.50` and `1,045.50`.
 *
 * @param input Raw text from a form field.
 * @returns The amount in cents, or `null` if it is not a valid price.
 */
export function parsePriceToCents(input: string): number | null {
	/** Strip the things people type that are not part of the number. */
	const cleaned = input.trim().replace(/[$,\s]/g, '');

	if (cleaned === '') return null;

	/** At most two decimal places, a third would silently be rounded away. */
	if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

	/**
	 * Split on the decimal point and work in integers rather than multiplying a
	 * float by 100. `45.70 * 100` is `4569.999...` in binary floating point,
	 * which truncates to 4569, one cent lost, silently, on a perfectly
	 * ordinary price.
	 */
	const [whole = '0', fraction = ''] = cleaned.split('.');
	const cents = fraction.padEnd(2, '0').slice(0, 2);

	const total = Number(whole) * 100 + Number(cents);

	return Number.isSafeInteger(total) ? total : null;
}

/**
 * Formats a timestamp as a short, readable date.
 *
 * @param iso An ISO 8601 timestamp from the database.
 */
export function formatDate(iso: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	}).format(new Date(iso));
}

/**
 * Formats a Postgres `time` value for display.
 *
 * @param value A time as Postgres returns it, e.g. `17:00:00`.
 * @returns e.g. `5:00 p.m.`
 */
export function formatTimeOfDay(value: string): string {
	const [hours = '0', minutes = '00'] = value.split(':');

	/**
	 * Anchored to an arbitrary date so `Intl` can format it. Only the time part
	 * is read back out, so which date it is does not matter, but it must be a
	 * fixed one, not `new Date()`, or the result could shift across a daylight
	 * saving boundary.
	 */
	const anchor = new Date(2000, 0, 1, Number(hours), Number(minutes));

	return new Intl.DateTimeFormat('en-CA', {
		hour: 'numeric',
		minute: '2-digit'
	}).format(anchor);
}

/** Lamports per SOL. Solana's own constant, restated so the app needs no SDK to show a balance. */
export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Formats a lamport amount as SOL.
 *
 * Four decimal places. Two is not enough: a commitment stake and a network fee
 * both live below a hundredth of a SOL, so rounding to cents would display a
 * real balance as 0.00 and a real fee as free.
 *
 * @param lamports The amount, or null when the chain could not be reached.
 * @returns A formatted figure, or an em dash, never "0" for an unknown
 *          balance. "Solana is unavailable" and "this wallet is empty" lead to
 *          opposite decisions, so they must not look alike.
 */
export function formatSol(lamports: number | null): string {
	if (lamports === null) return 'Unknown';

	return `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
}
