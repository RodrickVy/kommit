import { generateSlots, type Slot } from '#lib/commitments/slots';

/**
 * Where and when a buyer can ask to meet a seller.
 *
 * Shared by the listing page and the request dialog on Discover cards, so a
 * buyer is offered exactly the same places and times from both.
 */
export interface RequestOptions {
	locations: { id: string; name: string; latitude: number; longitude: number }[];
	availability: {
		id: string;
		day_of_week: number;
		start_time: string;
		end_time: string;
		timezone: string;
		specific_date: string | null;
	}[];
	slots: Slot[];
	stakeCents: number | null;
	minimumLeadHours: number | null;
}

/**
 * @param includeSlots  False for the seller's own view, which never requests
 *                      and so need not pay for the slot queries.
 */
export async function loadRequestOptions(
	locals: App.Locals,
	sellerId: string,
	includeSlots = true
): Promise<RequestOptions> {
	const today = new Date().toISOString().slice(0, 10);

	const [locationsResult, availabilityResult] = await Promise.all([
		locals.supabase
			.from('meetup_locations')
			.select('id, name, latitude, longitude')
			.eq('profile_id', sellerId)
			.eq('is_archived', false)
			.order('created_at', { ascending: true }),
		locals.supabase
			.from('availability_rules')
			.select('id, day_of_week, start_time, end_time, timezone, specific_date')
			.eq('profile_id', sellerId)
			.eq('is_archived', false)
			/** Dated times that have passed are no longer on offer. */
			.or(`specific_date.is.null,specific_date.gte.${today}`)
			.order('specific_date', { ascending: true, nullsFirst: true })
			.order('day_of_week', { ascending: true })
	]);

	const locations = locationsResult.data ?? [];
	const availability = availabilityResult.data ?? [];

	if (!includeSlots) {
		return { locations, availability, slots: [], stakeCents: null, minimumLeadHours: null };
	}

	const [settingsResult, takenResult] = await Promise.all([
		locals.supabase
			.from('market_settings')
			.select('base_commitment_fee_cents, minimum_acceptance_lead_hours')
			.eq('id', 1)
			.single(),
		/**
		 * Moments this seller already has accepted commitments for, removed
		 * rather than offered and refused. A courtesy: the partial unique
		 * indexes are what actually prevent a double booking.
		 */
		locals.supabase
			.from('commitments')
			.select('scheduled_at')
			.eq('seller_id', sellerId)
			.eq('status', 'accepted')
	]);

	const settings = settingsResult.data;
	if (!settings) {
		return { locations, availability, slots: [], stakeCents: null, minimumLeadHours: null };
	}

	const slots = generateSlots(availability, {
		/** The server's clock decides, never the browser's. */
		now: new Date(),
		minimumLeadHours: settings.minimum_acceptance_lead_hours,
		/** Far enough ahead that a seller's dated times next month show up. */
		horizonDays: 60,
		taken: new Set((takenResult.data ?? []).map((row) => new Date(row.scheduled_at).toISOString()))
	}).slice(0, 300);

	return {
		locations,
		availability,
		slots,
		stakeCents: settings.base_commitment_fee_cents,
		minimumLeadHours: settings.minimum_acceptance_lead_hours
	};
}
