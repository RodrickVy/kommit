-- ============================================================================
-- my_commitment_fee returns the whole chain
-- ============================================================================
-- The buyer has to be able to see what they are putting down and why, at the
-- moment they request a meetup. That needs four figures, not one: the base
-- fee, what the market did to it, what their own reputation did to that, and
-- the total.
--
-- Every figure comes from `adjusted_base_fee_cents()` and
-- `commitment_fee_cents()`, the same two functions the Edge Functions call to
-- take the stake. So the number on the button and the number charged are the
-- same number, not two calculations that agree today.
--
-- Dropped and recreated because the column list changes.
drop function if exists public.my_commitment_fee();

create function public.my_commitment_fee()
returns table (
	base_fee_cents bigint,
	market_reputation numeric,
	market_reputation_weight numeric,
	market_adjustment numeric,
	adjusted_base_fee_cents bigint,
	reputation numeric,
	fee_cents bigint,
	min_fee_cents bigint,
	max_fee_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
	select
		s.base_commitment_fee_cents,
		coalesce(s.market_reputation, 1.000),
		s.market_reputation_weight,
		public.market_fee_adjustment(),
		public.adjusted_base_fee_cents(),
		coalesce(p.reputation, 1.000),
		public.commitment_fee_cents((select auth.uid())),
		s.min_commitment_fee_cents,
		s.max_commitment_fee_cents
	from public.market_settings s
	left join public.profiles p on p.id = (select auth.uid())
	where s.id = 1;
$$;

revoke all on function public.my_commitment_fee() from public, anon;
grant execute on function public.my_commitment_fee() to authenticated;
