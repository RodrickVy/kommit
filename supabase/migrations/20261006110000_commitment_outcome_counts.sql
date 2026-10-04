-- ============================================================================
-- Public counts of commitment outcomes
-- ============================================================================
-- For the outcomes chart on /stats. Commitments themselves are private to the
-- two people in them; this returns totals per status and nothing else, so no
-- commitment, person or listing can be identified from it.
create or replace function public.commitment_outcome_counts()
returns table (status public.commitment_status, total integer)
language sql
stable
security definer
set search_path = ''
as $$
	select status, count(*)::integer
	from public.commitments
	group by status;
$$;

grant execute on function public.commitment_outcome_counts() to anon, authenticated;
