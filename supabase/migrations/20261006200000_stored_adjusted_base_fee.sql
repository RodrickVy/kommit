-- ============================================================================
-- The adjusted base fee becomes a stored, real-time value
-- ============================================================================
-- The chain is now complete and entirely trigger-driven:
--
--   a counter changes on a profile
--     -> profiles_recalculate_reputation       recomputes that person's score
--     -> profiles_refresh_market_reputation    recomputes the market average
--     -> market_settings_price                 recomputes the base fee
--     -> market_settings_record_history        records the move, if it moved
--
-- Each step is a trigger on the table it writes, so there is no ordering for
-- application code to get wrong and no path that updates a counter without the
-- price following.
--
-- WHY THE FEE BECOMES A COLUMN
--
-- `adjusted_base_fee_cents()` derived it on every read. Correct, but it meant
-- the marketplace price existed nowhere -- it could not be selected, charted,
-- or recorded in history, and `market_settings_history` had nothing to
-- snapshot. Storing it makes the price a fact with a timestamp.
--
-- WHY IT CANNOT GO STALE
--
-- The usual hazard with a stored derived value is that something changes an
-- input without recomputing it. That is impossible here: the trigger below is
-- BEFORE INSERT OR UPDATE and computes from NEW's own columns, so any
-- statement touching the base fee, the weight or the market average
-- recalculates the price in the same statement, whatever issued it.
-- ============================================================================

alter table public.market_settings
	add column adjusted_base_fee_cents bigint not null default 0
		check (adjusted_base_fee_cents > 0 or adjusted_base_fee_cents = 0);

comment on column public.market_settings.adjusted_base_fee_cents is
	'The live base fee after market reputation. Maintained by market_settings_price; never written by hand.';

-- Public. It is the marketplace's current price and is already shown on /stats.
grant select (adjusted_base_fee_cents) on public.market_settings to anon, authenticated;

-- ----------------------------------------------------------------------------
-- The pricing trigger
-- ----------------------------------------------------------------------------
--     adjusted = base * (1 + (1.000 - market_reputation) * market_reputation_weight)
--
-- Computed from NEW rather than by calling `market_fee_adjustment()`, which
-- reads the committed row and would see the OLD market reputation during a
-- BEFORE trigger. That would price every change one step behind.
--
-- `greatest(..., 1)` for the same reason as before: a weight large enough to
-- drive the adjustment to -1 would otherwise produce a price of zero, and
-- every fee derived from it would silently collapse to the floor.
create or replace function public.price_market_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.adjusted_base_fee_cents := greatest(
		round(
			new.base_commitment_fee_cents
			* (1 + (1.000 - coalesce(new.market_reputation, 1.000)) * new.market_reputation_weight)
		)::bigint,
		1
	);

	return new;
end;
$$;

-- No column list. Pricing depends on three columns and on nothing else
-- changing them quietly, and a BEFORE trigger that only recomputes a value
-- already in the row is cheap enough to run on every write.
create trigger market_settings_price
	before insert or update on public.market_settings
	for each row execute function public.price_market_settings();

-- Fire it once to populate the column from the current state.
update public.market_settings set updated_at = now() where id = 1;

-- ----------------------------------------------------------------------------
-- One source of truth for the price
-- ----------------------------------------------------------------------------
-- `adjusted_base_fee_cents()` now READS the column rather than deriving the
-- value again. Two implementations of a price are two prices, and the one that
-- is wrong is always the one somebody was charged.
--
-- Everything downstream follows without changing: `commitment_fee_cents`,
-- `my_commitment_fee`, `my_reputation_breakdown`, `market_fee_summary` and the
-- event snapshot all call this function.
create or replace function public.adjusted_base_fee_cents()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select adjusted_base_fee_cents
	from public.market_settings
	where id = 1;
$$;

grant execute on function public.adjusted_base_fee_cents() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- The fee chart plots what people actually pay
-- ----------------------------------------------------------------------------
-- `base_fee_history` read `base_commitment_fee_cents` out of each settings
-- snapshot. That column only moves when an admin edits it, so the chart on
-- /stats was a flat line by construction.
--
-- The adjusted fee moves with the marketplace's behaviour, which is the series
-- worth reading like a price. The existing guard in
-- `record_market_settings_change` already does exactly the right filtering for
-- this: it skips a write when nothing but `market_reputation` and `updated_at`
-- changed, so a snapshot now exists precisely when the PRICE moved, and a
-- reputation wobble too small to shift the rounded fee records nothing.
--
-- Rows from before this migration have no adjusted fee in their snapshot and
-- are dropped rather than back-filled from the raw base, which would draw a
-- line that was never the price.
create or replace function public.base_fee_history()
returns table (changed_at timestamptz, base_fee_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
	select changed_at, fee
	from (
		select
			h.changed_at,
			(h.snapshot ->> 'adjusted_base_fee_cents')::bigint as fee,
			lag((h.snapshot ->> 'adjusted_base_fee_cents')::bigint)
				over (order by h.changed_at) as previous
		from public.market_settings_history h
		where h.snapshot ? 'adjusted_base_fee_cents'
			and (h.snapshot ->> 'adjusted_base_fee_cents')::bigint > 0
	) changes
	where previous is distinct from fee
	order by changed_at;
$$;

grant execute on function public.base_fee_history() to anon, authenticated;
