import { requireUser } from '#lib/server/auth/guards';
import type { PageServerLoad } from './$types';

/**
 * Sell — the seller's own listings.
 *
 * Guarded. Hiding the link in the navigation is presentation, not access
 * control: anyone can type the URL, and this is where that is actually stopped.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(await locals.getVerifiedUser(), url.pathname);

	/**
	 * Explicit columns, and only the primary image for the card.
	 *
	 * No status filter: a seller sees everything they own, including drafts and
	 * withdrawn items, which is the whole point of this page as opposed to
	 * Discover. The RLS policy already permits exactly this and nothing more.
	 */
	const { data, error } = await locals.supabase
		.from('listings')
		.select('id, title, price_cents, condition, status, created_at, listing_images(storage_path)')
		.eq('seller_id', user.id)
		.eq('listing_images.position', 0)
		.order('created_at', { ascending: false });

	if (error) {
		return { listings: [], loadError: 'Your listings could not be loaded.' };
	}

	return { listings: data, loadError: null };
};
