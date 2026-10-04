import type { CommitmentFee } from '#lib/commitments/fee';
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
	/** What this buyer would put down. Null when signed out or unavailable. */
	stakeCents: number | null;
	/** How that figure was reached, shown beside it. */
	fee: CommitmentFee | null;
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
		return { locations, availability, slots: [], stakeCents: null, fee: null, minimumLeadHours: null };
	}

	const [settingsResult, takenResult, feeResult] = await Promise.all([
		locals.supabase
			.from('market_settings')
			.select('minimum_acceptance_lead_hours')
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
			.eq('status', 'accepted'),
		/**
		 * The viewer's own fee, with every step: the base, what market
		 * reputation did to it, and what their own reputation did to that.
		 * A buyer about to put money down is entitled to see all of it.
		 *
		 * Previously: base fee scaled by their reputation against the
		 * market's. Calculated in the database, the same function the request
		 * itself uses, so what is shown is what is charged.
		 */
		locals.supabase.rpc('my_commitment_fee').maybeSingle()
	]);

	const feeRow = feeResult.data;
	const fee: CommitmentFee | null = feeRow
		? {
				baseFeeCents: Number(feeRow.base_fee_cents),
				reputation: Number(feeRow.reputation),
				marketReputation: Number(feeRow.market_reputation),
				marketReputationWeight: Number(feeRow.market_reputation_weight),
				marketAdjustment: Number(feeRow.market_adjustment),
				adjustedBaseFeeCents: Number(feeRow.adjusted_base_fee_cents),
				feeCents: Number(feeRow.fee_cents)
			}
		: null;

	const settings = settingsResult.data;
	if (!settings) {
		return { locations, availability, slots: [], stakeCents: null, fee: null, minimumLeadHours: null };
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
		stakeCents: fee?.feeCents ?? null,
		fee,
		minimumLeadHours: settings.minimum_acceptance_lead_hours
	};
}
