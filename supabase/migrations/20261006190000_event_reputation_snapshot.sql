-- ============================================================================
-- Every commitment event records the state it happened under
-- ============================================================================
-- Six columns, all snapshots taken at the moment the event is recorded:
--
--   buyer_id, seller_id      who the two parties were
--   buyer_reputation         the buyer's score at that moment
--   seller_reputation        the seller's score at that moment
--   market_reputation        the marketplace average at that moment
--   market_base_fee_cents    what an average member was putting down
--
-- WHY THIS IS WORTH DENORMALISING
--
-- `commitments` already names the two parties, and `profiles` holds today's
-- reputation. Neither answers the question this table exists to answer: what
-- was true WHEN this happened. A score is overwritten on every change, and the
-- market average and the base fee move with it, so a resolved commitment from
-- last month cannot be explained from the current rows. These columns make
-- each event self-describing.
--
-- It is a snapshot, not a cache. Nothing reads these to decide anything; they
-- are never used to price a stake or compute a score. The live values are
-- always read from `profiles` and `market_settings`.
--
-- WHY A TRIGGER RATHER THAN ELEVEN CALL SITES
--
-- Events are inserted from six Edge Functions and a form action, eleven places
-- in total, and a twelfth will be added by somebody who has not read this
-- file. More importantly, `commitment_events` grants INSERT to
-- `authenticated`: if the values came from the caller, a user could post an
-- event claiming any reputation they liked.
--
-- So the trigger OVERWRITES unconditionally rather than filling in blanks.
-- Whatever an insert supplies for these six columns is discarded and replaced
-- with what the database can see. That makes the snapshot authoritative, and
-- it means no call site needs to change -- there is exactly one place where
-- this is decided.
-- ============================================================================

alter table public.commitment_events
	-- `on delete set null`, matching `actor_profile_id`. A deleted account must
	-- not take the history of what happened with it; the surrounding columns
	-- still describe the event.
	add column buyer_id uuid references public.profiles (id) on delete set null,
	add column seller_id uuid references public.profiles (id) on delete set null,

	add column buyer_reputation numeric,
	add column seller_reputation numeric,
	add column market_reputation numeric,

	-- `_cents`, like every other monetary column in this schema. A bare
	-- `market_base_fee` would be the only money field here without its unit in
	-- the name, which is exactly how a dollar value ends up compared against a
	-- cent value.
	add column market_base_fee_cents bigint;

comment on column public.commitment_events.buyer_reputation is
	'The buyer''s reputation when this event was recorded. A snapshot; never read to decide anything.';

comment on column public.commitment_events.market_base_fee_cents is
	'The market-adjusted base fee when this event was recorded -- what an average member was putting down.';

-- All six are nullable, and stay null on events recorded before this
-- migration. The parties can be recovered for those rows, below, but the
-- reputations and the fee cannot: they were overwritten long ago, and a
-- plausible-looking guess in an audit trail is worse than an honest gap.

create index commitment_events_buyer_idx on public.commitment_events (buyer_id, occurred_at desc);
create index commitment_events_seller_idx on public.commitment_events (seller_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- Taking the snapshot
-- ----------------------------------------------------------------------------
-- BEFORE INSERT, so the values land in the row itself rather than needing a
-- second write, and so the event is recorded under the state that produced it
-- rather than the state it produces.
--
-- THAT ORDERING IS DELIBERATE AND IS THE ONE THING TO UNDERSTAND HERE.
-- `commitment_events_count` is an AFTER INSERT trigger: it increments the
-- counters, which recalculates reputation, which refreshes the market average.
-- Running before it means these columns describe the situation the event
-- occurred IN -- the buyer's score as it stood when they cancelled, the fee
-- that was in force when they committed -- not the situation the event caused.
--
-- That is what an audit trail is for. "Their reputation was 1.18 when they
-- failed to turn up" explains the decision that was made; the post-effect
-- figure is already on `profiles` and is one join away for anyone who wants
-- the resulting value instead.
--
-- SECURITY DEFINER because it reads `market_settings`, where ordinary roles
-- hold only column-level SELECT, and `adjusted_base_fee_cents()`, which is not
-- granted to `authenticated`. Without it, an authenticated insert would be
-- refused by the very configuration being snapshotted.
create or replace function public.snapshot_commitment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	c record;
begin
	select
		cm.buyer_id,
		cm.seller_id,
		b.reputation as buyer_reputation,
		s.reputation as seller_reputation
	into c
	from public.commitments cm
	left join public.profiles b on b.id = cm.buyer_id
	left join public.profiles s on s.id = cm.seller_id
	where cm.id = new.commitment_id;

	/**
	 * No commitment means no snapshot to take. The event still inserts: the
	 * foreign key makes this unreachable in practice, and refusing the write
	 * would turn a missing audit detail into a lost event.
	 */
	if found then
		new.buyer_id := c.buyer_id;
		new.seller_id := c.seller_id;
		new.buyer_reputation := c.buyer_reputation;
		new.seller_reputation := c.seller_reputation;
	end if;

	/**
	 * Market state is read whether or not the commitment resolved, because it
	 * is a property of the moment rather than of the pair.
	 */
	select market_reputation into new.market_reputation
	from public.market_settings where id = 1;

	new.market_base_fee_cents := public.adjusted_base_fee_cents();

	return new;
end;
$$;

-- Named to sort AFTER `commitment_events_count` alphabetically only by
-- accident; it does not matter, because the two fire at different times --
-- this one BEFORE the insert, that one AFTER it.
create trigger commitment_events_snapshot
	before insert on public.commitment_events
	for each row execute function public.snapshot_commitment_event();

-- ----------------------------------------------------------------------------
-- Backfill what is recoverable
-- ----------------------------------------------------------------------------
-- The two parties are a fact of the commitment and can be filled in for every
-- past event.
--
-- The three reputation and fee columns are left NULL. They were overwritten
-- the moment anything changed, so there is no record of what they were -- and
-- an audit trail with invented figures is worse than one with gaps, because
-- the gaps are visible and the inventions are not.
update public.commitment_events e
set
	buyer_id = c.buyer_id,
	seller_id = c.seller_id
from public.commitments c
where c.id = e.commitment_id
	and (e.buyer_id is null or e.seller_id is null);
