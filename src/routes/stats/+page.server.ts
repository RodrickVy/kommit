import { parseBucket, windowFor } from '#lib/stats/buckets';
import type { PageServerLoad } from './$types';

/**
 * Stats, `/stats`.
 *
 * Two series on the same buckets: the marketplace price against its average
 * reputation, and the charity donations underneath. The granularity comes from
 * `?bucket=`, so a view is a URL someone can send to somebody else.
 *
 * WHY THE SERIES REPLACED THE OLD FEE HISTORY
 * -------------------------------------------
 * This page used to read `base_fee_history()` and build an hourly line in
 * TypeScript. That series was the RAW base fee, which only moves when an admin
 * edits it, so the chart was a flat line by construction. The price people
 * actually pay is the market-adjusted fee, and `market_price_series` buckets it
 * at whatever granularity is asked for — including the gap filling, which was
 * the fiddliest part of the old load and is now one window function in SQL.
 *
 * THE TICKER FIGURES COME FROM THE SAME SERIES. They were separately derived
 * before, which meant the headline number and the chart could disagree.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	/** Falls back rather than erroring, so a mangled URL still shows a chart. */
	const bucket = parseBucket(url.searchParams.get('bucket'));
	const { from, to } = windowFor(bucket);

	const [priceResult, donationResult, marketResult, outcomesResult, settingsResult] =
		await Promise.all([
			locals.supabase.rpc('market_price_series', {
				bucket,
				from_at: from,
				to_at: to
			}),
			locals.supabase.rpc('charity_donation_series', {
				bucket,
				from_at: from,
				to_at: to
			}),
			/**
			 * The headline pair. Marketplace-wide aggregates that name nobody,
			 * which is why this page can be public.
			 */
			locals.supabase.rpc('market_fee_summary').maybeSingle(),
			/** Totals per status only; no commitment or person is identifiable. */
			locals.supabase.rpc('commitment_outcome_counts'),
			locals.supabase
				.from('market_settings')
				.select('currency_code')
				.eq('id', 1)
				.maybeSingle()
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

	const counts = new Map(
		(outcomesResult.data ?? []).map((row) => [row.status as string, row.total])
	);

	const outcomes = OUTCOMES.map((outcome) => ({
		label: outcome.label,
		colour: outcome.colour,
		total: outcome.statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0)
	})).filter((outcome) => outcome.total > 0);

	const price = priceResult.data ?? [];

	/**
	 * Only buckets with a real price. The leading ones are null when the window
	 * reaches back before anything was recorded, and a chart should not draw a
	 * line through a period that had no price.
	 */
	const priced = price.filter((row) => row.close_fee_cents !== null);
	const closes = priced.map((row) => Number(row.close_fee_cents));

	return {
		bucket,
		from,
		to,
		price,
		donations: donationResult.data ?? [],
		market: marketResult.data,
		outcomes,
		currencyCode: settingsResult.data?.currency_code ?? 'CAD',

		/** The ticker, derived from the series it sits above rather than separately. */
		latestCents: closes.at(-1) ?? null,
		openCents: closes.at(0) ?? null,
		highCents: closes.length ? Math.max(...closes) : null,
		lowCents: closes.length ? Math.min(...closes) : null,
		eventCount: price.reduce((sum, row) => sum + (row.event_count ?? 0), 0),

		loadError: priceResult.error
			? 'The price history could not be loaded.'
			: donationResult.error
				? 'The donation history could not be loaded.'
				: null
	};
};
