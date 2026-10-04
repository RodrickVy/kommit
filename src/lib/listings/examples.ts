/**
 * Example content, offered as a one-click fill on the forms that create things.
 *
 * This replaces seeding a whole account at sign-up. The difference matters:
 * bulk seeding drops five listings on someone who has not yet seen what a
 * listing is, and they then have to work out which rows are theirs and which
 * were invented for them. Filling one form on request keeps the user in
 * control — they see exactly what is being written, can edit any of it before
 * saving, and nothing appears that they did not ask for.
 *
 * The listing examples are plain data used CLIENT-SIDE to populate form
 * fields. Nothing here is inserted directly, so every example still goes
 * through the same validation as anything typed by hand.
 */

import type { ListingCondition } from './labels';

export interface ListingExample {
	readonly title: string;
	readonly description: string;
	/** As the form field expects it: plain decimal text, not cents. */
	readonly price: string;
	readonly condition: ListingCondition;
}

/**
 * Deliberately specific and a little worn. A convincing example mentions the
 * scuff on the armrest, because that is what a real listing does and it shows
 * a new seller the level of detail that gets a response.
 */
export const LISTING_EXAMPLES: readonly ListingExample[] = [
	{
		title: 'Herman Miller Aeron chair, size B',
		description:
			'Bought second-hand three years ago and used in a home office. Height and tilt both work smoothly. Some shine on the armrests, which I have photographed rather than hidden.',
		price: '450.00',
		condition: 'used_good'
	},
	{
		title: 'Specialized Sirrus hybrid bike, medium frame',
		description:
			'Ridden one summer along the seawall, stored indoors since. Recently serviced with new cables and a fresh chain. Lock and lights included.',
		price: '320.00',
		condition: 'used_like_new'
	},
	{
		title: 'IKEA Kallax shelf, 4x4, white',
		description:
			'Disassembled and ready to carry. All fixings bagged and taped to the panels. Two small dents on the back board, which faces the wall.',
		price: '60.00',
		condition: 'used_good'
	},
	{
		title: 'Nintendo Switch OLED, boxed with two controllers',
		description:
			'Original box, dock and both Joy-Con pairs. Screen protector on since day one. Factory reset and ready to set up.',
		price: '280.00',
		condition: 'used_like_new'
	},
	{
		title: 'Electric standing desk, 48 inch, black',
		description:
			'Motor works and holds position reliably. The desktop has visible scratches and one chipped corner, so it is priced to reflect that.',
		price: '195.00',
		condition: 'used_fair'
	}
];

/**
 * Public meeting places in Vancouver — busy, well lit, easy to describe to a
 * stranger. Never a home address, which is the point of the whole feature.
 */
export const LOCATION_EXAMPLES = [
	{
		name: 'Vancouver Public Library, Central Branch — main entrance',
		latitude: 49.2796,
		longitude: -123.1156
	},
	{
		name: 'Metrotown Station — bus loop',
		latitude: 49.2258,
		longitude: -122.9999
	},
	{
		name: 'Olympic Village Station — plaza outside the north exit',
		latitude: 49.2663,
		longitude: -123.1156
	}
] as const;

/** Two weekday evenings and a weekend afternoon. 0 = Sunday. */
export const AVAILABILITY_EXAMPLES = [
	{ day_of_week: 2, start_time: '17:00', end_time: '20:00' },
	{ day_of_week: 4, start_time: '17:00', end_time: '20:00' },
	{ day_of_week: 6, start_time: '10:00', end_time: '16:00' }
] as const;
