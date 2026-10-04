import { loadWallet } from '#lib/server/functions/invoke';
import type { PageServerLoad } from './$types';

/**
 * Home — `/`.
 *
 * A preview of Discover (the newest listings) and, for a signed-in user, their
 * wallet balance. Both are read in parallel; neither failing blanks the page.
 */

/** Enough to fill a sliding row on a wide screen, small enough to load fast. */
const PREVIEW_SIZE = 12;

export const load: PageServerLoad = async ({ locals }) => {
	const user = await locals.getVerifiedUser();

	const [listingsResult, walletResult] = await Promise.all([
		locals.supabase
			.from('listings')
			.select('id, title, price_cents, condition, status, listing_images(storage_path)')
			.eq('status', 'active')
			.eq('listing_images.position', 0)
			.order('created_at', { ascending: false })
			.limit(PREVIEW_SIZE),
		user ? loadWallet(locals.supabase) : Promise.resolve({ wallet: null, error: null })
	]);

	return {
		listings: listingsResult.data ?? [],
		listingsError: listingsResult.error ? 'Listings could not be loaded.' : null,
		wallet: walletResult.wallet,
		walletError: walletResult.error?.message ?? null
	};
};
