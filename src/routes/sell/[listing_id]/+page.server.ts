import { PUBLIC_SUPABASE_LISTINGS_BUCKET } from '$app/env/public';
import { error, fail, redirect } from '@sveltejs/kit';
import { parsePriceToCents } from '#lib/format';
import { requireUser } from '#lib/server/auth/guards';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '#lib/listings/images';
import { CONDITION_ORDER, type ListingCondition } from '#lib/listings/labels';
import { invokeFunction } from '#lib/server/functions/invoke';
import { loadRequestOptions } from '#lib/server/request-options';
import {
	addAvailability,
	addLocation,
	removeAvailability,
	removeLocation
} from '#lib/server/meetup-setup';
import type { Actions, PageServerLoad } from './$types';

/**
 * Listing detail, `/sell/[listing_id]`.
 *
 * Serves two audiences from one route, because one listing has one URL:
 *
 *   * its seller sees management controls
 *   * anyone else sees the public view and a commitment request
 *
 * Which one is decided server-side from the verified user, never from a query
 * parameter or a client-supplied flag.
 */

/** Extension to store a file under, chosen from its type rather than its name. */
const EXTENSION_BY_TYPE: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/avif': 'avif'
};

export const load: PageServerLoad = async ({ locals, params }) => {
	/**
	 * No guard here. A signed-out visitor may view an active listing, that is
	 * what Discover links to. Row Level Security is what stops them seeing
	 * someone else's draft, and it returns no row rather than an error, which
	 * surfaces below as a 404.
	 */
	const user = await locals.getVerifiedUser();

	const { data: listing, error: listingError } = await locals.supabase
		.from('listings')
		.select(
			'id, seller_id, title, description, price_cents, condition, status, created_at, profiles(display_name, reputation)'
		)
		.eq('id', params.listing_id)
		.maybeSingle();

	if (listingError) {
		error(500, 'This listing could not be loaded.');
	}

	if (!listing) {
		/**
		 * 404, and deliberately the same response whether the listing does not
		 * exist or is someone else's draft. Distinguishing them would confirm
		 * that a given id exists, which a draft's owner has not chosen to
		 * publish.
		 */
		error(404, 'That listing does not exist, or is not available.');
	}

	const isOwner = user !== null && user.id === listing.seller_id;

	const { data: images } = await locals.supabase
		.from('listing_images')
		.select('id, storage_path, position')
		.eq('listing_id', listing.id)
		.order('position', { ascending: true });

	/**
	 * Where and when this seller will meet, and, for anyone but the owner,
	 * the concrete times a buyer can pick. Shared with the Discover request
	 * dialog so both offer exactly the same choices.
	 */
	const options = await loadRequestOptions(locals, listing.seller_id, !isOwner);
	const { locations, availability, slots, stakeCents, fee, minimumLeadHours } = options;
	let frozen = false;

	if (isOwner) {
		/**
		 * A listing with an accepted commitment is frozen: two people have
		 * agreed to meet about this specific item at this specific price, and
		 * changing it underneath them turns a reliable meetup into a bait and
		 * switch. The database enforces it; this is so the form can explain it
		 * rather than simply failing on save.
		 */
		const { count } = await locals.supabase
			.from('commitments')
			.select('id', { count: 'exact', head: true })
			.eq('listing_id', listing.id)
			.eq('status', 'accepted');

		frozen = (count ?? 0) > 0;
	}

	return {
		listing,
		images: images ?? [],
		locations,
		availability,
		isOwner,
		conditions: CONDITION_ORDER,
		slots,
		stakeCents,
		fee,
		minimumLeadHours,
		frozen,
		signedIn: user !== null
	};
};

/**
 * Loads a listing and confirms the signed-in user owns it.
 *
 * Every mutating action calls this first. RLS would refuse the write anyway,
 * but it would do so as an opaque database error; checking here produces an
 * honest 403 and keeps the failure legible.
 */
async function requireOwnedListing(
	locals: App.Locals,
	listingId: string,
	pathname: string
): Promise<{ userId: string }> {
	const user = requireUser(await locals.getVerifiedUser(), pathname);

	const { data } = await locals.supabase
		.from('listings')
		.select('seller_id')
		.eq('id', listingId)
		.maybeSingle();

	if (!data || data.seller_id !== user.id) {
		error(403, 'That listing is not yours to change.');
	}

	return { userId: user.id };
}

/** Shared shape for the detail-editing and status actions. */
const ok = (message: string) => ({
	errors: {} as Record<string, string>,
	message,
	tone: 'success' as const
});

