-- ============================================================================
-- The base fee self-corrects against market reputation
-- ============================================================================
--     market_adjustment = (1.000 - market_reputation) * market_reputation_weight
--     adjusted_base_fee = base_commitment_fee_cents * (1 + market_adjustment)
--
-- 1.000 is the neutral point, because it is the score a profile with no
-- history has. A market averaging exactly 1.000 pays the base fee unchanged.
--
--     average below 1.000  ->  people are less reliable  ->  base fee rises
--     average above 1.000  ->  people are more reliable  ->  base fee falls
--
-- That is the self-correcting loop: worse behaviour across the marketplace
-- makes every stake larger, which makes following through matter more; as
-- behaviour improves the stake relaxes again.
--
-- WHY THIS REPLACES A DIVISION
--
-- The fee previously divided by market reputation as well as by the
-- individual's. Two problems with that. It had no neutral point -- there was
-- no average at which the base fee was simply the base fee -- and the strength
-- of the market's influence was fixed, with no way to tune it. Expressing it
-- as an adjustment around 1.000, scaled by a configurable weight, fixes both.
--
-- The individual's reputation still divides the adjusted base, which is the
-- behaviour already agreed: more reliable than average pays less. It now
-- applies ON TOP of the market-adjusted base rather than beside it, so the two
-- effects compose instead of competing.
-- ============================================================================

alter table public.market_settings
	-- How hard the market average pulls the base fee. 0 disables the mechanism
	-- entirely and leaves the base fee alone; 1 means a market average of 0.90
	-- raises the base fee by a full 10%.
	--
	-- Bounded at 5 rather than 1 so the effect can be amplified, and bounded at
	-- all because this multiplies a price. The fee's own floor and ceiling are
	-- the real backstop.
	add column market_reputation_weight numeric not null default 0.50
		check (market_reputation_weight between 0 and 5);

comment on column public.market_settings.market_reputation_weight is
	'Scales how far the market average moves the base fee. 0 switches the mechanism off.';

-- Shown on /stats and in the fee explanation, so the figure can be checked.
grant select (market_reputation_weight) on public.market_settings to anon, authenticated;

-- ----------------------------------------------------------------------------
-- The adjustment, and the adjusted base
-- ----------------------------------------------------------------------------
-- Separate functions so the number shown to a user and the number charged come
-- from one definition. A page that recomputed either in TypeScript could
-- disagree with the fee, and the version the user was shown would be the wrong
-- one.
create or replace function public.market_fee_adjustment()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
	select round((1.000 - coalesce(s.market_reputation, 1.000)) * s.market_reputation_weight, 4)
	from public.market_settings s
	where s.id = 1;
$$;

comment on function public.market_fee_adjustment is
	'Fractional change to the base fee from market reputation. Negative when the market is above 1.000.';

create or replace function public.adjusted_base_fee_cents()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select greatest(
		round(s.base_commitment_fee_cents * (1 + public.market_fee_adjustment()))::bigint,
		1
	)
	from public.market_settings s
	where s.id = 1;
$$;

-- `greatest(..., 1)` because a weight large enough to make the adjustment
-- reach -1 would otherwise produce a base of zero or below, and every fee
-- derived from it would collapse to the floor with no way to see why. One cent
-- is nonsense too, but it is visibly nonsense.
comment on function public.adjusted_base_fee_cents is
	'The base commitment fee after market reputation. What an average-reputation user pays before their own adjustment.';

