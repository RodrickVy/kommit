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
	const { data, error, count } = await locals.supabase
		.from('listings')
		.select('id, title, price_cents, condition, status, listing_images(storage_path)', {
			count: 'exact'
		})
		.eq('status', 'active')
		.eq('listing_images.position', 0)
		.order('created_at', { ascending: false })
		.range(from, to);

	if (error) {
		return { listings: [], page, pageCount: 1, total: 0, loadError: 'Listings could not be loaded.' };
	}

	const total = count ?? 0;

	return {
		listings: data,
		page,
		/** At least 1, so an empty marketplace still reads as "page 1 of 1". */
		pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
		total,
		loadError: null
	};
};
