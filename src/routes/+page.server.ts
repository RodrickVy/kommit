import type { PageServerLoad } from './$types';

/**
 * Home — `/`.
 *
 * The newest listings, for the "New on Discover" row.
 */

/** Enough to fill a sliding row on a wide screen, small enough to load fast. */
const PREVIEW_SIZE = 12;

export const load: PageServerLoad = async ({ locals }) => {
	const { data, error } = await locals.supabase
		.from('listings')
		.select('id, title, price_cents, condition, status, listing_images(storage_path)')
		.eq('status', 'active')
		.eq('listing_images.position', 0)
		.order('created_at', { ascending: false })
		.limit(PREVIEW_SIZE);

	return {
		listings: data ?? [],
		listingsError: error ? 'Listings could not be loaded.' : null
	};
};
