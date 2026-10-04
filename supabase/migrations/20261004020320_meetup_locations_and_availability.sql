-- ============================================================================
-- meetup_locations + availability_rules, and their per-listing overrides
-- ============================================================================
-- Both follow the same two-level pattern:
--
--   * the SELLER owns a set of locations / weekly availability rules
--   * those apply to every one of their listings BY DEFAULT
--   * a listing may override with a specific subset
--
-- THE OVERRIDE RULE, which is not visible from the columns alone:
--
--   If a listing has NO rows in the join table, every one of that seller's
--   non-archived entries applies to it. If it has one or more rows, only
--   those apply.
--
-- Absence means "all", not "none". That is what makes reuse free while still
-- allowing a listing to be restricted.
-- ============================================================================

create table public.meetup_locations (
	id uuid primary key default gen_random_uuid(),
	profile_id uuid not null references public.profiles (id) on delete cascade,

	name text not null check (char_length(trim(name)) between 1 and 120),

	-- Full precision, deliberately. The check-in radius is 200m, and a location
	-- recorded sloppily shifts that whole circle: a pin dropped 150m from where
	-- the seller actually waits means someone standing next to them can fail to
	-- check in while someone 350m away succeeds.
	latitude double precision not null check (latitude between -90 and 90),
	longitude double precision not null check (longitude between -180 and 180),

	-- Archived rather than deleted, so a past commitment keeps a valid
	-- reference to where it was meant to happen.
	is_archived boolean not null default false,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index meetup_locations_profile_id_idx
	on public.meetup_locations (profile_id)
	where is_archived = false;

create trigger meetup_locations_set_updated_at
	before update on public.meetup_locations
	for each row execute function public.set_updated_at();

create table public.listing_meetup_locations (
	listing_id uuid not null references public.listings (id) on delete cascade,
	meetup_location_id uuid not null references public.meetup_locations (id) on delete cascade,
	primary key (listing_id, meetup_location_id)
);

-- ----------------------------------------------------------------------------
-- availability_rules — recurring weekly
-- ----------------------------------------------------------------------------
-- A seller does not enter dates. They say "Tuesdays, 5pm to 8pm" once and that
-- holds every week until they change it.
create table public.availability_rules (
	id uuid primary key default gen_random_uuid(),
	profile_id uuid not null references public.profiles (id) on delete cascade,

	-- 0 = Sunday through 6 = Saturday, matching extract(dow from ...).
	day_of_week smallint not null check (day_of_week between 0 and 6),

	start_time time not null,
	end_time time not null,

	-- NOT optional, and not a timestamptz instead.
	--
	-- "Tuesday 5pm" is not an instant; it only becomes one when a timezone
	-- resolves it, and the answer changes twice a year. Storing wall-clock time
	-- plus an IANA zone lets Postgres handle daylight saving and preserves what
	-- the seller meant -- "evenings after work" -- rather than freezing a single
	-- UTC offset that drifts by an hour for half the year.
	timezone text not null default 'America/Vancouver',

	is_archived boolean not null default false,
	created_at timestamptz not null default now(),

	constraint availability_rule_ends_after_it_starts check (end_time > start_time)
);

create index availability_rules_profile_id_idx
	on public.availability_rules (profile_id)
	where is_archived = false;

create table public.listing_availability_rules (
	listing_id uuid not null references public.listings (id) on delete cascade,
	availability_rule_id uuid not null references public.availability_rules (id) on delete cascade,
	primary key (listing_id, availability_rule_id)
);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.meetup_locations enable row level security;
alter table public.listing_meetup_locations enable row level security;
alter table public.availability_rules enable row level security;
alter table public.listing_availability_rules enable row level security;

-- Readable by everyone: a buyer has to see where and when a seller is willing
-- to meet before they can request a commitment. These are public meeting spots
-- the seller chose, not home addresses.
create policy "Meetup locations are readable by everyone"
	on public.meetup_locations for select using (true);

create policy "A seller manages their own meetup locations"
	on public.meetup_locations for all
	using (profile_id = (select auth.uid()))
	with check (profile_id = (select auth.uid()));

create policy "Availability rules are readable by everyone"
	on public.availability_rules for select using (true);

create policy "A seller manages their own availability"
	on public.availability_rules for all
	using (profile_id = (select auth.uid()))
	with check (profile_id = (select auth.uid()));

-- The join tables carry no data of their own, so their policies defer entirely
-- to ownership of the listing they point at.
create policy "Listing location overrides are readable by everyone"
	on public.listing_meetup_locations for select using (true);

create policy "A seller manages location overrides on their own listings"
	on public.listing_meetup_locations for all
	using (
		exists (select 1 from public.listings l
			where l.id = listing_id and l.seller_id = (select auth.uid()))
	)
	with check (
		exists (select 1 from public.listings l
			where l.id = listing_id and l.seller_id = (select auth.uid()))
	);

create policy "Listing availability overrides are readable by everyone"
	on public.listing_availability_rules for select using (true);

create policy "A seller manages availability overrides on their own listings"
	on public.listing_availability_rules for all
	using (
		exists (select 1 from public.listings l
			where l.id = listing_id and l.seller_id = (select auth.uid()))
	)
	with check (
		exists (select 1 from public.listings l
			where l.id = listing_id and l.seller_id = (select auth.uid()))
	);

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke all on public.meetup_locations from anon, authenticated;
grant select on public.meetup_locations to anon, authenticated;
grant insert, update, delete on public.meetup_locations to authenticated;

revoke all on public.availability_rules from anon, authenticated;
grant select on public.availability_rules to anon, authenticated;
grant insert, update, delete on public.availability_rules to authenticated;

revoke all on public.listing_meetup_locations from anon, authenticated;
grant select on public.listing_meetup_locations to anon, authenticated;
grant insert, delete on public.listing_meetup_locations to authenticated;

revoke all on public.listing_availability_rules from anon, authenticated;
grant select on public.listing_availability_rules to anon, authenticated;
grant insert, delete on public.listing_availability_rules to authenticated;
