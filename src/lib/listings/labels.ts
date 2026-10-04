import type { Database } from '#lib/supabase/database.types';

/**
 * Human-readable labels for the listing enums.
 *
 * The database stores `used_like_new`; a person reads "Used — like new". The
 * mapping lives here, once, so a label cannot say one thing on the create form
 * and another on the listing card.
 *
 * Typed as a complete record of each enum, so adding a value to the database
 * without adding its label becomes a compile error rather than a page that
 * renders a raw identifier at someone.
 */

export type ListingCondition = Database['public']['Enums']['listing_condition'];
export type ListingStatus = Database['public']['Enums']['listing_status'];

export const CONDITION_LABELS: Record<ListingCondition, string> = {
	new: 'New',
	used_like_new: 'Used — like new',
	used_good: 'Used — good',
	used_fair: 'Used — fair'
};

/**
 * Ordered best-first, which is the order the create form offers them in.
 * `Object.keys` would not guarantee this.
 */
export const CONDITION_ORDER: readonly ListingCondition[] = [
	'new',
	'used_like_new',
	'used_good',
	'used_fair'
];

export const STATUS_LABELS: Record<ListingStatus, string> = {
	draft: 'Draft',
	active: 'Live',
	reserved: 'Reserved',
	sold: 'Sold',
	withdrawn: 'Withdrawn'
};

/**
 * What each status means, shown to the seller managing a listing. Worth
 * spelling out: "reserved" is not obvious, and a seller seeing it needs to
 * know their item is still theirs.
 */
export const STATUS_DESCRIPTIONS: Record<ListingStatus, string> = {
	draft: 'Only you can see this. Publish it when you are ready.',
	active: 'Visible in Discover. Buyers can request a commitment.',
	reserved: 'A buyer has an accepted commitment. Hidden from Discover until it resolves.',
	sold: 'This item has been sold.',
	withdrawn: 'You have taken this down. Publish again to make it live.'
};

/**
 * Day names indexed to match Postgres `extract(dow from ...)`, where 0 is
 * Sunday. The order is the index, so this array must not be re-sorted.
 */
export const DAY_LABELS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
] as const;
