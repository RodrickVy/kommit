-- ============================================================================
-- commitments + commitment_events
-- ============================================================================
-- A commitment is an agreement to MEET, never an agreement to buy. Both sides
-- stake a refundable amount against showing up; the stakes come back when the
-- meetup is verified, whether or not anything is purchased.
--
-- DELIBERATELY NOT IN THIS MIGRATION
-- ----------------------------------
-- Reputation, stake calculation, wallet locking, check-in, QR verification and
-- payment. The columns those features will write are present and nullable, so
-- the shape does not have to change later, but nothing computes them yet.
--
-- Stakes currently default to market_settings.base_commitment_fee_cents for
-- both parties. The specification requires reputation-adjusted, asymmetric
-- amounts; two separate columns exist precisely so that becomes a change to
-- one function rather than a change to this table.
-- ============================================================================

create type public.commitment_party as enum ('buyer', 'seller');

-- Every outcome in the specification stays distinguishable. `declined` and
-- `stale` are not in the original six-value list but are required by the full
-- rules: declining is an action taken before acceptance, and stale is the
-- verdict when responsibility cannot fairly be assigned.
create type public.commitment_status as enum (
	'pending',
	'accepted',
	'declined',
	'expired',
	'cancelled',
	'no_show',
	'stale',
	'completed'
);

create type public.commitment_event_type as enum (
	'request_created',
	'seller_accepted',
	'seller_declined',
	'buyer_withdrew',
	'request_expired',
	'buyer_cancelled',
	'seller_cancelled',
	'buyer_checked_in',
	'seller_checked_in',
	'buyer_no_show',
	'seller_no_show',
	'meetup_verified',
	'commitment_stale',
	'commitment_completed',
	'purchase_completed'
);

create table public.commitments (
	id uuid primary key default gen_random_uuid(),

	listing_id uuid not null references public.listings (id) on delete cascade,
	buyer_id uuid not null references public.profiles (id) on delete cascade,

	-- Copied from the listing at creation rather than joined on read. If a
	-- listing ever changes hands, this row must still record who actually
	-- committed to the meeting.
	seller_id uuid not null references public.profiles (id) on delete cascade,

	meetup_location_id uuid not null references public.meetup_locations (id),

	-- One instant, not a date plus a time. The pair cannot answer "is this in
	-- the past?" without assuming a timezone, and would be wrong twice a year.
	scheduled_at timestamptz not null,

	-- Separate columns because the specification requires the two sides to
	-- stake different, reputation-adjusted amounts. They are equal today only
	-- because nothing calculates them yet.
	buyer_stake_cents bigint not null check (buyer_stake_cents >= 0),
	seller_stake_cents bigint not null check (seller_stake_cents >= 0),

	status public.commitment_status not null default 'pending',

	-- Set only for `cancelled` and `no_show`, where responsibility is known.
	-- Always null for `stale` — that is what stale means.
	responsible_party public.commitment_party,

	-- The acceptance deadline, computed on insert by the trigger below.
	request_expires_at timestamptz not null,

	accepted_at timestamptz,
	declined_at timestamptz,
	cancelled_at timestamptz,

	-- Nullable and unwritten for now. Present so that the check-in and
	-- verification work does not have to alter this table later.
	buyer_checked_in_at timestamptz,
	seller_checked_in_at timestamptz,
	check_in_window_ends_at timestamptz,
	meetup_verified_at timestamptz,
	completed_at timestamptz,

	created_at timestamptz not null default now(),

	-- A person cannot commit to meet themselves, and allowing it would corrupt
	-- every per-role counter built on this table.
	constraint commitment_parties_differ check (buyer_id <> seller_id),

	-- Responsibility is only meaningful for the two outcomes that assign it.
	constraint responsible_party_only_when_assigned check (
		responsible_party is null or status in ('cancelled', 'no_show')
	)
);

comment on table public.commitments is
	'An agreement to meet. Not an agreement to buy.';

create index commitments_buyer_idx on public.commitments (buyer_id, created_at desc);
create index commitments_seller_idx on public.commitments (seller_id, created_at desc);
create index commitments_listing_idx on public.commitments (listing_id);

-- ----------------------------------------------------------------------------
-- What a commitment is unique on
-- ----------------------------------------------------------------------------
-- Enforced in the database rather than in application code, because both rules
-- protect a promise made to a user and neither may be bypassed by a race
-- between two concurrent requests.
--
-- "Live" means pending or accepted. A cancelled, expired, declined or stale
-- commitment releases its hold, which is what lets a listing return to sale
-- automatically.

-- A listing is ONE physical item, so it cannot be promised to two people. This
-- is what `reserved` expresses.
create unique index commitments_one_live_per_listing
	on public.commitments (listing_id)
	where status = 'accepted';

