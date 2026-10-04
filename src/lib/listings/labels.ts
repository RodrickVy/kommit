import type { Database } from '#lib/supabase/database.types';

/**
 * Human-readable labels for the listing enums.
 *
 * The database stores `used_like_new`; a person reads "Used, like new". The
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
	used_like_new: 'Used, like new',
	used_good: 'Used, good',
	used_fair: 'Used, fair'
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

export type ListingCategory = Database['public']['Enums']['listing_category'];

/**
 * What each category is called.
 *
 * A complete `Record`, so adding a value to the database enum without adding
 * its label here is a compile error rather than a page showing
 * `building_materials` to a buyer.
 */
export const CATEGORY_LABELS: Record<ListingCategory, string> = {
	vehicles: 'Vehicles',
	auto_parts: 'Auto Parts & Accessories',
	motorcycles: 'Motorcycles',
	bicycles: 'Bicycles',
	electronics: 'Electronics',
	computers: 'Computers & Accessories',
	phones_tablets: 'Phones & Tablets',
	video_games: 'Video Games & Consoles',
	tvs_audio: 'TVs & Audio Equipment',
	home_furniture: 'Home & Furniture',
	home_appliances: 'Home Appliances',
	kitchen_dining: 'Kitchen & Dining',
	home_decor: 'Home Decor',
	tools_hardware: 'Tools & Hardware',
	garden_outdoor: 'Garden & Outdoor',
	clothing: 'Clothing & Apparel',
	shoes: 'Shoes',
	bags_accessories: 'Bags & Accessories',
	jewelry_watches: 'Jewelry & Watches',
	health_beauty: 'Health & Beauty',
	baby_kids: 'Baby & Kids',
	toys_games: 'Toys & Games',
	sports_fitness: 'Sports & Fitness',
	musical_instruments: 'Musical Instruments',
	books_movies_music: 'Books, Movies & Music',
	pet_supplies: 'Pet Supplies',
	office_business: 'Office & Business Equipment',
	collectibles_antiques: 'Collectibles & Antiques',
	arts_crafts: 'Arts & Crafts',
	industrial_equipment: 'Industrial & Commercial Equipment',
	building_materials: 'Building Materials',
	cameras_photography: 'Cameras & Photography',
	outdoor_recreation: 'Outdoor Recreation',
	seasonal_holiday: 'Seasonal & Holiday Items',
	other: 'Other / Miscellaneous'
};

/**
 * The order the categories are offered in, matching the product's own list.
 *
 * Explicit rather than `Object.keys`, which guarantees no order, and not
 * alphabetical, because the grouping is meaningful: vehicles sit together,
 * then electronics, then the home, and so on. `other` is last, where someone
 * looking for it expects it.
 */
export const CATEGORY_ORDER: readonly ListingCategory[] = [
	'vehicles',
	'auto_parts',
	'motorcycles',
	'bicycles',
	'electronics',
	'computers',
	'phones_tablets',
	'video_games',
	'tvs_audio',
	'home_furniture',
	'home_appliances',
	'kitchen_dining',
	'home_decor',
	'tools_hardware',
	'garden_outdoor',
	'clothing',
	'shoes',
	'bags_accessories',
	'jewelry_watches',
	'health_beauty',
	'baby_kids',
	'toys_games',
	'sports_fitness',
	'musical_instruments',
	'books_movies_music',
	'pet_supplies',
	'office_business',
	'collectibles_antiques',
	'arts_crafts',
	'industrial_equipment',
	'building_materials',
	'cameras_photography',
	'outdoor_recreation',
	'seasonal_holiday',
	'other'
];

/** The cap on photographs per listing, enforced by a trigger in the database. */
export const MAX_LISTING_IMAGES = 5;
