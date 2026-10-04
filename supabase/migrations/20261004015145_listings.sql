-- ============================================================================
-- listings + listing_images
-- ============================================================================
-- A listing is ONE physical item. There is deliberately no quantity column:
-- a seller with three identical chairs creates three listings.
--
-- That constraint is what makes the rest of the model work. Because an item is
-- singular it can carry at most one live commitment, which is what `reserved`
-- expresses and what lets the platform promise a buyer that the thing they are
-- driving across town for still exists.
-- ============================================================================

-- The four grades Facebook Marketplace uses. Buyers and sellers arrive with
-- this vocabulary already learned; a different scale would only make listings
-- harder to compare.
create type public.listing_condition as enum (
	'new',
	'used_like_new',
	'used_good',
	'used_fair'
);

create type public.listing_status as enum (
	'draft',
	'active',
	'reserved',
	'sold',
	'withdrawn'
);

create table public.listings (
	id uuid primary key default gen_random_uuid(),
	seller_id uuid not null references public.profiles (id) on delete cascade,

	title text not null check (char_length(trim(title)) between 1 and 120),
	description text check (char_length(description) <= 4000),

	-- CAD cents. Integer, never a float: 0.1 + 0.2 != 0.3 is not acceptable
	-- where money is concerned.
	price_cents bigint not null check (price_cents >= 0),

	condition public.listing_condition not null,
	status public.listing_status not null default 'draft',

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

comment on table public.listings is
	'One listing is one physical item. No quantity column, by design.';

create trigger listings_set_updated_at
	before update on public.listings
	for each row execute function public.set_updated_at();

-- Browsing /discover filters on status and orders by recency, so the index
-- carries both. Partial, because every other status is invisible there and
-- there is no reason to index rows the query can never return.
create index listings_active_created_at_idx
	on public.listings (created_at desc)
	where status = 'active';

-- A seller's own listing management page filters by owner.
create index listings_seller_id_idx on public.listings (seller_id);

-- ----------------------------------------------------------------------------
-- listing_images
-- ----------------------------------------------------------------------------
-- A separate table rather than an array column, so ordering is explicit and a
-- primary image can be designated. An array gives neither without convention.
create table public.listing_images (
	id uuid primary key default gen_random_uuid(),
	listing_id uuid not null references public.listings (id) on delete cascade,

	-- Path inside the kommit_media storage bucket. Not a URL: a stored URL
	-- would bake in the project host and break if the bucket ever moves.
	storage_path text not null,

	-- Zero-based. Position 0 is the primary image, which is what /discover
	-- shows in the grid.
	position integer not null check (position >= 0),

	created_at timestamptz not null default now(),

	constraint listing_images_position_unique unique (listing_id, position)
);

create index listing_images_listing_id_idx
	on public.listing_images (listing_id, position);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;

-- Anyone may read an active listing. A seller may additionally read their own
-- in any state, which is what makes drafts work.
--
-- Note this is one policy, not two: multiple permissive SELECT policies are
-- OR-ed, so a second policy for owners would be equivalent but would make the
-- combined rule harder to read in one place.
create policy "Active listings are readable by everyone, drafts by their owner"
	on public.listings for select
	using (
		status = 'active'
		or seller_id = (select auth.uid())
	);

create policy "A seller can create their own listings"
	on public.listings for insert
	with check (seller_id = (select auth.uid()));

create policy "A seller can update their own listings"
	on public.listings for update
	using (seller_id = (select auth.uid()))
	with check (seller_id = (select auth.uid()));

create policy "A seller can delete their own listings"
	on public.listings for delete
	using (seller_id = (select auth.uid()));

-- Images inherit their listing's visibility. The sub-select repeats the rule
-- above rather than trusting that a caller who has the image row is entitled
-- to it: an image path is enough to fetch the file, so an unlisted draft's
-- photographs must not be enumerable.
create policy "Listing images follow their listing's visibility"
	on public.listing_images for select
	using (
		exists (
			select 1 from public.listings l
			where l.id = listing_id
				and (l.status = 'active' or l.seller_id = (select auth.uid()))
		)
	);

create policy "A seller can attach images to their own listings"
	on public.listing_images for insert
	with check (
		exists (
			select 1 from public.listings l
			where l.id = listing_id and l.seller_id = (select auth.uid())
		)
	);

create policy "A seller can remove images from their own listings"
	on public.listing_images for delete
	using (
		exists (
			select 1 from public.listings l
			where l.id = listing_id and l.seller_id = (select auth.uid())
		)
	);

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
-- seller_id is insertable but NOT updatable. RLS already prevents setting it to
-- someone else, but withholding the column means a listing can never change
-- owner at all, which is not a thing this product supports.
revoke all on public.listings from anon, authenticated;
grant select on public.listings to anon, authenticated;
grant insert on public.listings to authenticated;
grant update (title, description, price_cents, condition, status)
	on public.listings to authenticated;
grant delete on public.listings to authenticated;

revoke all on public.listing_images from anon, authenticated;
grant select on public.listing_images to anon, authenticated;
grant insert, delete on public.listing_images to authenticated;
