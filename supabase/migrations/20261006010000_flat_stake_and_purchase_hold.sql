-- ============================================================================
-- Flat $2 stake, and holding a listing between verification and payment
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Flat stake
-- ----------------------------------------------------------------------------
-- Reputation does not adjust stakes for now. Every participant puts down the
-- same $2.00 CAD. Floor and ceiling are pinned to the same figure so the stake
-- cannot drift away from it through the clamp in `_shared/stake.ts`.
update public.market_settings
set
	min_commitment_fee_cents = 200,
	base_commitment_fee_cents = 200,
	max_commitment_fee_cents = 200
where id = 1;

-- ----------------------------------------------------------------------------
-- Purchase hold
-- ----------------------------------------------------------------------------
-- Completing a meetup used to release the listing straight back to `active`,
-- so the seller could accept somebody else while the buyer who turned up was
-- still inspecting the item.
--
-- A verified meetup now keeps the listing `reserved` for
-- `check_in_window_minutes` after verification — the buyer's window to pay.
-- Payment marks it `sold`; if they walk away, `release_purchase_holds()` (run
-- by `process_commitments`) returns it to sale once the window has passed.
create or replace function public.listing_is_held(target_listing uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.commitments c
		where c.listing_id = target_listing
			and (
				c.status = 'accepted'
				or (
					c.status = 'completed'
					and c.completed_at > now() - make_interval(
						mins => (select check_in_window_minutes from public.market_settings where id = 1)
					)
				)
			)
	);
$$;

create or replace function public.sync_listing_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	target_listing uuid := coalesce(new.listing_id, old.listing_id);
begin
	if public.listing_is_held(target_listing) then
		update public.listings set status = 'reserved'
			where id = target_listing and status = 'active';
	else
		update public.listings set status = 'active'
			where id = target_listing and status = 'reserved';
	end if;

	return null;
end;
$$;

-- Returns held listings whose purchase window has lapsed to sale.
create or replace function public.release_purchase_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	released integer;
begin
	update public.listings l set status = 'active'
	where l.status = 'reserved' and not public.listing_is_held(l.id);

	get diagnostics released = row_count;
	return released;
end;
$$;

revoke all on function public.listing_is_held(uuid) from public, anon, authenticated;
revoke all on function public.release_purchase_holds() from public, anon, authenticated;
grant execute on function public.release_purchase_holds() to service_role;
