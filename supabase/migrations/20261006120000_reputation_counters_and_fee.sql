-- ============================================================================
-- The counters nothing was incrementing, and the fee formula corrected
-- ============================================================================
-- THE SCORE ITSELF IS UNCHANGED. It reads `commitments_successful`,
-- `commitments_cancelled` and `commitment_checkins`, with the two weights from
-- `market_settings`, and nothing here touches that.
--
-- What changes:
--
--   1. `commitments_total` was never incremented by anything, so the
--      "Commitments" figure on /account always read 0.
--   2. no-shows were recorded in `commitment_events` and then counted by
--      nobody. There was not even a column for them.
--   3. the fee divided by reputation but MULTIPLIED by market reputation,
--      which made a more reliable market more expensive for everyone.
--
-- The new counters are DATA, not inputs to the score. They exist so the
-- behaviour can be shown and charted; whether they ever price anything is a
-- separate decision, and the formula deliberately still ignores them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- commitments_no_show
-- ----------------------------------------------------------------------------
-- Agreed to meet, the other party checked in at the location, and this person
-- never did. The most serious thing the platform can observe, and until now
-- the only outcome with no counter at all.
--
-- Recorded against the party `process_commitments` held responsible, which is
-- the one who did not arrive -- never both.
alter table public.profiles
	add column commitments_no_show integer not null default 0
		check (commitments_no_show >= 0);

comment on column public.profiles.commitments_no_show is
	'Commitments this person failed to attend while the other party proved they were there.';

-- `profiles` grants SELECT column by column, so a new column is invisible
-- until it is listed. See the note in 20261005020000.
grant select (commitments_no_show) on public.profiles to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Counting every outcome
-- ----------------------------------------------------------------------------
-- Three additions to the existing map:
--
--   request_created    both parties' commitments_total
--   buyer_no_show      the buyer's commitments_no_show
--   seller_no_show     the seller's commitments_no_show
--
-- `commitments_total` counts both sides because the column means "commitments
-- this person has been part of, in either role" -- it is a measure of
-- activity, not of outcome, so the buyer and the seller both took part.
--
-- None of the three feed the reputation trigger, which watches only the three
-- scoring counters. Incrementing them therefore does not re-score anybody,
-- which is correct: being busy is not being reliable.
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
		when 'buyer_no_show' then
			update public.profiles set commitments_no_show = commitments_no_show + 1
			where id = c.buyer_id;
		when 'seller_no_show' then
			update public.profiles set commitments_no_show = commitments_no_show + 1
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

