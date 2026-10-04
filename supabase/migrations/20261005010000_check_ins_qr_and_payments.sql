-- ============================================================================
-- check_ins, qr_tokens, meetup_verifications, payments
-- ============================================================================
-- The second half of a commitment's life: both people arrive, prove they met,
-- and then — optionally and separately — one of them buys the item.
--
-- THE TWO QR CODES ARE NOT THE SAME THING, and conflating them is the single
-- easiest way to break this product:
--
--   QR #1  meetup verification.  Proves the two people were in the same place.
--          Returns both stakes. Buys nothing.
--   QR #2  purchase.             Moves the listing price from buyer to seller.
--          Only exists after QR #1 succeeded, and only if the buyer wants it.
--
-- A buyer who shows up, inspects the item and walks away has fulfilled their
-- commitment completely. That is the whole premise, so nothing here may make
-- purchase a condition of getting a stake back.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- check_ins
-- ----------------------------------------------------------------------------
-- Evidence that a participant physically reached the agreed location. The two
-- timestamp columns already on `commitments` are a denormalised copy for
-- querying; this table is the record of what was actually submitted.
create table public.check_ins (
	id uuid primary key default gen_random_uuid(),

	commitment_id uuid not null references public.commitments (id) on delete cascade,
	profile_id uuid not null references public.profiles (id) on delete cascade,

	-- The role held IN THIS COMMITMENT. The same person is a buyer in one and a
	-- seller in another, so it cannot be read off their profile.
	role public.commitment_party not null,

	latitude double precision not null check (latitude between -90 and 90),
	longitude double precision not null check (longitude between -180 and 180),

	-- Computed at the moment of check-in and STORED, never recomputed.
	--
	-- The permitted radius lives in `market_settings` and an admin can change
	-- it. Recomputing would mean a radius tightened next month could
	-- retroactively invalidate a check-in that was valid when it happened —
	-- and reputation is built on these rows.
	distance_metres numeric not null check (distance_metres >= 0),

	-- Whether `distance_metres` was inside the radius at that moment.
	is_verified boolean not null,

	created_at timestamptz not null default now()
);

create index check_ins_commitment_idx on public.check_ins (commitment_id, created_at);

-- One SUCCESSFUL check-in per role per commitment. Failed attempts are kept —
-- someone standing in the wrong place and trying four times is information,
-- and discarding it would make a later dispute unanswerable — but only one can
-- count.
create unique index check_ins_one_verified_per_role
	on public.check_ins (commitment_id, role)
	where is_verified;

comment on table public.check_ins is
	'Submitted location evidence for a commitment. One verified row per role.';

-- ----------------------------------------------------------------------------
-- qr_tokens
-- ----------------------------------------------------------------------------
-- One table for both QR codes, because a token's lifecycle — issued, expires,
-- consumed once, replaced — is identical whatever it authorises. Two tables
-- would mean two implementations of "used exactly once", and the second one
-- would eventually be wrong.
--
-- WHAT IS STORED IS A HASH, NOT THE TOKEN.
-- The token is a bearer credential: whoever holds it can present it. It is
-- handled exactly like a password — the QR carries the real value, the
-- database keeps only SHA-256 of it. A database dump therefore cannot be used
-- to complete anybody's meetup.
--
-- THE TOKEN IS NOT, BY ITSELF, AUTHORISATION.
-- Presenting a valid token proves someone scanned the seller's screen. It does
-- not prove who they are. Every function that consumes a token independently
-- verifies that the authenticated caller is the commitment's buyer, so a
-- screenshotted QR forwarded to a stranger authorises nothing.
create type public.qr_purpose as enum ('meetup_verification', 'purchase');

