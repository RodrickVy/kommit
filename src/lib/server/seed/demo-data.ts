import { adminClient } from '#lib/server/supabase/admin-client';
import type { Database } from '#lib/supabase/database.types';

/**
 * Optional demo data for a brand-new account.
 *
 * Offered as a checkbox on the join form. An empty marketplace is impossible
 * to evaluate — there is nothing to browse, nothing to open, and no way to see
 * what a listing looks like — so a new account can start with something in it.
 *
 * WHY THE ADMIN CLIENT
 * --------------------
 * This runs immediately after sign-up, and at that moment there may be no
 * session at all: if the project requires email confirmation, the account
 * exists but nobody is signed in, so a request-scoped client would be refused
 * by Row Level Security on every insert.
 *
 * Seeding is also genuinely not a user action. It is an administrative
 * operation performed on behalf of an account that has just been created,
 * which is exactly the case `adminClient()` documents as legitimate.
 *
 * Everything written is scoped to the one `userId` passed in. The admin client
 * bypasses RLS, so that scoping is this function's responsibility and not the
 * database's — hence every insert below sets the owner explicitly.
 */

type ListingInsert = Database['public']['Tables']['listings']['Insert'];

/**
 * Public meeting places in Vancouver. Deliberately busy, well-lit, easy to
 * describe — the kind of place a stranger meetup should actually happen.
 * Never a home address.
 */
const DEMO_LOCATIONS = [
	{
		name: 'Vancouver Public Library, Central Branch — main entrance',
		latitude: 49.2796,
		longitude: -123.1156
	},
	{
		name: 'Metrotown Station — bus loop',
		latitude: 49.2258,
		longitude: -122.9999
	}
] as const;

/** Weekday evenings and a weekend afternoon. 0 = Sunday. */
const DEMO_AVAILABILITY = [
	{ day_of_week: 2, start_time: '17:00', end_time: '20:00' },
	{ day_of_week: 4, start_time: '17:00', end_time: '20:00' },
	{ day_of_week: 6, start_time: '10:00', end_time: '16:00' }
] as const;

/**
 * Five listings. Prices are in CAD cents, as every money value is.
 *
 * One is left as a draft on purpose, so the seller immediately sees both
 * states on their listings page and can tell that drafts are private.
 */
const DEMO_LISTINGS: ReadonlyArray<Omit<ListingInsert, 'seller_id'>> = [
	{
		title: 'Herman Miller Aeron chair, size B',
		description:
			'Bought second-hand three years ago and used in a home office. Height and tilt both work smoothly. Some shine on the armrests, shown honestly in the photos.',
		price_cents: 45_000,
		condition: 'used_good',
		status: 'active'
	},
	{
		title: 'Specialized Sirrus hybrid bike, medium frame',
		description:
			'Ridden one summer along the seawall and then stored indoors. Recently serviced — new cables and a fresh chain. Lock and lights included.',
		price_cents: 32_000,
		condition: 'used_like_new',
		status: 'active'
	},
	{
		title: 'IKEA Kallax shelf, 4x4, white',
		description:
			'Disassembled and ready to transport. All fixings are bagged and taped to the panels. Two small dents on the back board that face the wall.',
		price_cents: 6_000,
		condition: 'used_good',
		status: 'active'
	},
	{
		title: 'Nintendo Switch OLED, boxed with two controllers',
		description:
			'Original box, dock, and both Joy-Con pairs. Screen has had a protector on it since day one. Factory reset and ready to set up.',
		price_cents: 28_000,
		condition: 'used_like_new',
		status: 'active'
	},
	{
		title: 'Electric standing desk, 48 inch, black',
		description:
			'Motor works and holds position. The desktop has visible scratches and one chipped corner, so it is priced to reflect that.',
		price_cents: 19_500,
		condition: 'used_fair',
		status: 'draft'
	}
];

/** What happened, so the join page can tell the user honestly. */
export interface SeedResult {
	readonly listings: number;
	readonly locations: number;
	readonly availabilityRules: number;
}

/**
 * Populates a new account with demo listings, meetup locations and weekly
 * availability.
 *
 * @param userId The profile to seed. Every row written belongs to this user.
 * @returns Counts of what was created.
 * @throws If any insert fails. The caller decides whether that should fail the
 *         sign-up — it should not, see the note at the call site.
 */
export async function seedDemoData(userId: string): Promise<SeedResult> {
	const supabase = adminClient();

	const { data: locations, error: locationError } = await supabase
		.from('meetup_locations')
		.insert(DEMO_LOCATIONS.map((location) => ({ ...location, profile_id: userId })))
		.select('id');

	if (locationError) throw locationError;

	const { data: availability, error: availabilityError } = await supabase
		.from('availability_rules')
		.insert(DEMO_AVAILABILITY.map((rule) => ({ ...rule, profile_id: userId })))
		.select('id');

	if (availabilityError) throw availabilityError;

	const { data: listings, error: listingError } = await supabase
		.from('listings')
		.insert(DEMO_LISTINGS.map((listing) => ({ ...listing, seller_id: userId })))
		.select('id');

	if (listingError) throw listingError;

	/**
	 * No rows are written to the override join tables, and that is the point.
	 * An empty override means "every one of this seller's locations and rules
	 * applies to this listing" — which is the behaviour a new seller wants, and
	 * a working demonstration of the default.
	 */
	return {
		listings: listings?.length ?? 0,
		locations: locations?.length ?? 0,
		availabilityRules: availability?.length ?? 0
	};
}