-- ----------------------------------------------------------------------------
-- The fee: base / (market reputation * your reputation)
-- ----------------------------------------------------------------------------
-- The previous version MULTIPLIED by market reputation:
--
--     base * market_rep / your_rep
--
-- which had the market the wrong way round. As the marketplace as a whole grew
-- more reliable, every stake on it got more expensive -- the opposite of what
-- the number is meant to express. With both reputations near 1.000 the two
-- formulas agree, which is why it was not obvious.
--
--     base / (market_rep * your_rep)
--
-- Now both divisors pull the same way. Being more reliable than average makes
-- your stake smaller, and a market where people generally turn up charges
-- everyone less, because less needs to be held to make showing up credible.
--
-- The floor and ceiling in `market_settings` are what make this safe to tune.
-- They are not decoration: the weights are editable at runtime, so a mistyped
-- value could otherwise ask someone for a penny or for a fortune.
--
-- The `greatest(..., 0.001)` guards cannot currently fire -- the score's floor
-- is 1.000 minus the outcome weight, so with any sane weight it stays well
-- above zero. They are there because a future weight change could in principle
-- drive a score to zero, and a division by zero in the fee would take down
-- every commitment request at once.
create or replace function public.commitment_fee_cents(target uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select least(
		greatest(
			round(
				s.base_commitment_fee_cents
				/ greatest(coalesce(s.market_reputation, 1.000), 0.001)
				/ greatest(coalesce(p.reputation, 1.000), 0.001)
			)::bigint,
			s.min_commitment_fee_cents
		),
		s.max_commitment_fee_cents
	)
	from public.market_settings s
	left join public.profiles p on p.id = target
	where s.id = 1;
$$;

revoke all on function public.commitment_fee_cents(uuid) from public, anon, authenticated;
grant execute on function public.commitment_fee_cents(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- my_reputation_breakdown -- every number behind the score
-- ----------------------------------------------------------------------------
-- Powers the explanation on /account. It returns the inputs, the rates, the
-- weights, each weighted contribution AND the final score, rather than just
-- the score with the formula written beside it.
--
-- The difference matters: a page that recomputed the arithmetic in TypeScript
-- to show its working could disagree with the database, and the version the
-- user was shown would be the wrong one. Everything here comes from the same
-- row the score was computed from, and `reputation` is read back rather than
-- recalculated, so the parts and the total cannot drift.
--
-- The rates are NULL when nothing is accountable yet. A rate of 0 would read
-- as "you have a 0% success rate", which is a judgement; null is the truth,
-- which is that there is nothing to judge and the score is the starting 1.000.
create or replace function public.my_reputation_breakdown()
returns table (
	successful integer,
	cancelled integer,
	checkins integer,
	accountable integer,
	success_rate numeric,
	cancel_rate numeric,
	checkin_rate numeric,
	outcome_weight numeric,
	checkin_weight numeric,
	success_points numeric,
	cancel_points numeric,
	checkin_points numeric,
	reputation numeric,
	reputation_updated_at timestamptz,
	market_reputation numeric,
	base_fee_cents bigint,
	fee_cents bigint,
	min_fee_cents bigint,
	max_fee_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
	with me as (
		select
			p.commitments_successful as successful,
			p.commitments_cancelled as cancelled,
			p.commitment_checkins as checkins,
			p.commitments_successful + p.commitments_cancelled as accountable,
			p.reputation,
			p.reputation_updated_at
		from public.profiles p
		where p.id = (select auth.uid())
	)
	select
		m.successful,
		m.cancelled,
		m.checkins,
		m.accountable,
		case when m.accountable = 0 then null
			else round(m.successful::numeric / m.accountable, 4) end,
		case when m.accountable = 0 then null
			else round(m.cancelled::numeric / m.accountable, 4) end,
		case when m.accountable = 0 then null
			else round(m.checkins::numeric / m.accountable, 4) end,
		s.reputation_outcome_weight,
		s.reputation_checkin_weight,
		case when m.accountable = 0 then null
			else round((m.successful::numeric / m.accountable) * s.reputation_outcome_weight, 4) end,
		case when m.accountable = 0 then null
			else round((m.cancelled::numeric / m.accountable) * s.reputation_outcome_weight, 4) end,
		case when m.accountable = 0 then null
			else round((m.checkins::numeric / m.accountable) * s.reputation_checkin_weight, 4) end,
		m.reputation,
		m.reputation_updated_at,
		coalesce(s.market_reputation, 1.000),
		s.base_commitment_fee_cents,
		public.commitment_fee_cents((select auth.uid())),
		s.min_commitment_fee_cents,
		s.max_commitment_fee_cents
	from me m
	cross join public.market_settings s
	where s.id = 1;
$$;

-- Reads only the caller's own row, via `auth.uid()`. SECURITY DEFINER is what
-- lets it see the reputation weights, which `market_settings` grants to no
-- browser-reachable role.
revoke all on function public.my_reputation_breakdown() from public, anon;
grant execute on function public.my_reputation_breakdown() to authenticated;

-- ----------------------------------------------------------------------------
-- Catch up on history
-- ----------------------------------------------------------------------------
-- Nothing counted these before, so both columns are 0 while the event log
-- already holds real outcomes. Recounted from the log rather than left to
-- accumulate from here, so the figures on /account describe what people have
-- actually done rather than only what they do from today.
--
-- Counted from `commitment_events` for the same reason the trigger reads it:
-- it is the one place every outcome is recorded exactly once, by whichever
-- code path produced it.
--
-- `left join` throughout, so a profile with no commitments is set to 0 rather
-- than skipped and left at whatever it held.
with per_profile as (
	select
		p.id,
		count(e.id) filter (where e.event_type = 'request_created') as total,
		count(e.id) filter (
			where (e.event_type = 'buyer_no_show' and c.buyer_id = p.id)
				or (e.event_type = 'seller_no_show' and c.seller_id = p.id)
		) as no_shows
	from public.profiles p
	left join public.commitments c on p.id in (c.buyer_id, c.seller_id)
	left join public.commitment_events e on e.commitment_id = c.id
	group by p.id
)
update public.profiles p
set
	commitments_total = pp.total,
	commitments_no_show = pp.no_shows
from per_profile pp
where pp.id = p.id;

-- No re-score and no market refresh. Neither counter feeds the formula, so
-- every reputation is already correct -- and running a rescore here would
-- imply otherwise.
