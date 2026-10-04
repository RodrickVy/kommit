-- ============================================================================
-- profiles
-- ============================================================================
-- One row per account, extending auth.users.
--
-- Deliberately absent:
--   * password  — authentication credentials live in auth.users, never here
--   * email     — also in auth.users. Product spec §2 requires that one
--                 marketplace user cannot see another's email, and this table
--                 is world-readable, so mirroring it here would defeat that.
--
-- Naming: a profile counts COMMITMENTS. "Transaction" is wallet vocabulary and
-- appears only on wallet tables.
-- ============================================================================

create table public.profiles (
	-- Not a generated id. This IS the auth.users id, so auth.uid() can be
	-- compared against it directly in every policy below.
	id uuid primary key references auth.users (id) on delete cascade,

	display_name text not null check (char_length(trim(display_name)) between 1 and 60),
	description text check (char_length(description) <= 1000),

	-- Written only by the reputation service. Null means "not yet calculated",
	-- which is deliberately distinguishable from a real low score.
	reputation numeric,
	reputation_updated_at timestamptz,

	-- Behavioural counters. See docs/data-model.md for what each one means.
	commitments_total integer not null default 0 check (commitments_total >= 0),
	commitments_successful integer not null default 0 check (commitments_successful >= 0),
	commitments_expired integer not null default 0 check (commitments_expired >= 0),
	commitments_cancelled integer not null default 0 check (commitments_cancelled >= 0),
	commitments_ignored integer not null default 0 check (commitments_ignored >= 0),
	commitments_stale integer not null default 0 check (commitments_stale >= 0),

	email_receipts_enabled boolean not null default false,

	-- Charity voting. The foreign key to charities is added by the migration
	-- that creates that table; nothing writes these columns until then.
	last_vote timestamptz,
	last_vote_choice uuid,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

comment on table public.profiles is
	'Public profile for an account. Contains no credentials and no email.';

-- ----------------------------------------------------------------------------
-- Keep updated_at honest
-- ----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

create trigger profiles_set_updated_at
	before update on public.profiles
	for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Create a profile whenever an account is created
-- ----------------------------------------------------------------------------
-- Runs as SECURITY DEFINER because the inserting role is Supabase Auth, which
-- has no rights on public.profiles. The empty search_path is required: without
-- it, a schema earlier on the path could shadow `profiles` and capture the
-- insert, which is a known privilege-escalation route for definer functions.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.profiles (id, display_name)
	values (
		new.id,
		-- display_name is collected on the sign-up form and passed through as
		-- user metadata. The email local-part is a fallback so the NOT NULL
		-- constraint can never block account creation.
		coalesce(
			nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
			split_part(new.email, '@', 1)
		)
	);
	return new;
end;
$$;

create trigger on_auth_user_created
	after insert on auth.users
	for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Profiles are public: a buyer needs to see who they are committing to meet,
-- including their reputation. Nothing private is stored here.
create policy "Profiles are readable by everyone"
	on public.profiles for select
	using (true);

-- auth.uid() is wrapped in a scalar sub-select so Postgres evaluates it once
-- per statement rather than once per row.
create policy "A user can update their own profile"
	on public.profiles for update
	using ((select auth.uid()) = id)
	with check ((select auth.uid()) = id);

-- No insert or delete policy. Profiles are created by the trigger above and
-- removed by the cascade from auth.users. Neither path is reachable from a
-- client, and adding policies for them would create one.

-- ----------------------------------------------------------------------------
-- Column-level grants
-- ----------------------------------------------------------------------------
-- RLS decides WHICH ROWS a user may touch; it cannot decide which COLUMNS.
-- Without this, the update policy above would let a user set their own
-- reputation and commitment counters — they own the row, after all.
--
-- Only these three columns are a user's to change. Everything else is written
-- by the reputation service or by commitment logic.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (display_name, description, email_receipts_enabled)
	on public.profiles to authenticated;
