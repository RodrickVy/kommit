/**
 * The granularities the stats charts can be read at.
 *
 * One definition, used by the page's selector and by its load function, so the
 * window a bucket implies cannot differ between the control and the query.
 *
 * WHY EACH WINDOW IS THE SIZE IT IS
 * ---------------------------------
 * `span` is chosen to land near a hundred buckets. Fewer and the line has too
 * little shape to read; many more and the points are narrower than a pixel, so
 * the extra rows cost bandwidth and draw nothing.
 *
 * It also keeps every request well inside the 5000-bucket ceiling that
 * `stats_assert_span` enforces in the database — that limit exists because
 * these series build their buckets with `generate_series`, where an unbounded
 * window is not a slow query but a way to exhaust the server.
 */

export const STATS_BUCKETS = {
	second: { label: 'Seconds', span: 2 * 60_000 },
	minute: { label: 'Minutes', span: 2 * 3_600_000 },
	hour: { label: 'Hours', span: 5 * 86_400_000 },
	day: { label: 'Days', span: 90 * 86_400_000 },
	week: { label: 'Weeks', span: 365 * 86_400_000 }
} as const;

export type StatsBucket = keyof typeof STATS_BUCKETS;

/** The default, and what an unrecognised query parameter falls back to. */
export const DEFAULT_BUCKET: StatsBucket = 'hour';

/**
 * Narrows a query parameter to a known bucket.
 *
 * Falls back rather than erroring: a mangled URL should show a chart, not a
 * stack trace. The database validates the unit again regardless, so this is
 * about the experience rather than about safety.
 */
export function parseBucket(value: string | null): StatsBucket {
	return value !== null && value in STATS_BUCKETS ? (value as StatsBucket) : DEFAULT_BUCKET;
}

/** The window a bucket implies, ending now. */
export function windowFor(bucket: StatsBucket, now = Date.now()) {
	return {
		from: new Date(now - STATS_BUCKETS[bucket].span).toISOString(),
		to: new Date(now).toISOString()
	};
}

/** Tabs for the granularity selector, in order from finest to coarsest. */
export const BUCKET_TABS = (Object.keys(STATS_BUCKETS) as StatsBucket[]).map((key) => ({
	key,
	label: STATS_BUCKETS[key].label
}));

/**
 * How to label a point on the time axis at this granularity.
 *
 * A date is noise on a seconds chart and a time is noise on a weeks chart, so
 * the format follows the bucket rather than being one compromise for all five.
 */
export function axisFormat(bucket: StatsBucket): Intl.DateTimeFormatOptions {
	switch (bucket) {
		case 'second':
			return { minute: '2-digit', second: '2-digit' };
		case 'minute':
			return { hour: 'numeric', minute: '2-digit' };
		case 'hour':
			return { weekday: 'short', hour: 'numeric' };
		case 'day':
			return { month: 'short', day: 'numeric' };
		case 'week':
			return { month: 'short', day: 'numeric' };
	}
}

/** The same decision for a tooltip, which has room for more. */
export function pointFormat(bucket: StatsBucket): Intl.DateTimeFormatOptions {
	switch (bucket) {
		case 'second':
			return { hour: 'numeric', minute: '2-digit', second: '2-digit' };
		case 'minute':
			return { hour: 'numeric', minute: '2-digit' };
		case 'hour':
			return { month: 'short', day: 'numeric', hour: 'numeric' };
		case 'day':
		case 'week':
			return { year: 'numeric', month: 'short', day: 'numeric' };
	}
}
