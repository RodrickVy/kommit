import { CONDITION_ORDER, type ListingCondition } from '#lib/listings/labels';
import { DISCOVER_SORTS, MAX_QUERY_LENGTH, type DiscoverSort } from '#lib/listings/discover-view';
import type { PageServerLoad } from './$types';

/**
 * Discover — browse active listings.
 *
 * The only page a signed-out visitor is expected to spend time on, so it is
 * deliberately readable without an account. Row Level Security already limits
 * this to `active` listings plus the viewer's own drafts, so the filter below
 * is about intent rather than access control.
 */

/**
 * Listings per page. Large enough to fill a desktop grid without scrolling
 * forever, small enough that the first paint is quick on a phone.
 */
const PAGE_SIZE = 24;

export const load: PageServerLoad = async ({ locals, url }) => {
	/**
	 * Page number from the query string. Anything that is not a positive
	 * integer is treated as page 1 rather than erroring — a mangled URL should
	 * show listings, not a stack trace.
	 */
	const requestedPage = Number(url.searchParams.get('page'));
	const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

	const from = (page - 1) * PAGE_SIZE;
	const to = from + PAGE_SIZE - 1;

	/**
	 * Columns are listed explicitly — never `select('*')`. Everything a load
	 * function returns is serialised into the page's HTML, so an unused column
	 * is bandwidth on every request and a disclosure surface besides.
	 *
	 * The nested select pulls only the primary image (position 0) rather than
	 * every photo, because the card shows one.
	 *
	 * `count: 'exact'` is what makes a "page 2 of 5" control possible at all.
	 */
	/** Search, condition and sort from the query string; anything unknown falls back. */
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
	const conditionParam = url.searchParams.get('condition') ?? 'all';
	const condition = (CONDITION_ORDER as readonly string[]).includes(conditionParam)
		? (conditionParam as ListingCondition)
		: 'all';
	const sortParam = url.searchParams.get('sort') ?? 'newest';
	const sort: DiscoverSort = sortParam in DISCOVER_SORTS ? (sortParam as DiscoverSort) : 'newest';

	let query = locals.supabase
		.from('listings')
		.select('id, title, price_cents, condition, status, listing_images(storage_path)', {
			count: 'exact'
		})
		.eq('status', 'active')
		.eq('listing_images.position', 0);

	if (condition !== 'all') query = query.eq('condition', condition);

	if (q) {
		/**
		 * Matches the title or the description. LIKE wildcards in the input are
		 * escaped so they are searched for literally, and the characters that
		 * delimit a PostgREST `or` filter are dropped rather than trusted.
		 */
		const term = q.replace(/[,()"\\]/g, ' ').replace(/[%_]/g, (c) => `\\${c}`);
		query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
	}

	const { column, ascending } = DISCOVER_SORTS[sort];

	const { data, error, count } = await query
		.order(column, { ascending })
		.order('created_at', { ascending: false })
		.range(from, to);

	const view = { q, condition, sort };

	if (error) {
		return { listings: [], page, pageCount: 1, total: 0, view, loadError: 'Listings could not be loaded.' };
	}

	const total = count ?? 0;

	return {
		listings: data,
		page,
		/** At least 1, so an empty marketplace still reads as "page 1 of 1". */
		pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
		total,
		view,
		loadError: null
	};
};
