import { fail, redirect } from '@sveltejs/kit';
import { parsePriceToCents } from '#lib/format';
import { requireUser } from '#lib/server/auth/guards';
import { CONDITION_ORDER, type ListingCondition } from '#lib/listings/labels';
import type { Actions, PageServerLoad } from './$types';

/**
 * Create listing — `/sell/create_listing`.
 *
 * Collects the item's details and nothing else. It creates a DRAFT and sends
 * the seller to the management page to add photographs and publish.
 *
 * Two steps rather than one, for a concrete reason: an image has to be stored
 * under a path that includes its listing id, so the listing must exist before
 * anything can be uploaded to it. Splitting the flow also means a seller who
 * abandons the form halfway keeps what they typed, as a draft only they can
 * see.
 */

export const load: PageServerLoad = async ({ locals, url }) => {
	requireUser(await locals.getVerifiedUser(), url.pathname);
	return { conditions: CONDITION_ORDER };
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);

		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		const priceInput = String(form.get('price') ?? '').trim();
		const condition = String(form.get('condition') ?? '');

		const errors: Record<string, string> = {};

		if (title.length === 0) {
			errors.title = 'Give the item a title.';
		} else if (title.length > 120) {
			errors.title = 'Use 120 characters or fewer.';
		}

		/**
		 * Parsed to integer cents here rather than stored as text and converted
		 * later. `45.70 * 100` is 4569.999… in binary floating point, which
		 * truncates to one cent short — see `parsePriceToCents`.
		 */
		const priceCents = parsePriceToCents(priceInput);

		if (priceInput.length === 0) {
			errors.price = 'Set a price.';
		} else if (priceCents === null) {
			errors.price = 'Enter an amount like 45 or 45.50.';
		}

		/**
		 * The condition arrives as a string from a select, so it is checked
		 * against the real enum rather than trusted. A posted value the database
		 * does not know would otherwise fail as an opaque constraint error.
		 */
		const isValidCondition = (value: string): value is ListingCondition =>
			(CONDITION_ORDER as readonly string[]).includes(value);

		if (!isValidCondition(condition)) {
			errors.condition = 'Choose the item’s condition.';
		}

		if (Object.keys(errors).length > 0 || priceCents === null || !isValidCondition(condition)) {
			return fail(400, {
				errors,
				formError: null,
				title,
				description,
				price: priceInput,
				condition
			});
		}

		const { data, error } = await locals.supabase
			.from('listings')
			.insert({
				seller_id: user.id,
				title,
				description: description.length > 0 ? description : null,
				price_cents: priceCents,
				condition,
				/** Always a draft. Publishing is a separate, deliberate act. */
				status: 'draft'
			})
			.select('id')
			.single();

		if (error) {
			return fail(500, {
				errors: {} as Record<string, string>,
				formError: 'The listing could not be created. Please try again.',
				title,
				description,
				price: priceInput,
				condition
			});
		}

		/** Straight to the management page, where photographs are added. */
		redirect(303, `/sell/${data.id}`);
	}
};
