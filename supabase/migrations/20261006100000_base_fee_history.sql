-- ============================================================================
-- Public history of the base commitment fee
-- ============================================================================
-- For the price chart on /stats. `market_settings_history` stays private (its
-- snapshots include the reputation weights and who made each change); this
-- exposes only when the base fee changed and what it changed to.
--
-- A snapshot is written for every settings change, most of which leave the fee
-- alone, so only rows where the fee differs from the previous one are kept.
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
			(h.snapshot ->> 'base_commitment_fee_cents')::bigint as fee,
			lag((h.snapshot ->> 'base_commitment_fee_cents')::bigint)
				over (order by h.changed_at) as previous
		from public.market_settings_history h
	) changes
	where previous is distinct from fee
	order by changed_at;
$$;

grant execute on function public.base_fee_history() to anon, authenticated;
