-- ============================================================================
-- A buyer can always read a listing they have a commitment on
-- ============================================================================
-- Listings were readable when `active`, or by their seller. Once a meetup was
-- confirmed (`reserved`) or the item bought (`sold`), the buyer lost sight of
-- it, and their own commitment showed "Listing removed" with no title or price.
--
-- The check runs in a SECURITY DEFINER function so the policy does not depend
-- on the commitments table's own policies (and cannot recurse through them).
create or replace function public.has_commitment_on_listing(target_listing uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.commitments
		where listing_id = target_listing
			and buyer_id = (select auth.uid())
	);
$$;

revoke all on function public.has_commitment_on_listing(uuid) from public, anon;
grant execute on function public.has_commitment_on_listing(uuid) to authenticated;

create policy "A buyer can read listings they have a commitment on"
	on public.listings for select
	to authenticated
	using (public.has_commitment_on_listing(id));
