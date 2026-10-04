import { CONDITION_LABELS, CONDITION_ORDER } from '#lib/listings/labels';

/**
 * Search, filter and sort options for Discover. Shared by the load function,
 * which applies them, and the page, which offers them.
 */

export const DISCOVER_SORTS = {
	newest: { label: 'Newest', column: 'created_at', ascending: false },
	price_low: { label: 'Price: low to high', column: 'price_cents', ascending: true },
	price_high: { label: 'Price: high to low', column: 'price_cents', ascending: false }
} as const;

export type DiscoverSort = keyof typeof DISCOVER_SORTS;

/** "All", then each condition — one tab apiece. */
export const CONDITION_TABS = [
	{ key: 'all', label: 'All' },
	...CONDITION_ORDER.map((key) => ({ key, label: CONDITION_LABELS[key] }))
] as const;

/** The longest search kept; anything beyond is noise, not a query. */
export const MAX_QUERY_LENGTH = 80;
