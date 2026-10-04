-- ============================================================================
-- A no-show counts as a cancellation
-- ============================================================================
-- Agreeing to meet and not turning up is a commitment the person broke
-- themselves, which is the same thing a cancellation is. So it lands in the
-- same counter, `commitments_cancelled`, and costs the same reputation.
--
-- This is what the previous migration left undecided: after dropping the
-- separate no-show counter, `buyer_no_show` and `seller_no_show` fell through
-- to `else null` and incremented nothing -- so the forfeit was taken but the
-- score never moved, and the next stake was priced as though nothing had
-- happened.
--
-- ONLY THE RESPONSIBLE PARTY IS COUNTED. `process_commitments` emits exactly
-- one of these two events, for whoever was absent, and never both: a no-show
-- verdict requires the other party to have checked in, which is what proves
-- they were there. The person who turned up is refunded and nothing is
-- recorded against them.
--
-- The distinction between the two outcomes is not lost. `commitments.status`
-- still separates `cancelled` from `no_show`, `responsible_party` still names
-- who, and the event log still holds the specific event. What they share is a
-- counter, not an identity.
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
		-- Activity. Counted for both sides, because both took part.
		when 'request_created' then
			update public.profiles set commitments_total = commitments_total + 1
			where id in (c.buyer_id, c.seller_id);

		-- Turning up, proved against the agreed location by `check_in`. Only a
		-- check-in that passed the radius test reaches here.
		when 'buyer_checked_in' then
			update public.profiles set commitment_checkins = commitment_checkins + 1
			where id = c.buyer_id;
		when 'seller_checked_in' then
			update public.profiles set commitment_checkins = commitment_checkins + 1
			where id = c.seller_id;

		-- The meetup was confirmed through QR #1. Both of them were there.
		when 'meetup_verified' then
			update public.profiles set commitments_successful = commitments_successful + 1
			where id in (c.buyer_id, c.seller_id);

		-- The seller answered no. Costs them nothing but is recorded.
		when 'seller_declined' then
			update public.profiles set commitments_ignored = commitments_ignored + 1
			where id = c.seller_id;

		-- Broke their own commitment, by cancelling or by not arriving.
		when 'buyer_cancelled', 'buyer_no_show' then
			update public.profiles set commitments_cancelled = commitments_cancelled + 1
			where id = c.buyer_id;
		when 'seller_cancelled', 'seller_no_show' then
			update public.profiles set commitments_cancelled = commitments_cancelled + 1
			where id = c.seller_id;

		-- Nobody could fairly be blamed, so it is recorded against both and
		-- penalises neither -- `commitments_stale` is not an input to the score.
		when 'commitment_stale' then
			update public.profiles set commitments_stale = commitments_stale + 1
			where id in (c.buyer_id, c.seller_id);

		-- The request died unanswered. The buyer did nothing wrong; the silence
		-- was the seller's.
		when 'request_expired' then
			update public.profiles set commitments_expired = commitments_expired + 1
			where id = c.buyer_id;
			update public.profiles set commitments_ignored = commitments_ignored + 1
			where id = c.seller_id;

		-- Everything else is deliberately uncounted: a buyer withdrawing their
		-- own unanswered request, a seller accepting, a purchase.
		else
			null;
	end case;

	return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Catch up on no-shows already in the log
-- ----------------------------------------------------------------------------
-- ADDITIVE, not a recount. A full recount of `commitments_cancelled` from the
-- event log would also silently zero anyone whose commitments have since been
-- deleted -- events cascade with them -- and lowering a counter that was
-- correctly earned would quietly reprice that person. Adding only the
-- no-shows cannot take anything away.
--
-- `n > 0` keeps this from touching profiles with nothing to add, which matters
-- because the UPDATE re-scores every row it touches and refreshes the market
-- average.
with no_shows as (
	select
		p.id,
		count(e.id) filter (
			where (e.event_type = 'buyer_no_show' and c.buyer_id = p.id)
				or (e.event_type = 'seller_no_show' and c.seller_id = p.id)
		) as n
	from public.profiles p
	left join public.commitments c on p.id in (c.buyer_id, c.seller_id)
	left join public.commitment_events e on e.commitment_id = c.id
	group by p.id
)
update public.profiles p
set commitments_cancelled = p.commitments_cancelled + ns.n
from no_shows ns
where ns.id = p.id and ns.n > 0;
