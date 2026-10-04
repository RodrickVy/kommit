-- ============================================================================
-- The series guards must run BEFORE the query, not beside it
-- ============================================================================
-- THE BUG
--
-- Both series functions were plain SQL, with the bound check as a CTE that the
-- final select cross-joined:
--
--     with guard as (select public.stats_assert_span(...)), ...
--     select ... from grouped g, guard
--
-- A non-recursive CTE carries no ordering guarantee. Postgres inlines it and
-- is free to evaluate `generate_series` first, so the guard contributed
-- nothing: a request for second buckets across a year built thirty-one million
-- rows and died on the statement timeout instead of being refused. A reversed
-- window returned 200 and an empty grid.
--
-- Both are reachable from a query string on a public page, so this was a way
-- to exhaust the database from outside.
--
-- THE FIX
--
-- plpgsql, with the guard as its own statement before `return query`.
-- Statements in a plpgsql body execute in order, which is the guarantee the
-- CTE never gave. The queries themselves are unchanged.
-- ============================================================================

create or replace function public.market_price_series(
	bucket text,
	from_at timestamptz,
	to_at timestamptz
)
returns table (
	bucket_at timestamptz,
	avg_fee_cents numeric,
	avg_reputation numeric,
	min_fee_cents bigint,
	max_fee_cents bigint,
	close_fee_cents bigint,
	close_reputation numeric,
	event_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	step interval;
	lo timestamptz;
	hi timestamptz;
begin
	/** Refuses an unknown unit, a reversed window, or too many buckets. */
	perform public.stats_assert_span(bucket, from_at, to_at);

	step := public.stats_bucket_step(bucket);
	lo := date_trunc(bucket, from_at);
	hi := date_trunc(bucket, to_at);

	return query
	with
	points as (
		-- Behaviour that moved the price, with the count of it per bucket.
		select
			e.occurred_at as at,
			e.market_base_fee_cents as fee,
			e.market_reputation as rep,
			1 as is_event
		from public.commitment_events e
		where e.market_base_fee_cents is not null

		union all

		-- Everything the events cannot see: a signup joining the average, an
		-- admin editing the base fee or the weight.
		select
			h.changed_at,
			(h.snapshot ->> 'adjusted_base_fee_cents')::bigint,
			(h.snapshot ->> 'market_reputation')::numeric,
			0
		from public.market_settings_history h
		where h.snapshot ? 'adjusted_base_fee_cents'
			and (h.snapshot ->> 'adjusted_base_fee_cents')::bigint > 0
	),
	/** The last observation before the window, so bucket one is not blank. */
	seed as (
		select p.fee, p.rep from points p where p.at < lo order by p.at desc limit 1
	),
	bucketed as (
		select
			date_trunc(bucket, p.at) as bucket_at,
			round(avg(p.fee), 2) as avg_fee,
			round(avg(p.rep), 4) as avg_rep,
			min(p.fee) as min_fee,
			max(p.fee) as max_fee,
			(array_agg(p.fee order by p.at desc))[1] as close_fee,
			(array_agg(p.rep order by p.at desc))[1] as close_rep,
			sum(p.is_event)::integer as events
		from points p
		where p.at >= lo and p.at < hi + step
		group by 1
	),
	joined as (
		select
			g as bucket_at,
			k.avg_fee, k.avg_rep, k.min_fee, k.max_fee, k.close_fee, k.close_rep, k.events
		from generate_series(lo, hi, step) g
		left join bucketed k on k.bucket_at = g
	),
	/**
	 * The gap fill. `count()` over an ordered window increments only on
	 * non-null rows, so a run of nulls shares the group of the last observed
	 * value and `first_value` within that group returns it. Postgres has no
	 * `IGNORE NULLS`; this is the standard way around it.
	 */
	grouped as (
		select j.*, count(j.close_fee) over (order by j.bucket_at) as grp from joined j
	)
	select
		g.bucket_at,
		coalesce(g.avg_fee, first_value(g.close_fee) over w, (select s.fee from seed s))::numeric,
		coalesce(g.avg_rep, first_value(g.close_rep) over w, (select s.rep from seed s))::numeric,
		coalesce(g.min_fee, first_value(g.close_fee) over w, (select s.fee from seed s))::bigint,
		coalesce(g.max_fee, first_value(g.close_fee) over w, (select s.fee from seed s))::bigint,
		coalesce(first_value(g.close_fee) over w, (select s.fee from seed s))::bigint,
		coalesce(first_value(g.close_rep) over w, (select s.rep from seed s))::numeric,
		coalesce(g.events, 0)
	from grouped g
	window w as (partition by g.grp order by g.bucket_at)
	order by g.bucket_at;
end;
$$;

grant execute on function public.market_price_series(text, timestamptz, timestamptz)
	to anon, authenticated;

create or replace function public.charity_donation_series(
	bucket text,
	from_at timestamptz,
	to_at timestamptz
)
returns table (
	bucket_at timestamptz,
	lamports bigint,
	donation_count integer,
	cumulative_lamports bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	step interval;
	lo timestamptz;
	hi timestamptz;
begin
	perform public.stats_assert_span(bucket, from_at, to_at);

	step := public.stats_bucket_step(bucket);
	lo := date_trunc(bucket, from_at);
	hi := date_trunc(bucket, to_at);

	return query
	with forfeits as (
		select
			date_trunc(bucket, t.completed_at) as bucket_at,
			sum(t.lamports)::bigint as lamports,
			count(*)::integer as donations
		from public.wallet_transactions t
		where t.type = 'commitment_forfeit'
			/**
			 * Completed only. A pending transfer has not reached the charity and
			 * a failed one never will, so counting either would overstate what
			 * was actually donated.
			 */
			and t.status = 'completed'
			/** `completed_at`, not `created_at`: when the money actually landed. */
			and t.completed_at is not null
			and t.completed_at >= lo
			and t.completed_at < hi + step
		group by 1
	)
	select
		g as bucket_at,
		coalesce(f.lamports, 0),
		coalesce(f.donations, 0),
		sum(coalesce(f.lamports, 0)) over (order by g)::bigint
	from generate_series(lo, hi, step) g
	left join forfeits f on f.bucket_at = g
	order by g;
end;
$$;

-- No carry-forward here, unlike the price series, and the difference matters:
-- a bucket with no donations really did receive nothing. Zero is the truth,
-- and carrying a figure forward would draw donations that never happened.

grant execute on function public.charity_donation_series(text, timestamptz, timestamptz)
	to anon, authenticated;