-- Neither party can be in two places at once, even across different listings.
-- Two accepted commitments at the same instant would guarantee a no-show, and
-- the model would then penalise someone for a situation the platform created.
create unique index commitments_seller_one_per_moment
	on public.commitments (seller_id, scheduled_at)
	where status = 'accepted';

create unique index commitments_buyer_one_per_moment
	on public.commitments (buyer_id, scheduled_at)
	where status = 'accepted';

-- A buyer may not hold two open requests on the same listing. Without this,
-- clicking twice creates two requests the seller then has to decline
-- individually.
create unique index commitments_one_open_request_per_buyer
	on public.commitments (listing_id, buyer_id)
	where status = 'pending';

-- ----------------------------------------------------------------------------
-- The acceptance deadline
-- ----------------------------------------------------------------------------
-- request_expires_at = LEAST(created + request_expiry_hours,
--                            scheduled_at - minimum_acceptance_lead_hours)
--
-- The 24-hour window still applies, but never one that runs so close to the
-- meetup that acceptance becomes useless. Accepting is what locks the buyer's
-- stake and starts the clock, so an acceptance at 4:50pm for a 5pm meetup can
-- push an honest buyer straight into a no-show they had no way to avoid.
--
-- Computed by a trigger rather than by the application so that every path --
-- the app, a future admin tool, a manual insert -- gets the same answer.
-- SECURITY DEFINER because it reads market_settings, where ordinary roles hold
-- only column-level SELECT. A trigger runs as the invoking user by default, so
-- without this a buyer creating a request would be refused by the very
-- configuration that tells us when their request expires.
--
-- The empty search_path is mandatory for a definer function: without it a
-- schema earlier on the path could shadow these tables and capture the read.
create function public.set_commitment_request_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	expiry_hours integer;
	lead_hours integer;
begin
	-- Named columns, not `select *`. The row type would demand read access to
	-- every column including the reputation parameters, which are deliberately
	-- not readable.
	select request_expiry_hours, minimum_acceptance_lead_hours
		into expiry_hours, lead_hours
		from public.market_settings where id = 1;

	new.request_expires_at := least(
		new.created_at + make_interval(hours => expiry_hours),
		new.scheduled_at - make_interval(hours => lead_hours)
	);

	-- A meetup sooner than the lead time cannot be requested at all: its
	-- deadline would already have passed. Rejected here rather than inserted
	-- as something instantly expired.
	if new.request_expires_at <= new.created_at then
		raise exception 'A meetup must be at least % hours away.', lead_hours
			using errcode = 'check_violation';
	end if;

	return new;
end;
$$;

create trigger commitments_set_request_expiry
	before insert on public.commitments
	for each row execute function public.set_commitment_request_expiry();

-- ----------------------------------------------------------------------------
-- Keeping the listing's status in step
-- ----------------------------------------------------------------------------
-- An accepted commitment reserves the listing; losing it returns the listing
-- to sale. The specification requires this to be automatic -- a seller whose
-- buyer cancelled at 2am should not wake up to an item that silently stopped
-- being visible.
--
-- Only `active` and `reserved` are touched. A listing that is draft, sold or
-- withdrawn stays as it is: those are the seller's decisions and a commitment
-- has no business overriding them.
-- SECURITY DEFINER for two reasons, both of which would otherwise break it:
--
--   1. The buyer accepting or cancelling does not own the listing, so RLS
--      would refuse their update to it.
--   2. The freeze policy below forbids updating a listing that has an accepted
--      commitment -- which is exactly the moment this trigger has to set it to
--      `reserved`. As an ordinary update it could never succeed.
--
-- This is a system invariant keeping two tables consistent, not a user action,
-- so running it with the owner's rights is correct rather than a shortcut.
create function public.sync_listing_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	target_listing uuid := coalesce(new.listing_id, old.listing_id);
	has_live boolean;
begin
	select exists (
		select 1 from public.commitments
		where listing_id = target_listing and status = 'accepted'
	) into has_live;

	if has_live then
		update public.listings set status = 'reserved'
			where id = target_listing and status = 'active';
	else
		update public.listings set status = 'active'
			where id = target_listing and status = 'reserved';
	end if;

	return null;
end;
$$;

create trigger commitments_sync_listing_reservation
	after insert or update of status or delete on public.commitments
	for each row execute function public.sync_listing_reservation();

