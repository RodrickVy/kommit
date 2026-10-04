-- ============================================================================
-- calculate_reputation
-- ============================================================================
-- Adds one counter, keeps every profile counter up to date from the
-- commitment event log, and recalculates reputation whenever a counter that
-- feeds it changes.

-- ----------------------------------------------------------------------------
-- The new counter
-- ----------------------------------------------------------------------------
alter table public.profiles
	add column commitment_checkins integer not null default 0
		check (commitment_checkins >= 0);

-- Readable like the other counters. `profiles` grants SELECT column by
-- column, so a new column is hidden until it is listed here.
grant select (commitment_checkins) on public.profiles to anon, authenticated;

-- ----------------------------------------------------------------------------
-- The formula
-- ----------------------------------------------------------------------------
--   accountable = successful + cancelled
--   accountable = 0  ->  1.000
--   otherwise        ->  1.000 + success_rate * 0.20
--                              - cancellation_rate * 0.20
--                              + checkin_rate * 0.05
-- where each rate is that counter divided by `accountable`.
--
-- Pure, so the trigger below and any one-off recalculation share exactly one
-- definition of the number.
create or replace function public.reputation_score(
	successful integer,
	cancelled integer,
	checkins integer
)
returns numeric
language sql
immutable
set search_path = ''
as $$
	select case
		when successful + cancelled = 0 then 1.000
		else round(
			1.000
			+ (successful::numeric / (successful + cancelled)) * 0.20
			- (cancelled::numeric / (successful + cancelled)) * 0.20
			+ (checkins::numeric / (successful + cancelled)) * 0.05,
			3
		)
	end;
$$;

-- Recalculates and stores one profile's reputation.
create or replace function public.calculate_reputation(target uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
	score numeric;
begin
	update public.profiles
	set
		reputation = public.reputation_score(
			commitments_successful, commitments_cancelled, commitment_checkins
		),
		reputation_updated_at = now()
	where id = target
	returning reputation into score;

	return score;
end;
$$;

revoke all on function public.calculate_reputation(uuid) from public, anon, authenticated;

-- Any change to a counter that feeds the score recalculates it in the same
-- statement, so the score can never lag its inputs.
create or replace function public.recalculate_reputation_on_counter_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.reputation := public.reputation_score(
		new.commitments_successful, new.commitments_cancelled, new.commitment_checkins
	);
	new.reputation_updated_at := now();
	return new;
end;
$$;

create trigger profiles_recalculate_reputation
	before update of commitments_successful, commitments_cancelled, commitment_checkins
	on public.profiles
	for each row
	when (
		old.commitments_successful is distinct from new.commitments_successful
		or old.commitments_cancelled is distinct from new.commitments_cancelled
		or old.commitment_checkins is distinct from new.commitment_checkins
	)
	execute function public.recalculate_reputation_on_counter_change();

-- ----------------------------------------------------------------------------
-- Counting outcomes
-- ----------------------------------------------------------------------------
-- Driven by `commitment_events`, which every code path already writes exactly
-- once per outcome and which records who acted and in which role. One trigger
-- here means no Edge Function or page action has to remember to count.
--
--   buyer_checked_in / seller_checked_in   that party's commitment_checkins
--   meetup_verified (QR #1)                both parties' commitments_successful
--   seller_declined                        the seller's commitments_ignored
--   buyer_cancelled / seller_cancelled     that party's commitments_cancelled
--   commitment_stale                       both parties' commitments_stale
--   request_expired                        both parties' commitments_expired
--
-- A buyer withdrawing their own request (`buyer_withdrew`) counts as nothing.
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
			where id in (c.buyer_id, c.seller_id);
		else
			null;
	end case;

	return new;
end;
$$;

create trigger commitment_events_count
	after insert on public.commitment_events
	for each row execute function public.count_commitment_event();

-- ----------------------------------------------------------------------------
-- Catch up on history
-- ----------------------------------------------------------------------------
-- Nothing counted these before, so every counter is 0 while the event log
-- already holds real outcomes. Recount from the log once, then score every
-- profile, so existing users start from what they have actually done.
with per_profile as (
	select
		p.id,
		count(*) filter (
			where (e.event_type = 'buyer_checked_in' and c.buyer_id = p.id)
				or (e.event_type = 'seller_checked_in' and c.seller_id = p.id)
		) as checkins,
		count(*) filter (where e.event_type = 'meetup_verified') as successful,
		count(*) filter (where e.event_type = 'seller_declined' and c.seller_id = p.id) as ignored,
		count(*) filter (
			where (e.event_type = 'buyer_cancelled' and c.buyer_id = p.id)
				or (e.event_type = 'seller_cancelled' and c.seller_id = p.id)
		) as cancelled,
		count(*) filter (where e.event_type = 'commitment_stale') as stale,
		count(*) filter (where e.event_type = 'request_expired') as expired
	from public.profiles p
	join public.commitments c on p.id in (c.buyer_id, c.seller_id)
	join public.commitment_events e on e.commitment_id = c.id
	group by p.id
)
update public.profiles p
set
	commitment_checkins = pp.checkins,
	commitments_successful = pp.successful,
	commitments_ignored = pp.ignored,
	commitments_cancelled = pp.cancelled,
	commitments_stale = pp.stale,
	commitments_expired = pp.expired
from per_profile pp
where pp.id = p.id;

-- Profiles with no history at all still get their starting score of 1.000.
update public.profiles
set
	reputation = public.reputation_score(
		commitments_successful, commitments_cancelled, commitment_checkins
	),
	reputation_updated_at = now();
