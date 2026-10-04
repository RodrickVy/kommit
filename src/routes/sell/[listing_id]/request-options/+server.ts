import { error, json } from '@sveltejs/kit';
import { loadRequestOptions } from '#lib/server/request-options';
import type { RequestHandler } from './$types';

/**
 * `GET /sell/[listing_id]/request-options`
 *
 * The places and times a buyer can choose for this listing, for the request
 * dialog on Discover cards. The request itself still posts to the listing's
 * own `requestCommitment` action, so there is one place a request is made.
 *
 * Never returns coordinates: the dialog needs names only.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const user = await locals.getVerifiedUser();

	const { data: listing } = await locals.supabase
		.from('listings')
		.select('id, seller_id, status')
		.eq('id', params.listing_id)
		.maybeSingle();

	if (!listing) error(404, 'That listing does not exist, or is not available.');

	const isOwner = user !== null && user.id === listing.seller_id;
	const options = await loadRequestOptions(locals, listing.seller_id, !isOwner && user !== null);

	return json({
		status: listing.status,
		signedIn: user !== null,
		isOwner,
		locations: options.locations.map(({ id, name }) => ({ id, name })),
		hasAvailability: options.availability.length > 0,
		slots: options.slots,
		stakeCents: options.stakeCents,
		minimumLeadHours: options.minimumLeadHours
	});
};
