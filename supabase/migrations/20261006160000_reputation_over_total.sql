-- ============================================================================
-- Reputation is measured against commitments_total
-- ============================================================================
-- The three rates now divide by `commitments_total` rather than by
-- `commitments_successful + commitments_cancelled`:
--
--     success_rate      = commitments_successful / commitments_total
--     cancellation_rate = commitments_cancelled  / commitments_total
--     checkin_rate      = commitment_checkins    / commitments_total
--
--     reputation = 1.000
--                + success_rate      * reputation_outcome_weight
--                - cancellation_rate * reputation_outcome_weight
--                + checkin_rate      * reputation_checkin_weight
--
--     commitments_total = 0  ->  1.000
--
-- `expired`, `ignored` and `stale` remain tracked and remain absent from the
-- formula.
--
-- WHY THIS IS BETTER BEHAVED THAN WHAT IT REPLACES
--
-- Under the old denominator, `checkin_rate` could exceed 1: a commitment where
-- you turned up and the other party did not added a check-in without adding
-- anything to `successful + cancelled`. Scores could drift above the nominal
-- ceiling.
--
-- Against the total, every rate is a true proportion of commitments the person
-- took part in. A commitment can be successful or cancelled but not both, and
-- a person checks in at most once per commitment, so each rate is at most 1
-- and the score is bounded at 1.000 - outcome_weight to
-- 1.000 + outcome_weight + checkin_weight -- 0.80 to 1.25 at the current
-- weights.
--
-- It also changes what dilution means. A seller who declines nine requests out
-- of ten still counts all ten in their total, so the rates fall rather than a
-- penalty being applied. Declining stays free, as intended, but it stops
-- reading as a perfect record.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The formula
-- ----------------------------------------------------------------------------
-- A fourth argument rather than reading the profile row, so the function stays
-- pure and one definition serves the trigger, the one-off recalculations and
-- any future caller.
create or replace function public.reputation_score(
	successful integer,
	cancelled integer,
	checkins integer,
	total integer
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
	select case
		when total = 0 then 1.000
		else round(
			1.000
			+ (successful::numeric / total) * s.reputation_outcome_weight
			- (cancelled::numeric / total) * s.reputation_outcome_weight
			+ (checkins::numeric / total) * s.reputation_checkin_weight,
			3
		)
	end
	from public.market_settings s
	where s.id = 1;
$$;

-- ----------------------------------------------------------------------------
-- Every caller moves to the four-argument form
-- ----------------------------------------------------------------------------
create or replace function public.calculate_reputation(target uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
	score numeric;
begin
	update public.profiles
	set
		reputation = public.reputation_score(
			commitments_successful, commitments_cancelled, commitment_checkins, commitments_total
		),
		reputation_updated_at = now()
	where id = target
	returning reputation into score;

	return score;
end;
$$;

create or replace function public.recalculate_reputation_on_counter_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.reputation := public.reputation_score(
		new.commitments_successful, new.commitments_cancelled,
		new.commitment_checkins, new.commitments_total
	);
	new.reputation_updated_at := now();
	return new;
end;
$$;

create or replace function public.rescore_on_weight_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	update public.profiles
	set
		reputation = public.reputation_score(
			commitments_successful, commitments_cancelled, commitment_checkins, commitments_total
		),
		reputation_updated_at = now()
	where id is not null;
	return null;
end;
$$;

-- One definition of the score, so nothing can call a stale three-argument
-- version and get a different answer than the trigger does.
drop function if exists public.reputation_score(integer, integer, integer);

-- ----------------------------------------------------------------------------
-- commitments_total is now an input, so it must trigger a rescore
-- ----------------------------------------------------------------------------
-- Both triggers watched only the three outcome counters. `commitments_total`
-- has just become the denominator of all three rates, so a statement changing
-- it changes the score -- and without it in these lists, the score would be
-- left describing a different denominator than the one it was divided by.
--
-- The two lists must stay identical to each other and to the formula's inputs.
-- If a fifth input ever joins, it belongs in three places: the function, and
-- both of these.
drop trigger if exists profiles_recalculate_reputation on public.profiles;

create trigger profiles_recalculate_reputation
	before update of
		commitments_successful,
		commitments_cancelled,
		commitment_checkins,
		commitments_total
	on public.profiles
	for each row
	when (
		old.commitments_successful is distinct from new.commitments_successful
		or old.commitments_cancelled is distinct from new.commitments_cancelled
		or old.commitment_checkins is distinct from new.commitment_checkins
		or old.commitments_total is distinct from new.commitments_total
	)
	execute function public.recalculate_reputation_on_counter_change();

-- See 20261006130000 for why the column list matters here: `UPDATE OF` is
-- decided from the statement's target columns, so a counter change that
-- alters a score only refreshes the market average if that counter is listed.
drop trigger if exists profiles_refresh_market_reputation on public.profiles;

create trigger profiles_refresh_market_reputation
	after insert or delete or update of
		reputation,
		commitments_successful,
		commitments_cancelled,
		commitment_checkins,
		commitments_total
	on public.profiles
	for each statement
	execute function public.refresh_market_reputation_trigger();

-- ----------------------------------------------------------------------------
-- Repairing commitments_total, once
-- ----------------------------------------------------------------------------
-- WHY THIS IS NECESSARY, AND WHY IT IS NOT A RECOUNT
--
-- Nothing incremented `commitments_total` until 20261006120000, and the
-- commitments that would reconstruct it have since been deleted -- events
-- cascade with them, so neither the commitments table nor the event log can
-- rebuild it. Several profiles therefore hold outcome counters with a total of
-- 0 or 1 behind them.
--
-- Applied directly, the new formula would read those as absurd: a profile with
-- 10 successful meetups and a total of 1 scores 3.3, and profiles with a total
-- of 0 lose their entire record and reset to 1.000.
--
-- So the total is raised to the smallest value consistent with the counters
-- that DO survive:
--
--     greatest(total, successful + cancelled, checkins)
--
-- Each of the three is a lower bound on how many commitments the person took
-- part in: you cannot have succeeded at more commitments than you had, and you
-- cannot have checked in to more. Taking the largest is the least assumption
-- that makes every rate a proportion again.
--
-- It also happens to preserve every existing score exactly. Where
-- `successful + cancelled` is the binding bound, the new formula reduces to
-- the old one -- so this migration reprices nobody, and the new denominator
-- takes over as real commitments accumulate from here.
--
-- Deliberately raising only. A profile whose total is already the largest of
-- the three is left alone, because that is a real count and lowering it would
-- discard good data.
update public.profiles
set commitments_total = greatest(
	commitments_total,
	commitments_successful + commitments_cancelled,
	commitment_checkins
)
where commitments_total < greatest(
	commitments_successful + commitments_cancelled,
	commitment_checkins
);

-- Re-score under the new denominator, then refresh the average. The update
-- above already re-scored the rows it touched; this covers the rest.
update public.profiles
set
	reputation = public.reputation_score(
		commitments_successful, commitments_cancelled, commitment_checkins, commitments_total
	),
	reputation_updated_at = now()
where id is not null;

select public.refresh_market_reputation();

-- ----------------------------------------------------------------------------
-- The breakdown shown on /account follows the same denominator
-- ----------------------------------------------------------------------------
-- Dropped and recreated rather than replaced: `accountable` becomes `total`,
-- and Postgres will not rename an OUT parameter in place.
--
-- The name change is the point. "Accountable" described a denominator that no
-- longer exists, and a panel whose whole purpose is to be checkable must not
-- label a number as something it is not.
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
	base_fee_cents bigint,
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
		s.base_commitment_fee_cents,
		public.commitment_fee_cents((select auth.uid())),
		s.min_commitment_fee_cents,
		s.max_commitment_fee_cents
	from me m
	cross join public.market_settings s
	where s.id = 1;
$$;

revoke all on function public.my_reputation_breakdown() from public, anon;
grant execute on function public.my_reputation_breakdown() to authenticated;