-- ----------------------------------------------------------------------------
-- commitment_events — append only
-- ----------------------------------------------------------------------------
-- The specification requires that Kommitly can later answer: what happened,
-- who did it, were they acting as buyer or seller, when, and what outcome
-- resulted. A status column cannot -- it remembers only the final state, and
-- reputation is built from the path rather than the destination.
--
-- This is also what lets the aggregate counters on `profiles` stay as
-- specified while still distinguishing buyer behaviour from seller behaviour.
create table public.commitment_events (
	id uuid primary key default gen_random_uuid(),
	commitment_id uuid not null references public.commitments (id) on delete cascade,

	event_type public.commitment_event_type not null,

	-- Null for system events such as expiry, where no person acted.
	actor_profile_id uuid references public.profiles (id) on delete set null,

	-- The role the actor held IN THIS COMMITMENT. The same person is a buyer
	-- in one and a seller in another, so the role cannot be read off a profile.
	actor_role public.commitment_party,

	occurred_at timestamptz not null default now(),

	-- Event-specific detail. Must never carry money amounts, which belong in
	-- the ledger where they can be reconciled.
	metadata jsonb
);

create index commitment_events_commitment_idx
	on public.commitment_events (commitment_id, occurred_at);

create index commitment_events_actor_idx
	on public.commitment_events (actor_profile_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.commitments enable row level security;
alter table public.commitment_events enable row level security;

-- A commitment is private to the two people in it. Nobody else has any
-- business knowing that a particular buyer arranged to meet a particular
-- seller, which is the same privacy principle that keeps emails and wallet
-- addresses from crossing between users.
create policy "A commitment is visible to its buyer and its seller"
	on public.commitments for select
	using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

-- Only a buyer creates a commitment, and only for themselves. seller_id is
-- checked against the listing so it cannot be forged into someone else's name.
create policy "A buyer can request a commitment on someone else's listing"
	on public.commitments for insert
	with check (
		buyer_id = (select auth.uid())
		and exists (
			select 1 from public.listings l
			where l.id = listing_id
				and l.seller_id = seller_id
				and l.seller_id <> (select auth.uid())
				and l.status = 'active'
		)
	);

-- Both parties may update, because both have moves to make: the seller accepts
-- or declines, either may cancel. WHICH transitions are legal is enforced by
-- the application, not here -- RLS decides who may touch the row, not what a
-- valid state machine looks like.
create policy "Either party can act on their own commitment"
	on public.commitments for update
	using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()))
	with check (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

-- No delete policy. A commitment is a record of what was agreed and what
-- happened; it is resolved by status, never removed.

create policy "Commitment events are visible to both parties"
	on public.commitment_events for select
	using (
		exists (
			select 1 from public.commitments c
			where c.id = commitment_id
				and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
		)
	);

create policy "Either party can record an event on their own commitment"
	on public.commitment_events for insert
	with check (
		exists (
			select 1 from public.commitments c
			where c.id = commitment_id
				and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
		)
	);

-- Append only. No update or delete policy exists, so the history cannot be
-- rewritten by anyone reachable from the application.

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
-- Columns a party may set directly are deliberately narrow. Stakes, the
-- expiry, and every verification timestamp are written by triggers or by
-- privileged code -- never by whoever happens to be submitting the form.
revoke all on public.commitments from anon, authenticated;
grant select on public.commitments to authenticated;
grant insert on public.commitments to authenticated;
grant update (status, responsible_party, accepted_at, declined_at, cancelled_at)
	on public.commitments to authenticated;

revoke all on public.commitment_events from anon, authenticated;
grant select, insert on public.commitment_events to authenticated;

-- ----------------------------------------------------------------------------
-- Freezing a listing that is committed to
-- ----------------------------------------------------------------------------
-- A seller may edit their listing freely — except while someone has an
-- ACCEPTED commitment against it. At that point two people have agreed to meet
-- about a specific item at a specific price, and changing it underneath them
-- turns a reliable meetup into a bait and switch.
--
-- Only `accepted` freezes. A merely `pending` request deliberately does not:
-- anyone can send a request, so if pending froze the listing then a single
-- speculative request would lock a seller's item for up to 24 hours, and doing
-- it repeatedly would be a trivial way to vandalise a competitor.
--
-- The freeze is in the database rather than only in the UI, because it
-- protects the buyer from the seller — and a rule that protects one user from
-- another cannot live in code the second user controls.
drop policy "A seller can update their own listings" on public.listings;

create policy "A seller can update their own listings unless one is committed"
	on public.listings for update
	using (
		seller_id = (select auth.uid())
		and not exists (
			select 1 from public.commitments c
			where c.listing_id = public.listings.id
				and c.status = 'accepted'
		)
	)
	with check (seller_id = (select auth.uid()));

-- Deletion is blocked by the same rule, and for a stronger reason: deleting a
-- listing someone has agreed to meet about would cascade away their commitment
-- and the record of what was promised.
drop policy "A seller can delete their own listings" on public.listings;

create policy "A seller can delete their own listings unless one is committed"
	on public.listings for delete
	using (
		seller_id = (select auth.uid())
		and not exists (
			select 1 from public.commitments c
			where c.listing_id = public.listings.id
				and c.status = 'accepted'
		)
	);
