import type { PageServerLoad } from './$types';

/**
 * Stats, `/stats`.
 *
 * The base commitment fee over time, read like a share price: an hourly line,
 * with a marker wherever the fee went up or down.
 */

export const load: PageServerLoad = async ({ locals }) => {
	const [historyResult, settingsResult, outcomesResult] = await Promise.all([
		locals.supabase.rpc('base_fee_history'),
		locals.supabase
			.from('market_settings')
			.select('base_commitment_fee_cents, currency_code')
			.eq('id', 1)
			.maybeSingle(),
		/** Totals per status only; no commitment or person is identifiable. */
		locals.supabase.rpc('commitment_outcome_counts')
	]);

	/**
	 * How commitments ended, grouped the way people talk about them. Pending
	 * and accepted are both still "open". Empty groups are left out.
	 */
	const OUTCOMES = [
		{ label: 'Completed', statuses: ['completed'], colour: '--k-outcome-completed' },
		{ label: 'Open', statuses: ['pending', 'accepted'], colour: '--k-outcome-open' },
		{ label: 'Cancelled', statuses: ['cancelled'], colour: '--k-outcome-cancelled' },
		{ label: 'No-show', statuses: ['no_show'], colour: '--k-outcome-no-show' },
		{ label: 'Unresolved', statuses: ['stale'], colour: '--k-outcome-stale' },
		{ label: 'Expired', statuses: ['expired'], colour: '--k-outcome-expired' },
		{ label: 'Declined', statuses: ['declined'], colour: '--k-outcome-declined' }
	] as const;

	const counts = new Map((outcomesResult.data ?? []).map((row) => [row.status as string, row.total]));
	const outcomes = OUTCOMES.map((outcome) => ({
		label: outcome.label,
		colour: outcome.colour,
		total: outcome.statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0)
	})).filter((outcome) => outcome.total > 0);

	const rows = historyResult.data ?? [];

	/** Each change, with how it moved against the previous one. */
	const points = rows.map((row, index) => {
		const cents = Number(row.base_fee_cents);
		const previous = index > 0 ? Number(rows[index - 1]!.base_fee_cents) : null;
		return {
			at: row.changed_at,
			cents,
			changeCents: previous === null ? 0 : cents - previous,
			direction: previous === null ? 'start' : cents > previous ? 'up' : 'down'
		} as const;
	});

	/**
	 * One point an hour, from the first recorded price to now: the fee in
	 * effect at the end of each hour. Marks the hours where it changed, so the
	 * chart can draw a marker there. Capped at the last 30 days (720 points).
	 */
	const HOUR = 3_600_000;
	const now = Date.now();
	const hourly: { at: string; cents: number; change: 'up' | 'down' | null }[] = [];

	if (points.length > 0) {
		const firstHour = Math.floor(new Date(points[0]!.at).getTime() / HOUR) * HOUR;
		const start = Math.max(firstHour, Math.floor(now / HOUR) * HOUR - 719 * HOUR);
		let next = 0;
		let cents = points[0]!.cents;

		/** The price in effect before the window opens, when history is older. */
		while (next < points.length && new Date(points[next]!.at).getTime() < start) {
			cents = points[next]!.cents;
			next += 1;
		}

		for (let hour = start; hour <= now; hour += HOUR) {
			let change: 'up' | 'down' | null = null;
			while (next < points.length && new Date(points[next]!.at).getTime() < hour + HOUR) {
				const point = points[next]!;
				if (point.direction === 'up' || point.direction === 'down') change = point.direction;
				cents = point.cents;
				next += 1;
			}
			hourly.push({ at: new Date(hour).toISOString(), cents, change });
		}
	}

	return {
		points,
		hourly,
		outcomes,
		currentCents: settingsResult.data?.base_commitment_fee_cents ?? null,
		currencyCode: settingsResult.data?.currency_code ?? 'CAD',
		loadError: historyResult.error ? 'The fee history could not be loaded.' : null
	};
};
