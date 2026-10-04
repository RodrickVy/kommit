-- ============================================================================
-- Listing categories, and a hard cap of five images
-- ============================================================================

-- ----------------------------------------------------------------------------
-- listing_category
-- ----------------------------------------------------------------------------
-- An enum rather than a lookup table, matching `listing_condition` and
-- `listing_status`. The set is fixed, small, and chosen by the product rather
-- than by users, so a table would add a join to every listing query and a
-- foreign key to protect a list nobody edits.
--
-- The cost is that adding a category later needs `ALTER TYPE ... ADD VALUE` in
-- its own migration. That is the right friction: a new category changes what
-- every existing listing is being filtered against, and should be a deliberate
-- change rather than an INSERT somebody makes in a console.
--
-- Values are snake_case identifiers; what a person reads lives in
-- `#lib/listings/labels`, typed as a complete record so adding one here
-- without its label is a compile error rather than a page showing
-- `building_materials` to a buyer.
create type public.listing_category as enum (
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
);

-- NOT NULL with a default, so every listing that already exists gets one
-- without the column having to be nullable forever.
--
-- `other` is the honest default: it says "nobody has categorised this yet"
-- rather than guessing from a title and filing a bicycle under electronics.
-- Sellers can change it at any time from the listing's edit form, and the
-- `other` bucket is where they will find theirs.
alter table public.listings
	add column category public.listing_category not null default 'other';

comment on column public.listings.category is
	'What kind of thing this is. Existing listings defaulted to `other`; sellers can recategorise at any time.';

-- Discover filters on category alongside status, and orders by recency.
-- Partial, for the same reason `listings_active_created_at_idx` is: every
-- other status is invisible there, so indexing those rows would be work the
-- query can never use.
create index listings_category_active_idx
	on public.listings (category, created_at desc)
	where status = 'active';

-- ----------------------------------------------------------------------------
-- At most five images per listing
-- ----------------------------------------------------------------------------
-- Multiple images already worked: `listing_images` holds one row per photo
-- with a `position`, the uploader accepts several files, and the upload action
-- appends them one at a time. There was simply no limit.
--
-- WHY A TRIGGER AND NOT A CHECK ON `position`
--
-- `position < 5` looks like it would do it, and quietly would not. Positions
-- are assigned as `last + 1`, so a listing holding 0,1,2,3,4 that loses its
-- first image has four photos and a next position of 5 — the constraint would
-- refuse a fifth image the seller is entitled to. Counting rows is the rule
-- actually being expressed.
--
-- Enforced here as well as in the upload action, which checks first so the
-- file is never sent to storage only to be rejected. This is the backstop: it
-- is the only one of the two that a second concurrent upload cannot slip past.
create or replace function public.enforce_listing_image_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	max_images constant integer := 5;
	existing integer;
begin
	select count(*) into existing
	from public.listing_images
	where listing_id = new.listing_id;

	if existing >= max_images then
		raise exception 'A listing can have at most % images.', max_images
			using errcode = 'check_violation';
	end if;

	return new;
end;
$$;

create trigger listing_images_limit
	before insert on public.listing_images
	for each row execute function public.enforce_listing_image_limit();

-- Existing listings are left alone. None has more than five today, and
-- deleting somebody's photographs to satisfy a new rule would be the wrong
-- way round: the cap applies from here.
