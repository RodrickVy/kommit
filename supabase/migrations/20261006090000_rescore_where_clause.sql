-- ============================================================================
-- Re-scoring every profile needs an explicit WHERE
-- ============================================================================
-- Supabase rejects an UPDATE with no WHERE clause when the request arrives
-- through the API ("UPDATE requires a WHERE clause"), which made saving a new
-- reputation weight from /admin fail. Every profile is still re-scored; the
-- condition is simply always true.
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
			commitments_successful, commitments_cancelled, commitment_checkins
		),
		reputation_updated_at = now()
	where id is not null;
	return null;
end;
$$;
