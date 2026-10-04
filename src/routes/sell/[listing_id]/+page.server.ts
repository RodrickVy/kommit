import { PUBLIC_SUPABASE_LISTINGS_BUCKET } from '$app/env/public';
import { error, fail, redirect } from '@sveltejs/kit';
import { parsePriceToCents } from '#lib/format';
import { requireUser } from '#lib/server/auth/guards';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '#lib/listings/images';
import { CONDITION_ORDER, type ListingCondition } from '#lib/listings/labels';
import { generateSlots } from '#lib/commitments/slots';
import type { Actions, PageServerLoad } from './$types';

/**
 * Listing detail — `/sell/[listing_id]`.
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
	 * No guard here. A signed-out visitor may view an active listing — that is
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
	 * Locations and availability let a buyer see where and when this seller is
	 * willing to meet, before committing to anything.
	 *
	 * The override rule applies: a listing with no rows in the join table
	 * inherits ALL of the seller's non-archived entries. Nothing writes those
	 * join tables yet, so every listing currently inherits — which is the
	 * intended default, not a gap.
	 */
	const { data: locations } = await locals.supabase
		.from('meetup_locations')
		.select('id, name')
		.eq('profile_id', listing.seller_id)
		.eq('is_archived', false);

	const { data: availability } = await locals.supabase
		.from('availability_rules')
		.select('id, day_of_week, start_time, end_time, timezone')
		.eq('profile_id', listing.seller_id)
		.eq('is_archived', false)
		.order('day_of_week', { ascending: true });

	/**
	 * Everything needed to offer a commitment request. Skipped entirely for the
	 * owner, who cannot commit to their own listing — the database forbids it
	 * and there is no reason to pay for the queries.
	 */
	let slots: { startsAt: string; ruleId: string }[] = [];
	let stakeCents: number | null = null;
	let frozen = false;

	if (!isOwner) {
		const [settingsResult, takenResult] = await Promise.all([
			locals.supabase
				.from('market_settings')
				.select('base_commitment_fee_cents, minimum_acceptance_lead_hours')
				.eq('id', 1)
				.single(),
			/**
			 * Moments this seller already has accepted commitments for. They are
			 * removed from the list rather than offered and rejected: a database
			 * error after someone has chosen a time is a worse experience than
			 * never showing it.
			 *
			 * This is a courtesy, not the guarantee. The partial unique indexes
			 * are what actually prevent a double booking, including between two
			 * buyers who load the page at the same moment.
			 */
			locals.supabase
				.from('commitments')
				.select('scheduled_at')
				.eq('seller_id', listing.seller_id)
				.eq('status', 'accepted')
		]);

		const settings = settingsResult.data;

		if (settings) {
			stakeCents = settings.base_commitment_fee_cents;

			slots = generateSlots(availability ?? [], {
				/** The server's clock decides, never the browser's. */
				now: new Date(),
				minimumLeadHours: settings.minimum_acceptance_lead_hours,
				taken: new Set((takenResult.data ?? []).map((row) => row.scheduled_at))
			}).slice(0, 60);
		}
	} else {
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
		locations: locations ?? [],
		availability: availability ?? [],
		isOwner,
		conditions: CONDITION_ORDER,
		slots,
		stakeCents,
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
	 * NOT DONE HERE, deliberately — see the migration:
	 *   * stake calculation. Both sides get the market baseline for now; the
	 *     specification requires reputation-adjusted, asymmetric amounts, and
	 *     that becomes a change to this one assignment.
	 *   * wallet locking. Nothing is reserved until the wallet service exists.
	 */
	requestCommitment: async ({ request, locals, params, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);

		const form = await request.formData();
		const meetupLocationId = String(form.get('meetupLocationId') ?? '');
		const scheduledAt = String(form.get('scheduledAt') ?? '');

		if (!meetupLocationId || !scheduledAt) {
			return fail(400, { requestError: 'Choose both a place and a time.' });
		}

		/**
		 * The listing is re-read rather than trusted from the form. `seller_id`
		 * comes from here, so a crafted submission cannot name someone else as
		 * the seller, and the status check means a reserved or withdrawn item
		 * cannot be committed to even if the page was loaded while it was live.
		 */
		const { data: listing } = await locals.supabase
			.from('listings')
			.select('id, seller_id, status')
			.eq('id', params.listing_id)
			.maybeSingle();

		if (!listing || listing.status !== 'active') {
			return fail(409, { requestError: 'This listing is no longer available.' });
		}

		if (listing.seller_id === user.id) {
			return fail(400, { requestError: 'You cannot request a meetup for your own listing.' });
		}

		const { data: settings } = await locals.supabase
			.from('market_settings')
			.select('base_commitment_fee_cents')
			.eq('id', 1)
			.single();

		const baseStake = settings?.base_commitment_fee_cents ?? 0;

		const { data: commitment, error } = await locals.supabase
			.from('commitments')
			.insert({
				listing_id: listing.id,
				buyer_id: user.id,
				seller_id: listing.seller_id,
				meetup_location_id: meetupLocationId,
				scheduled_at: scheduledAt,
				/**
				 * Equal today only because nothing calculates them yet. The two
				 * columns exist so that reputation-adjusted stakes do not require
				 * changing the table.
				 */
				buyer_stake_cents: baseStake,
				seller_stake_cents: baseStake
			})
			.select('id')
			.single();

		if (error) {
			/**
			 * The database enforces several rules this action cannot usefully
			 * re-check without a race. Each is translated rather than shown raw,
			 * because a constraint name means nothing to the person reading it.
			 */
			if (error.code === '23505') {
				return fail(409, {
					requestError:
						'That time has just been taken, or you already have a request open on this listing.'
				});
			}

			if (error.message.includes('hours away')) {
				return fail(400, {
					requestError:
						'That meetup is too soon. Pick a time far enough ahead for the seller to respond.'
				});
			}

			return fail(500, { requestError: 'The request could not be sent. Please try again.' });
		}

		/**
		 * The event log is what reputation will eventually be built from — the
		 * path, not just the final status. Written alongside the commitment
		 * rather than inferred later, because "who did what, as which role, and
		 * when" cannot be reconstructed from a status column.
		 */
		await locals.supabase.from('commitment_events').insert({
			commitment_id: commitment.id,
			event_type: 'request_created',
			actor_profile_id: user.id,
			actor_role: 'buyer'
		});

		redirect(303, `/commitment/${commitment.id}`);
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
	 * failure possible — a single batched request can only report "something
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
			 * orphaned — invisible to the app and impossible to clean up later.
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
		await requireOwnedListing(locals, params.listing_id, url.pathname);

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
		 * rows, and once those are gone nothing records where the files were —
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