create table public.qr_tokens (
	id uuid primary key default gen_random_uuid(),

	commitment_id uuid not null references public.commitments (id) on delete cascade,
	purpose public.qr_purpose not null,

	-- Hex SHA-256 of the token. Unique, so two tokens cannot collide into one.
	token_hash text not null unique,

	-- Who displayed it. Always the seller in both current flows, recorded
	-- rather than assumed so the row explains itself.
	issued_by uuid not null references public.profiles (id) on delete cascade,

	issued_at timestamptz not null default now(),
	expires_at timestamptz not null,

	-- Set when a newer token replaces this one. Distinct from expiry: a revoked
	-- token was deliberately superseded, an expired one simply ran out.
	revoked_at timestamptz,

	consumed_at timestamptz,
	consumed_by uuid references public.profiles (id) on delete set null,

	-- A consumption has a time and an actor, or neither. A half-recorded
	-- consumption would leave "was this used?" unanswerable.
	constraint qr_consumption_is_complete
		check ((consumed_at is null) = (consumed_by is null)),

	constraint qr_expiry_follows_issue check (expires_at > issued_at)
);

create index qr_tokens_commitment_idx on public.qr_tokens (commitment_id, purpose);

-- AT MOST ONE LIVE TOKEN per commitment and purpose.
--
-- This is what makes "refreshing the QR kills the old one" a database fact
-- rather than an intention. Issuing a replacement must revoke the previous
-- token first or the insert is refused — so there is no ordering in which both
-- codes are briefly valid, and a code photographed a minute ago cannot be used
-- after the seller refreshes the display.
create unique index qr_tokens_one_live_per_purpose
	on public.qr_tokens (commitment_id, purpose)
	where consumed_at is null and revoked_at is null;

comment on table public.qr_tokens is
	'Short-lived single-use QR tokens. Stores a hash, never the token itself.';

-- ----------------------------------------------------------------------------
-- meetup_verifications — the result of QR #1
-- ----------------------------------------------------------------------------
-- The business record: these two people met, at this moment, proved by this
-- token. `commitments.meetup_verified_at` is the denormalised copy.
create table public.meetup_verifications (
	id uuid primary key default gen_random_uuid(),

	-- UNIQUE. One verification per commitment, ever. Together with the token's
	-- single use this is belt and braces, and deliberately so: a second
	-- verification would mean a second pair of stake refunds.
	commitment_id uuid not null unique references public.commitments (id) on delete cascade,

	-- `restrict`, not `cascade`. Deleting the token that proved a meetup would
	-- erase the evidence while leaving the conclusion.
	qr_token_id uuid not null references public.qr_tokens (id) on delete restrict,

	displayed_by_profile_id uuid not null references public.profiles (id) on delete cascade,
	scanned_by_profile_id uuid not null references public.profiles (id) on delete cascade,

	verified_at timestamptz not null default now()
);

comment on table public.meetup_verifications is
	'QR #1 result: proof the two parties met. Buys nothing.';

-- ----------------------------------------------------------------------------
-- payments — the result of QR #2
-- ----------------------------------------------------------------------------
-- The optional item purchase, entirely separate from commitment stakes. The
-- Main Wallet is not involved: money goes straight from the buyer's wallet to
-- the seller's.
create type public.payment_status as enum ('pending', 'completed', 'failed');

create table public.payments (
	id uuid primary key default gen_random_uuid(),

	commitment_id uuid not null references public.commitments (id) on delete cascade,

	-- `restrict`. A sold listing cannot be deleted out from under its payment.
	listing_id uuid not null references public.listings (id) on delete restrict,

	buyer_id uuid not null references public.profiles (id) on delete cascade,
	seller_id uuid not null references public.profiles (id) on delete cascade,

	-- What the buyer was quoted, from the listing. The authoritative price.
	amount_cents bigint not null check (amount_cents > 0),

	-- What actually left their wallet. Recorded for the same reason stakes
	-- record theirs: the rate moves, and a refund or a dispute must be able to
	-- state the real figure rather than reconverting and getting a third
	-- answer.
	amount_lamports bigint not null check (amount_lamports > 0),

	-- The rate used, and where it came from — a live quote or the configured
	-- fallback. Without the source, a price that looks wrong a month later
	-- cannot be explained.
	sol_price_cents bigint not null check (sol_price_cents > 0),
	rate_source text not null,

	status public.payment_status not null default 'pending',

	solana_signature text,
	failure_reason text,

	qr_token_id uuid references public.qr_tokens (id) on delete set null,

	created_at timestamptz not null default now(),
	completed_at timestamptz
);

