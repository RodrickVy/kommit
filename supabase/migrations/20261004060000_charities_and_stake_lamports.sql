-- ============================================================================
-- charities, and the lamport amounts actually transferred for a stake
-- ============================================================================

-- ----------------------------------------------------------------------------
-- charities
-- ----------------------------------------------------------------------------
-- Deliberately minimal. Forfeited stakes need a real entity to be sent to, and
-- the active charity needs something to point at. Nothing more is modelled
-- until the Impact flow asks for it.
--
-- A charity receives money into a wallet exactly like any user does, so there
-- is no payout column here — see `wallets.charity_id`.
create table public.charities (
	id uuid primary key default gen_random_uuid(),

	name text not null check (char_length(trim(name)) between 1 and 120),
	description text check (char_length(description) <= 2000),
	logo_path text,

	-- Inactive charities are kept rather than deleted: past votes and past
	-- forfeitures reference them, and that history must stay readable.
	is_active boolean not null default true,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create trigger charities_set_updated_at
	before update on public.charities
	for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Close the dangling references
-- ----------------------------------------------------------------------------
-- These three columns were created before `charities` existed, so they have
-- been holding uuids with nothing enforcing that the charity is real. Now that
-- the table exists, the database can guarantee it.
alter table public.market_settings
	add constraint market_settings_active_charity_fkey
	foreign key (active_charity_id) references public.charities (id) on delete set null;

alter table public.wallets
	add constraint wallets_charity_fkey
	foreign key (charity_id) references public.charities (id) on delete cascade;

alter table public.profiles
	add constraint profiles_last_vote_choice_fkey
	foreign key (last_vote_choice) references public.charities (id) on delete set null;

alter table public.wallet_transactions
	add constraint wallet_transactions_charity_fkey
	foreign key (charity_id) references public.charities (id) on delete set null;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.charities enable row level security;

-- Public. The Impact page shows which charity forfeited stakes go to, and
-- voting requires seeing the options.
create policy "Charities are readable by everyone"
	on public.charities for select
	using (is_active or true);

-- No write policy: charities are managed through the service role only.
revoke all on public.charities from anon, authenticated;
grant select on public.charities to anon, authenticated;

-- ----------------------------------------------------------------------------
-- commitments: what was ACTUALLY transferred
-- ----------------------------------------------------------------------------
-- The stake is quoted in CAD and stored in `*_stake_cents`, which is the
-- business-facing amount a user is shown before they commit.
--
-- But CAD is not what moves. At the moment a stake is locked it is converted
-- to lamports using `market_settings.sol_price_cents`, and THAT is the number
-- that leaves the wallet. These columns record it.
--
-- WHY BOTH, AND WHY REFUNDS MUST USE THE LAMPORTS:
-- the configured rate can be changed by an admin at any time. If a refund
-- reconverted the CAD figure, a rate change between locking and settling would
-- return a different amount of SOL than was taken — silently short-changing
-- one party or paying the other out of the treasury. Recording the exact
-- transferred amount makes a refund an arithmetic fact rather than a
-- recalculation.
--
-- Null until the stake is actually locked, which is how an unfunded request is
-- distinguished from a funded one.
alter table public.commitments
	add column buyer_stake_lamports bigint check (buyer_stake_lamports > 0),
	add column seller_stake_lamports bigint check (seller_stake_lamports > 0);

comment on column public.commitments.buyer_stake_lamports is
	'Exact lamports moved to the Main Wallet when the buyer staked. Refunds use this, never a reconversion of buyer_stake_cents.';

comment on column public.commitments.seller_stake_lamports is
	'Exact lamports moved to the Main Wallet when the seller staked. Refunds use this, never a reconversion of seller_stake_cents.';

-- Neither is settable from a browser. They are written only by the Edge
-- Functions that perform the transfer, in the same operation that moves the
-- money, so a recorded amount always corresponds to a real transfer.
