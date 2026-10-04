-- ============================================================================
-- Time-bucketed series for /stats
-- ============================================================================
-- Two functions, same shape of argument: a bucket unit, a window, and one row
-- per bucket. Zooming from weeks to seconds is the same query with a different
-- unit, so the chart has one code path rather than five.
--
--   market_price_series     the base fee and market reputation over time
--   charity_donation_series forfeited stakes over time
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared guards
-- ----------------------------------------------------------------------------
-- `date_trunc` accepts the unit as text, so the value is parameterised rather
-- than interpolated and cannot carry SQL. It is still validated here, because
-- an unrecognised unit otherwise fails deep inside the query with a message
-- about `date_trunc` that tells a caller nothing about which argument was
-- wrong.
create or replace function public.stats_bucket_step(bucket text)
returns interval
language plpgsql
immutable
set search_path = ''
as $$
begin
	if bucket not in ('second', 'minute', 'hour', 'day', 'week') then
		raise exception 'bucket must be one of second, minute, hour, day, week (got %)', bucket
			using errcode = 'invalid_parameter_value';
	end if;

	return ('1 ' || bucket)::interval;
end;
$$;

-- A hard ceiling on how many rows a single call can produce.
--
-- NOT a nicety. These functions build their buckets with `generate_series`, so
-- a second-by-second request across a year is thirty-one million rows -- enough
-- to exhaust memory on the database rather than return slowly. The chart is
-- expected to narrow its window as it zooms in, which is exactly the usage
-- this bound describes.
create or replace function public.stats_assert_span(
	bucket text,
	from_at timestamptz,
	to_at timestamptz
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
	max_buckets constant integer := 5000;
	step interval := public.stats_bucket_step(bucket);
	buckets numeric;
begin
	if to_at <= from_at then
		raise exception 'to_at must be after from_at'
			using errcode = 'invalid_parameter_value';
	end if;

	buckets := extract(epoch from (to_at - from_at)) / extract(epoch from step);

	if buckets > max_buckets then
		raise exception
			'% buckets of 1 % exceeds the limit of %; narrow the window or widen the bucket',
			ceil(buckets), bucket, max_buckets
			using errcode = 'invalid_parameter_value';
	end if;
end;
$$;

grant execute on function public.stats_bucket_step(text) to anon, authenticated;
grant execute on function public.stats_assert_span(text, timestamptz, timestamptz) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- market_price_series
-- ----------------------------------------------------------------------------
-- The base fee and the market average, bucketed by when they were observed.
--
-- TWO SOURCES, UNIONED, because neither is complete on its own:
--
--   commitment_events        carries a snapshot of both figures taken at the
--                            moment of every outcome. This is the behaviour
--                            that moves the price, and `event_count` reports
--                            how much of it fell in each bucket.
--   market_settings_history  every actual change to the settings row. Picks up
--                            the moves commitment events cannot see: a new
--                            signup joining the average at 1.000, an admin
--                            editing the base fee or the weight.
--
-- Using only the events would make the chart lag reality; using only the
-- history would lose the link between a price move and the activity that
-- caused it.
--
-- EMPTY BUCKETS CARRY FORWARD rather than reading as gaps or as zero. A bucket
-- with no observations does not mean the price was nothing; it means nothing
-- happened, and the line should stay where it was. That is also what makes
-- zooming into seconds useful instead of mostly blank.
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
	/** The last observation in the bucket: the closing price, for a line chart. */
	close_fee_cents bigint,
	close_reputation numeric,
	/** How many commitment outcomes fell in this bucket. Zero for a carried-forward bucket. */
	event_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
	with
	guard as (select public.stats_assert_span(bucket, from_at, to_at)),
	step as (select public.stats_bucket_step(bucket) as size),
	bounds as (
		select
			date_trunc(bucket, from_at) as lo,
			date_trunc(bucket, to_at) as hi
	),
	points as (
		select
			e.occurred_at as at,
			e.market_base_fee_cents as fee,
			e.market_reputation as rep,
			1 as is_event
		from public.commitment_events e
		where e.market_base_fee_cents is not null

		union all

		select
			h.changed_at,
			(h.snapshot ->> 'adjusted_base_fee_cents')::bigint,
			(h.snapshot ->> 'market_reputation')::numeric,
			0
		from public.market_settings_history h
		where h.snapshot ? 'adjusted_base_fee_cents'
			and (h.snapshot ->> 'adjusted_base_fee_cents')::bigint > 0
	),
	/**
	 * The last observation BEFORE the window, so the first bucket shows the
	 * price that was already in force rather than nothing.
	 */
	seed as (
		select p.fee, p.rep
		from points p, bounds b
		where p.at < b.lo
		order by p.at desc
		limit 1
	),
	bucketed as (
		select
			date_trunc(bucket, p.at) as bucket_at,
			round(avg(p.fee), 2) as avg_fee,
			round(avg(p.rep), 4) as avg_rep,
			min(p.fee) as min_fee,
			max(p.fee) as max_fee,
			/** Ordered by time, so element 1 is genuinely the last of the bucket. */
			(array_agg(p.fee order by p.at desc))[1] as close_fee,
			(array_agg(p.rep order by p.at desc))[1] as close_rep,
			sum(p.is_event)::integer as events
		from points p, bounds b, step s
		where p.at >= b.lo and p.at < b.hi + s.size
		group by 1
	),
	grid as (
		select g as bucket_at
		from bounds b, step s, generate_series(b.lo, b.hi, s.size) g
	),
	joined as (
		select g.bucket_at, k.avg_fee, k.avg_rep, k.min_fee, k.max_fee,
			k.close_fee, k.close_rep, k.events
		from grid g
		left join bucketed k on k.bucket_at = g.bucket_at
	),
	/**
	 * The gap fill. `count()` over an ordered window increments only on
	 * non-null rows, so every run of nulls shares the group number of the last
	 * observed value -- and `first_value` within that group returns it.
	 * Postgres has no `IGNORE NULLS`, which is what this works around.
	 */
	grouped as (
		select *, count(close_fee) over (order by bucket_at) as grp
		from joined
	)
	select
		g.bucket_at,
		coalesce(g.avg_fee, first_value(g.close_fee) over w, (select fee from seed))::numeric,
		coalesce(g.avg_rep, first_value(g.close_rep) over w, (select rep from seed))::numeric,
		coalesce(g.min_fee, first_value(g.close_fee) over w, (select fee from seed))::bigint,
		coalesce(g.max_fee, first_value(g.close_fee) over w, (select fee from seed))::bigint,
		coalesce(first_value(g.close_fee) over w, (select fee from seed))::bigint,
		coalesce(first_value(g.close_rep) over w, (select rep from seed))::numeric,
		coalesce(g.events, 0)
	from grouped g, guard
	window w as (partition by g.grp order by g.bucket_at)
	order by g.bucket_at;
$$;

-- Public. Marketplace-wide aggregates that name nobody, on a page that is
-- deliberately readable without an account.
grant execute on function public.market_price_series(text, timestamptz, timestamptz)
	to anon, authenticated;

-- ----------------------------------------------------------------------------
-- charity_donation_series
-- ----------------------------------------------------------------------------
-- Forfeited stakes over time, on the same buckets as the price series so the
-- two charts line up and can be read against each other: a bucket where the
-- price rose is a bucket where someone broke a commitment, and this is where
-- that money went.
--
-- Source is `wallet_transactions` where the type is `commitment_forfeit` and
-- the status is `completed`. Completed only -- a pending transfer has not
-- reached the charity, and a failed one never will, so counting either would
-- overstate what was actually donated.
--
-- NO CARRY-FORWARD HERE, unlike the price series, and the difference matters.
-- A bucket with no donations really did receive nothing: zero is the truth,
-- not a gap. Carrying a figure forward would draw donations that never
-- happened.
--
-- Amounts are LAMPORTS, which is what moved. Converting to dollars would need
-- a rate, and the rate at the time of each transfer is not recorded on these
-- rows -- so the conversion belongs in the UI, against a clearly-labelled
-- current rate, rather than being baked in here as though it were historical.
create or replace function public.charity_donation_series(
	bucket text,
	from_at timestamptz,
	to_at timestamptz
)
returns table (
	bucket_at timestamptz,
	lamports bigint,
	donation_count integer,
	/** Running total across the window, so the series reads as a rising line. */
	cumulative_lamports bigint
)
language sql
stable
security definer
set search_path = ''
as $$
	with
	guard as (select public.stats_assert_span(bucket, from_at, to_at)),
	step as (select public.stats_bucket_step(bucket) as size),
	bounds as (
		select
			date_trunc(bucket, from_at) as lo,
			date_trunc(bucket, to_at) as hi
	),
	forfeits as (
		select
			date_trunc(bucket, t.completed_at) as bucket_at,
			sum(t.lamports)::bigint as lamports,
			count(*)::integer as donations
		from public.wallet_transactions t, bounds b, step s
		where t.type = 'commitment_forfeit'
			and t.status = 'completed'
			/** `completed_at`, not `created_at`: when the money actually landed. */
			and t.completed_at is not null
			and t.completed_at >= b.lo
			and t.completed_at < b.hi + s.size
		group by 1
	),
	grid as (
		select g as bucket_at
		from bounds b, step s, generate_series(b.lo, b.hi, s.size) g
	)
	select
		g.bucket_at,
		coalesce(f.lamports, 0),
		coalesce(f.donations, 0),
		sum(coalesce(f.lamports, 0)) over (order by g.bucket_at)::bigint
	from grid g
	left join forfeits f on f.bucket_at = g.bucket_at
	cross join guard
	order by g.bucket_at;
$$;

-- Public, and deliberately so: where forfeited stakes go is the one thing the
-- product promises to be open about. It is an aggregate and identifies nobody.
grant execute on function public.charity_donation_series(text, timestamptz, timestamptz)
	to anon, authenticated;