create index payments_commitment_idx on public.payments (commitment_id);
create index payments_buyer_idx on public.payments (buyer_id, created_at desc);
create index payments_seller_idx on public.payments (seller_id, created_at desc);

-- One payment per commitment that is not dead. A failed attempt may be retried;
-- a pending or completed one blocks a second.
create unique index payments_one_live_per_commitment
	on public.payments (commitment_id)
	where status in ('pending', 'completed');

comment on table public.payments is
	'QR #2 result: the optional item purchase. Buyer wallet to seller wallet, direct.';

-- ----------------------------------------------------------------------------
-- market_settings: how long a QR lives
-- ----------------------------------------------------------------------------
-- Short on purpose. The code is shown on one phone and scanned by another
-- standing next to it, so it never needs to survive longer than that
-- conversation — and a short life is what makes a photographed code worthless.
-- The seller can always refresh it, which revokes the previous one.
alter table public.market_settings
	add column qr_token_expiry_minutes integer not null default 10
		check (qr_token_expiry_minutes between 1 and 120);

comment on column public.market_settings.qr_token_expiry_minutes is
	'Lifetime of a QR token. Short deliberately; the seller can refresh.';

grant select (qr_token_expiry_minutes) on public.market_settings to anon, authenticated;

-- `check_in_window_minutes` now governs two deadlines, both one hour by
-- configuration:
--
--   1. after the FIRST participant checks in, how long the second has before
--      they are a no-show
--   2. after BOTH have checked in, how long they have to complete QR #1
--      before the commitment goes stale and both stakes are returned
--
-- One value rather than two because they describe the same thing — how long a
-- meetup is allowed to hang unresolved — and a second knob would eventually be
-- set to a number that contradicts the first.
comment on column public.market_settings.check_in_window_minutes is
	'Minutes allowed for the second check-in, and separately for completing QR #1 once both are checked in.';

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.check_ins enable row level security;
alter table public.qr_tokens enable row level security;
alter table public.meetup_verifications enable row level security;
alter table public.payments enable row level security;

-- Both parties can see the check-ins on their own commitment. Each needs to
-- know whether the other has arrived — that is the whole of the meetup UI.
create policy "Check-ins are visible to both parties"
	on public.check_ins for select
	using (
		exists (
			select 1 from public.commitments c
			where c.id = commitment_id
				and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
		)
	);

-- No insert policy. A check-in is written by the `check_in` Edge Function,
-- which validates the coordinates first. An insert reachable from a browser
-- would let anyone claim to be anywhere, which would make the whole mechanism
-- decorative.

create policy "A verification is visible to both parties"
	on public.meetup_verifications for select
	using (
		exists (
			select 1 from public.commitments c
			where c.id = commitment_id
				and (c.buyer_id = (select auth.uid()) or c.seller_id = (select auth.uid()))
		)
	);

create policy "A payment is visible to its buyer and its seller"
	on public.payments for select
	using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

-- `qr_tokens` gets NO POLICY AT ALL, which with RLS enabled denies every role
-- the browser can reach. Deliberate: a token hash is low-value on its own, but
-- the expiry and consumption state of other people's codes is nobody's
-- business, and the functions return everything the UI needs in their
-- responses. Nothing has to read this table from a page.

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke all on public.check_ins from anon, authenticated;
grant select on public.check_ins to authenticated;

revoke all on public.qr_tokens from anon, authenticated;

revoke all on public.meetup_verifications from anon, authenticated;
grant select on public.meetup_verifications to authenticated;

revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;
