-- ============================================================================
-- profiles.is_admin, charity details, and the three seeded charities
-- ============================================================================
-- Kommitly's administration surface is deliberately tiny: fund the Main
-- Wallet, and decide which charity forfeited stakes go to. Nothing else about
-- the marketplace is operator-controlled, so nothing else needs a flag.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- profiles.is_admin
-- ----------------------------------------------------------------------------
-- A column rather than a Postgres role or a shared password.
--
--   * a shared password has no record of who used it, and has to travel in a
--     form POST on every visit
--   * a Postgres role could not be checked from application code without
--     another round trip, and does not map to a Supabase auth user
--
-- A column is checkable in one query, attributable to a person, and revocable
-- by setting it false.
alter table public.profiles
	add column is_admin boolean not null default false;

comment on column public.profiles.is_admin is
	'Grants access to /admin. Never settable by the user — see the column grants below.';

-- ----------------------------------------------------------------------------
-- The grant that makes the flag worth anything
-- ----------------------------------------------------------------------------
-- `profiles` previously granted table-wide SELECT to anon and authenticated.
-- Adding a column to a table with a blanket grant silently publishes it, so
-- the grant is replaced with an explicit list.
--
-- Two consequences, both wanted:
--
--   1. `is_admin` is not readable from the browser. Who administers the
--      marketplace is not a secret worth defending hard, but it is also not
--      information any visitor needs, and publishing it just names a target.
--   2. every column added from here on is NOT readable until someone adds it
--      to this list. The failure mode becomes "a field is missing", which is
--      noticed immediately, instead of "a field leaked", which is not.
--
-- `is_admin` is absent from the UPDATE grant too — which was already narrow —
-- so even though a user owns their profile row, they cannot promote
-- themselves. RLS decides rows; only a grant can decide columns.
revoke select on public.profiles from anon, authenticated;

grant select (
	id, display_name, description,
	reputation, reputation_updated_at,
	commitments_total, commitments_successful, commitments_expired,
	commitments_cancelled, commitments_ignored, commitments_stale,
	email_receipts_enabled,
	last_vote, last_vote_choice,
	created_at, updated_at
) on public.profiles to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Granting the first administrator
-- ----------------------------------------------------------------------------
-- Matched on the auth email, which is the only stable human-recognisable
-- identifier — `profiles` deliberately does not store an email, and a uuid
-- would have to be pasted in here and would differ per environment.
--
-- NOT DURABLE ACROSS ACCOUNT DELETION. If this account is removed and
-- recreated it gets a new row with `is_admin` false, and this statement has
-- already run. Re-granting is one line:
--
--   update public.profiles p set is_admin = true
--   from auth.users u where u.id = p.id and u.email = '<email>';
--
-- Left as a one-off rather than a trigger on signup: a trigger would need a
-- table of privileged emails, and a list of who-becomes-admin-on-sight is a
-- larger thing to secure than the single flag it would be setting.
do $$
declare
	granted integer;
begin
	update public.profiles p
		set is_admin = true
		from auth.users u
		where u.id = p.id and u.email = 'rodrielnt@gmail.com';

	get diagnostics granted = row_count;

	if granted = 0 then
		raise notice
			'No profile matched the administrator email. Sign up first, then re-run the UPDATE above.';
	end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- charities: the detail the Impact page needs
-- ----------------------------------------------------------------------------
-- A forfeited stake is a donation someone did not choose to make, so the least
-- the product owes them is a plain statement of where it went and a link they
-- can check for themselves.
alter table public.charities
	add column website_url text
		check (website_url is null or website_url ~ '^https://'),

	-- The name people actually say. "Doctors Without Borders" rather than
	-- "Médecins Sans Frontières", with the legal name kept in `name`.
	add column short_name text
		check (short_name is null or char_length(trim(short_name)) between 1 and 40);

comment on column public.charities.website_url is
	'Must be https. A donation destination shown over plain http is not verifiable.';

-- ----------------------------------------------------------------------------
-- The three charities
-- ----------------------------------------------------------------------------
-- FIXED IDS, inserted here rather than created through the admin UI.
--
-- They are referenced by `market_settings.active_charity_id`, by every
-- `wallet_transactions` row recording a forfeit, and by every charity vote. A
-- charity whose id differed between local, preview and production would make
-- those records unreadable across environments — and a wallet is created per
-- charity id, so a changed id means a wallet holding donations that nothing
-- points at any more.
--
-- `on conflict do nothing` keeps the migration re-runnable and, more
-- importantly, means a later edit through /admin is never reverted by a
-- replay.
insert into public.charities (id, name, short_name, description, website_url, is_active)
values
	(
		'a1f0c3d2-0000-4000-8000-000000000001',
		'United Nations Children''s Fund',
		'UNICEF',
		'Works in over 190 countries on child health, nutrition, clean water, ' ||
		'education and protection, and is usually among the first responders ' ||
		'to emergencies affecting children.',
		'https://www.unicef.org',
		true
	),
	(
		'a1f0c3d2-0000-4000-8000-000000000002',
		'World Wide Fund for Nature',
		'WWF',
		'Conservation of wildlife and the habitats they depend on, with ' ||
		'programmes covering forests, oceans, fresh water, food systems and ' ||
		'climate in nearly 100 countries.',
		'https://www.worldwildlife.org',
		true
	),
	(
		'a1f0c3d2-0000-4000-8000-000000000003',
		'Médecins Sans Frontières',
		'Doctors Without Borders',
		'Independent emergency medical care in conflict zones, epidemics and ' ||
		'disasters, delivered in more than 70 countries on the basis of need ' ||
		'alone.',
		'https://www.doctorswithoutborders.org',
		true
	)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Select one, so a forfeit has somewhere to go
-- ----------------------------------------------------------------------------
-- `settle_stake` REFUSES a forfeit when no charity is selected, because
-- leaving the money in the treasury would make the platform profit from a
-- failed commitment. Correct, but it means an unset charity turns every
-- cancellation into an error — so a default is set here rather than waiting
-- for someone to notice.
--
-- Changed from /admin at any time. Only new forfeits follow the change; past
-- ones recorded the charity they actually went to.
update public.market_settings
	set active_charity_id = 'a1f0c3d2-0000-4000-8000-000000000001'
	where id = 1 and active_charity_id is null;