export const actions: Actions = {
	/**
	 * A buyer requests a meetup.
	 *
	 * This creates a commitment in `pending`. Nothing is locked and no money
	 * moves: a request is an offer to meet, and it only becomes an obligation
	 * when the seller accepts.
	 *
	 * NOT DONE HERE, deliberately, see the migration:
	 *   * stake calculation. A flat $2.00 for both sides, owned by the Edge
	 *     Function and `market_settings`.
	 */
	requestCommitment: async ({ request, locals, params, url }) => {
		requireUser(await locals.getVerifiedUser(), url.pathname);

		const form = await request.formData();
		const meetupLocationId = String(form.get('meetupLocationId') ?? '');
		const scheduledAt = String(form.get('scheduledAt') ?? '');

		if (!meetupLocationId || !scheduledAt) {
			return fail(400, { requestError: 'Choose both a place and a time.', needsFunds: false });
		}

		/**
		 * Delegated entirely to the Edge Function, which is the only thing that
		 * can take the buyer's stake, the custodial signing key is a function
		 * secret and is deliberately unreachable from here.
		 *
		 * Nothing is written to `commitments` in this file any more. Doing both
		 * would mean a request could exist without its money having moved, which
		 * is exactly the state the product exists to prevent.
		 */
		const result = await invokeFunction<{
			commitment_id: string;
			stake_lamports: number;
		}>(locals.supabase, 'request_commitment', {
			listing_id: params.listing_id,
			meetup_location_id: meetupLocationId,
			scheduled_at: scheduledAt
		});

		if (!result.ok) {
			/**
			 * Insufficient funds is not a failure the user should puzzle over,
			 * it has an obvious next step, so the page is told to offer it.
			 */
			if (result.error.code === 'INSUFFICIENT_FUNDS') {
				return fail(402, { requestError: result.error.message, needsFunds: true });
			}

			if (result.error.code === 'WALLET_NOT_FOUND') {
				return fail(404, { requestError: result.error.message, needsFunds: true });
			}

			return fail(400, { requestError: result.error.message, needsFunds: false });
		}

		redirect(303, `/commitment/${result.data.commitment_id}`);
	},

	/**
	 * The seller's meetup locations and times, editable from their listing.
	 * They belong to the seller, so only a signed-in user's own rows change,
	 * Row Level Security enforces it as well.
	 */
	addLocation: async ({ request, locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);
		return addLocation(locals, user.id, await request.formData());
	},

	removeLocation: async ({ request, locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);
		return removeLocation(locals, user.id, await request.formData());
	},

	addAvailability: async ({ request, locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);
		return addAvailability(locals, user.id, await request.formData());
	},

	removeAvailability: async ({ request, locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);
		return removeAvailability(locals, user.id, await request.formData());
	},

	/** Edit the item's details. */
	updateDetails: async ({ request, locals, params, url }) => {
		await requireOwnedListing(locals, params.listing_id, url.pathname);

		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		const priceInput = String(form.get('price') ?? '').trim();
		const condition = String(form.get('condition') ?? '');

		const errors: Record<string, string> = {};
		const priceCents = parsePriceToCents(priceInput);

		if (title.length === 0) errors.title = 'Give the item a title.';
		if (priceCents === null) errors.price = 'Enter an amount like 45 or 45.50.';

		const isValidCondition = (value: string): value is ListingCondition =>
			(CONDITION_ORDER as readonly string[]).includes(value);

		if (!isValidCondition(condition)) errors.condition = 'Choose the condition.';

		if (Object.keys(errors).length > 0 || priceCents === null || !isValidCondition(condition)) {
			return fail(400, { errors, message: null, tone: 'error' as const });
		}

		const { error: updateError } = await locals.supabase
			.from('listings')
			.update({
				title,
				description: description.length > 0 ? description : null,
				price_cents: priceCents,
				condition
			})
			.eq('id', params.listing_id);

		if (updateError) {
			return fail(500, {
				errors: {} as Record<string, string>,
				message: 'Those changes could not be saved.',
				tone: 'error' as const
			});
		}

		return ok('Changes saved.');
	},

	/**
	 * Accepts ONE image and attaches it to the listing.
	 *
	 * One file per request on purpose. The client uploads several by calling
	 * this repeatedly, which is what makes per-file progress and per-file
	 * failure possible, a single batched request can only report "something
	 * went wrong" for the whole set.
	 */
	uploadImage: async ({ request, locals, params, url }) => {
		const { userId } = await requireOwnedListing(locals, params.listing_id, url.pathname);

		const form = await request.formData();
		const file = form.get('image');

		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { uploadError: 'No image was received.' });
		}

		/**
		 * Checked here as well as on the client and in the bucket's own
		 * configuration. The client check is for speed, the bucket's is the
		 * backstop, and this one is the only place that can say which file
		 * failed and why.
		 */
		if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
			return fail(400, { uploadError: `${file.name} is not a JPEG, PNG, WebP or AVIF image.` });
		}

		if (file.size > MAX_IMAGE_BYTES) {
			return fail(400, {
				uploadError: `${file.name} is larger than 8 MB. Try a smaller photograph.`
			});
		}

		/**
		 * Path layout is `{seller_id}/{listing_id}/{random}.{ext}`. The first
		 * segment being the owner's id is exactly what the storage policy
		 * checks, so a user cannot write into another seller's folder.
		 *
		 * The filename is GENERATED, never taken from the upload. `file.name` is
		 * attacker-controlled, and using it would hand them the path.
		 */
		const extension = EXTENSION_BY_TYPE[file.type] ?? 'bin';
		const storagePath = `${userId}/${params.listing_id}/${crypto.randomUUID()}.${extension}`;

		const { error: uploadError } = await locals.supabase.storage
			.from(PUBLIC_SUPABASE_LISTINGS_BUCKET)
			.upload(storagePath, file, { contentType: file.type, upsert: false });

		if (uploadError) {
			return fail(502, { uploadError: `${file.name} could not be uploaded. Please try again.` });
		}

		/** One past the current last. */
		const { data: last } = await locals.supabase
			.from('listing_images')
			.select('position')
			.eq('listing_id', params.listing_id)
			.order('position', { ascending: false })
			.limit(1)
			.maybeSingle();

		const { error: insertError } = await locals.supabase
			.from('listing_images')
			.insert({
				listing_id: params.listing_id,
				storage_path: storagePath,
				position: (last?.position ?? -1) + 1
			});

		if (insertError) {
			/**
			 * The file reached storage but has no row pointing at it, so it is
			 * orphaned, invisible to the app and impossible to clean up later.
			 * Remove it rather than leaving it behind.
			 */
			await locals.supabase.storage.from(PUBLIC_SUPABASE_LISTINGS_BUCKET).remove([storagePath]);
			return fail(500, { uploadError: `${file.name} was uploaded but could not be attached.` });
		}

		return { uploadError: null };
	},

	removeImage: async ({ request, locals, params, url }) => {
		await requireOwnedListing(locals, params.listing_id, url.pathname);

		const form = await request.formData();
		const imageId = String(form.get('imageId') ?? '');

		const { data: image } = await locals.supabase
			.from('listing_images')
			.select('storage_path')
			.eq('id', imageId)
			.eq('listing_id', params.listing_id)
			.maybeSingle();

		if (!image) {
			return fail(404, { uploadError: 'That image is no longer attached to this listing.' });
		}

		await locals.supabase.from('listing_images').delete().eq('id', imageId);
		await locals.supabase.storage.from(PUBLIC_SUPABASE_LISTINGS_BUCKET).remove([image.storage_path]);

		return { uploadError: null };
	},

	publish: async ({ locals, params, url }) => {
		const { userId } = await requireOwnedListing(locals, params.listing_id, url.pathname);

		/**
		 * A listing nobody can request is not worth publishing. Checked here so
		 * the seller is told what is missing; a database trigger enforces it.
		 */
		const [locations, availability] = await Promise.all([
			locals.supabase
				.from('meetup_locations')
				.select('id', { count: 'exact', head: true })
				.eq('profile_id', userId)
				.eq('is_archived', false),
			locals.supabase
				.from('availability_rules')
				.select('id', { count: 'exact', head: true })
				.eq('profile_id', userId)
				.eq('is_archived', false)
				.or(`specific_date.is.null,specific_date.gte.${new Date().toISOString().slice(0, 10)}`)
		]);

		const missing = [
			(locations.count ?? 0) === 0 ? 'a meetup location' : null,
			(availability.count ?? 0) === 0 ? 'a time you can meet' : null
		].filter(Boolean);

		if (missing.length > 0) {
			return fail(400, {
				errors: {} as Record<string, string>,
				message: `Add ${missing.join(' and ')} before publishing.`,
				tone: 'error' as const
			});
		}

		const { error: updateError } = await locals.supabase
			.from('listings')
			.update({ status: 'active' })
			.eq('id', params.listing_id);

		if (updateError) {
			return fail(500, {
				errors: {} as Record<string, string>,
				message: 'The listing could not be published.',
				tone: 'error' as const
			});
		}

		return ok('Published. It is now visible in Discover.');
	},

	withdraw: async ({ locals, params, url }) => {
		await requireOwnedListing(locals, params.listing_id, url.pathname);

		await locals.supabase
			.from('listings')
			.update({ status: 'withdrawn' })
			.eq('id', params.listing_id);

		return ok('Withdrawn. It is no longer visible in Discover.');
	},

	deleteListing: async ({ locals, params, url }) => {
		const { userId } = await requireOwnedListing(locals, params.listing_id, url.pathname);

		/**
		 * Storage files go first. Deleting the listing cascades to its image
		 * rows, and once those are gone nothing records where the files were,
		 * so removing them afterwards would be impossible.
		 */
		const { data: images } = await locals.supabase
			.from('listing_images')
			.select('storage_path')
			.eq('listing_id', params.listing_id);

		if (images && images.length > 0) {
			await locals.supabase.storage
				.from(PUBLIC_SUPABASE_LISTINGS_BUCKET)
				.remove(images.map((image) => image.storage_path));
		}

		await locals.supabase
			.from('listings')
			.delete()
			.eq('id', params.listing_id)
			.eq('seller_id', userId);

		redirect(303, '/sell');
	}
};
