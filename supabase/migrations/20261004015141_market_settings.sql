-- ============================================================================
-- market_settings + market_settings_history
-- ============================================================================
-- General market configuration. A single row holding every value that governs
-- how the marketplace behaves, so those values can change while the system is
-- running rather than requiring a deployment.
--
-- The parameter columns hold NUMERIC INPUTS to fixed algorithms, never the
-- algorithms themselves. A column whose contents get evaluated is remote code
-- execution inside the service that holds the custodial keys.
-- ============================================================================

create table public.market_settings (
	-- Constrained to a single value so a second configuration row cannot exist.
	-- Two rows would mean two answers to "what is the base fee?".
	id smallint primary key default 1 check (id = 1),

	currency_code text not null default 'CAD' check (char_length(currency_code) = 3),

	base_commitment_fee_cents bigint not null check (base_commitment_fee_cents >= 0),
	min_commitment_fee_cents bigint not null check (min_commitment_fee_cents >= 0),
	max_commitment_fee_cents bigint not null check (max_commitment_fee_cents >= 0),

	check_in_radius_metres integer not null check (check_in_radius_metres > 0),
	request_expiry_hours integer not null check (request_expiry_hours > 0),
	minimum_acceptance_lead_hours integer not null check (minimum_acceptance_lead_hours > 0),
	check_in_window_minutes integer not null check (check_in_window_minutes > 0),

	-- Decides which calendar month a charity vote falls in.
	vote_timezone text not null default 'America/Vancouver',

	-- FK to charities is added by the migration that creates that table.
	active_charity_id uuid,

	-- Written only by the reputation service.
	market_reputation numeric,

	-- Tuning inputs, not formulas.
	market_reputation_params jsonb not null default '{}'::jsonb,
	user_reputation_params jsonb not null default '{}'::jsonb,
	commitment_fee_params jsonb not null default '{}'::jsonb,

	updated_at timestamptz not null default now(),
	updated_by uuid references public.profiles (id) on delete set null,

	-- The floor and ceiling are not decoration. The required stake comes from a
	-- formula whose parameters are editable at runtime, so a mistyped weight
	-- could ask someone for one cent or ten thousand dollars. These bounds turn
	-- a configuration error into a wrong-but-survivable number.
	constraint commitment_fee_bounds_are_ordered
		check (min_commitment_fee_cents <= max_commitment_fee_cents),
	constraint base_commitment_fee_within_bounds
		check (base_commitment_fee_cents between min_commitment_fee_cents and max_commitment_fee_cents)
);

comment on table public.market_settings is
	'Single-row market configuration. Admin write only.';

-- ----------------------------------------------------------------------------
-- History
-- ----------------------------------------------------------------------------
-- market_settings holds one mutable row, so editing it destroys what came
-- before. Stakes and reputation scores are calculated from those parameters,
-- so without a history a stake charged last month cannot be explained.
create table public.market_settings_history (
	id uuid primary key default gen_random_uuid(),
	changed_at timestamptz not null default now(),
	changed_by uuid references public.profiles (id) on delete set null,

	-- The complete row as it stood AFTER the change. A whole-row snapshot
	-- rather than a field-level diff: a diff is smaller but must be replayed
	-- from the beginning to reconstruct any past state, and one missing row
	-- silently corrupts everything after it.
	snapshot jsonb not null,

	note text
);

create index market_settings_history_changed_at_idx
	on public.market_settings_history (changed_at desc);

-- Recorded by a trigger rather than by application code, so that no path can
-- change settings without leaving a record.
create function public.record_market_settings_change()
returns trigger
language plpgsql
as $$
begin
	insert into public.market_settings_history (changed_by, snapshot)
	values (new.updated_by, to_jsonb(new));
	return new;
end;
$$;

create trigger market_settings_record_history
	after insert or update on public.market_settings
	for each row execute function public.record_market_settings_change();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.market_settings enable row level security;
alter table public.market_settings_history enable row level security;

-- Operational values are readable by anyone: the app has to show a buyer the
-- required stake and the check-in radius before they commit.
--
-- There is deliberately NO write policy for either table. Configuration is
-- changed through the service role only, which bypasses RLS. Until an admin
-- role exists, that is the whole of the admin interface, and it keeps the
-- blast radius of a compromised user session at zero.
create policy "Market settings are readable by everyone"
	on public.market_settings for select
	using (true);

-- History is not public. It exposes the parameter weights behind reputation,
-- and publishing those is an invitation to game them.
revoke all on public.market_settings from anon, authenticated;
revoke all on public.market_settings_history from anon, authenticated;
grant select (
	id, currency_code,
	base_commitment_fee_cents, min_commitment_fee_cents, max_commitment_fee_cents,
	check_in_radius_metres, request_expiry_hours,
	minimum_acceptance_lead_hours, check_in_window_minutes,
	vote_timezone, active_charity_id, updated_at
) on public.market_settings to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Seed the single row
-- ----------------------------------------------------------------------------
-- Values confirmed in product direction. The fee bounds are placeholders
-- around the $10 baseline and should be reviewed before real money moves.
insert into public.market_settings (
	id,
	base_commitment_fee_cents,
	min_commitment_fee_cents,
	max_commitment_fee_cents,
	check_in_radius_metres,
	request_expiry_hours,
	minimum_acceptance_lead_hours,
	check_in_window_minutes
) values (1, 1000, 300, 5000, 200, 24, 5, 60);
