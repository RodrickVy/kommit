-- ============================================================================
-- Remove profiles.commitments_no_show
-- ============================================================================
-- Added in 20261006120000 and removed again without being replaced. There is
-- no separate counter for failing to attend: `commitments_cancelled` is the
-- counter for a commitment that failed because of the person it belongs to.
--
-- WHAT IS NOT BEING REMOVED, and must not be confused with this:
--
--   * the `no_show` commitment STATUS
--   * the `buyer_no_show` / `seller_no_show` EVENT types
--   * `commitments.responsible_party`, which records who was absent
--
-- All three predate that migration and are how the outcome is decided and
-- recorded. A no-show is still resolved, still settled, still visible on the
-- commitment, and still in the event log. Only the per-profile tally goes.
--
-- The trigger is recreated FIRST. `count_commitment_event` is plpgsql, so its
-- body is resolved when it runs rather than when it is defined -- dropping the
-- column while a live version of the function still referenced it would leave
-- every no-show event insert failing until the function was replaced.
create or replace function public.count_commitment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	c record;
begin
	select buyer_id, seller_id into c
	from public.commitments where id = new.commitment_id;

	if not found then
		return new;
	end if;

	case new.event_type
		when 'request_created' then
			update public.profiles set commitments_total = commitments_total + 1
			where id in (c.buyer_id, c.seller_id);
		when 'buyer_checked_in' then
			update public.profiles set commitment_checkins = commitment_checkins + 1
			where id = c.buyer_id;
		when 'seller_checked_in' then
			update public.profiles set commitment_checkins = commitment_checkins + 1
			where id = c.seller_id;
		when 'meetup_verified' then
			update public.profiles set commitments_successful = commitments_successful + 1
			where id in (c.buyer_id, c.seller_id);
		when 'seller_declined' then
			update public.profiles set commitments_ignored = commitments_ignored + 1
			where id = c.seller_id;
		when 'buyer_cancelled' then
			update public.profiles set commitments_cancelled = commitments_cancelled + 1
			where id = c.buyer_id;
		when 'seller_cancelled' then
			update public.profiles set commitments_cancelled = commitments_cancelled + 1
			where id = c.seller_id;
		when 'commitment_stale' then
			update public.profiles set commitments_stale = commitments_stale + 1
			where id in (c.buyer_id, c.seller_id);
		when 'request_expired' then
			update public.profiles set commitments_expired = commitments_expired + 1
			where id = c.buyer_id;
			update public.profiles set commitments_ignored = commitments_ignored + 1
			where id = c.seller_id;
		else
			null;
	end case;

	return new;
end;
$$;

-- `buyer_no_show` and `seller_no_show` now fall through to the `else null`
-- branch and increment nothing. Deliberate for this step: where a no-show
-- should land is a separate decision, not something to settle by leaving the
-- old mapping in place.

alter table public.profiles
	drop column commitments_no_show;

-- The SELECT grant on the column goes with it; column privileges are dropped
-- along with the column, so nothing has to be revoked.