-- Public: /stats shows both, and neither is sensitive. They are derived from
-- the base fee and the market average, both of which are already readable.
grant execute on function public.market_fee_adjustment() to anon, authenticated;
grant execute on function public.adjusted_base_fee_cents() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- The fee an individual pays
-- ----------------------------------------------------------------------------
--     fee = clamp(adjusted_base_fee / your_reputation, min, max)
--
-- The market half is already in `adjusted_base_fee_cents`, so this function is
-- only the individual half. Dividing by the adjusted base rather than
-- recomputing it keeps the figure shown as "adjusted base" on /stats and the
-- figure actually charged provably identical.
create or replace function public.commitment_fee_cents(target uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select least(
		greatest(
			round(
				public.adjusted_base_fee_cents()
				/ greatest(coalesce(p.reputation, 1.000), 0.001)
			)::bigint,
			s.min_commitment_fee_cents
		),
		s.max_commitment_fee_cents
	)
	from public.market_settings s
	left join public.profiles p on p.id = target
	where s.id = 1;
$$;

revoke all on function public.commitment_fee_cents(uuid) from public, anon, authenticated;
grant execute on function public.commitment_fee_cents(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- What the marketplace as a whole currently costs
-- ----------------------------------------------------------------------------
-- For the headline figures on /stats. Public, and deliberately says nothing
-- about any individual.
create or replace function public.market_fee_summary()
returns table (
	market_reputation numeric,
	market_reputation_weight numeric,
	market_adjustment numeric,
	base_fee_cents bigint,
	adjusted_base_fee_cents bigint,
	min_fee_cents bigint,
	max_fee_cents bigint,
	scored_profiles integer
)
language sql
stable
security definer
set search_path = ''
as $$
	select
		coalesce(s.market_reputation, 1.000),
		s.market_reputation_weight,
		public.market_fee_adjustment(),
		s.base_commitment_fee_cents,
		public.adjusted_base_fee_cents(),
		s.min_commitment_fee_cents,
		s.max_commitment_fee_cents,
		(select count(*)::integer from public.profiles where reputation is not null)
	from public.market_settings s
	where s.id = 1;
$$;

grant execute on function public.market_fee_summary() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- The per-user breakdown gains the market half
-- ----------------------------------------------------------------------------
-- Dropped and recreated because the column list changes; Postgres will not add
-- OUT parameters in place.
--
-- The point of the three new columns is that the account page can state the
-- MONEY impact of reputation, not just the score. Someone looking at 1.175
-- learns nothing until they see it saves them a specific number of dollars
-- against what an average user pays.
drop function if exists public.my_reputation_breakdown();

create function public.my_reputation_breakdown()
returns table (
	successful integer,
	cancelled integer,
	checkins integer,
	total integer,
	success_rate numeric,
	cancel_rate numeric,
	checkin_rate numeric,
	outcome_weight numeric,
	checkin_weight numeric,
	success_points numeric,
	cancel_points numeric,
	checkin_points numeric,
	reputation numeric,
	reputation_updated_at timestamptz,
	market_reputation numeric,
	market_reputation_weight numeric,
	market_adjustment numeric,
	base_fee_cents bigint,
	adjusted_base_fee_cents bigint,
	fee_cents bigint,
	min_fee_cents bigint,
	max_fee_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
	with me as (
		select
			p.commitments_successful as successful,
			p.commitments_cancelled as cancelled,
			p.commitment_checkins as checkins,
			p.commitments_total as total,
			p.reputation,
			p.reputation_updated_at
		from public.profiles p
		where p.id = (select auth.uid())
	)
	select
		m.successful,
		m.cancelled,
		m.checkins,
		m.total,
		-- NULL rather than 0 with no history. A rate of 0 reads as "you have a
		-- 0% success rate", which is a judgement; null is the truth, which is
		-- that there is nothing yet to judge.
		case when m.total = 0 then null else round(m.successful::numeric / m.total, 4) end,
		case when m.total = 0 then null else round(m.cancelled::numeric / m.total, 4) end,
		case when m.total = 0 then null else round(m.checkins::numeric / m.total, 4) end,
		s.reputation_outcome_weight,
		s.reputation_checkin_weight,
		case when m.total = 0 then null
			else round((m.successful::numeric / m.total) * s.reputation_outcome_weight, 4) end,
		case when m.total = 0 then null
			else round((m.cancelled::numeric / m.total) * s.reputation_outcome_weight, 4) end,
		case when m.total = 0 then null
			else round((m.checkins::numeric / m.total) * s.reputation_checkin_weight, 4) end,
		-- Read back, never recomputed. The parts and the total must agree, and
		-- this is the number the fee was actually calculated from.
		m.reputation,
		m.reputation_updated_at,
		coalesce(s.market_reputation, 1.000),
		s.market_reputation_weight,
		public.market_fee_adjustment(),
		s.base_commitment_fee_cents,
		public.adjusted_base_fee_cents(),
		public.commitment_fee_cents((select auth.uid())),
		s.min_commitment_fee_cents,
		s.max_commitment_fee_cents
	from me m
	cross join public.market_settings s
	where s.id = 1;
$$;

revoke all on function public.my_reputation_breakdown() from public, anon;
grant execute on function public.my_reputation_breakdown() to authenticated;

-- ----------------------------------------------------------------------------
-- The acceptance lead time is gone on purpose
-- ----------------------------------------------------------------------------
-- 20261006040000 is named "testing_allow_any_meetup_time" and removed the
-- clamp that pulled a request's expiry back to
-- `scheduled_at - minimum_acceptance_lead_hours`. That is now the intended
-- behaviour, not a temporary relaxation, so it is restated here deliberately
-- rather than left looking like something half-reverted.
--
-- Nothing is lost by dropping it. The clamp existed because acceptance started
-- a one-hour check-in window, so a late acceptance could push an honest buyer
-- into an unavoidable no-show. Check-in is now open for the whole meetup DAY,
-- which removes the hazard: accepting at 4:50pm for a 5pm meetup leaves both
-- parties until midnight.
--
-- `minimum_acceptance_lead_hours` stays in `market_settings` and is still used
-- to decide which slots a buyer is offered, so a meetup cannot be requested
-- for five minutes' time. It simply no longer shortens the expiry.
create or replace function public.set_commitment_request_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	expiry_hours integer;
begin
	select request_expiry_hours into expiry_hours
		from public.market_settings where id = 1;

	new.request_expires_at := new.created_at + make_interval(hours => expiry_hours);

	return new;
end;
$$;
