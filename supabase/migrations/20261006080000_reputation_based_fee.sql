-- ============================================================================
-- Reputation-based commitment fee
-- ============================================================================
--   * the reputation weights move into market_settings, editable by an admin
--   * market reputation is the average of every individual reputation
--   * the commitment fee is the base fee scaled by reputation:
--         fee = base_fee * market_reputation / your_reputation
--     clamped to the configured floor and ceiling. Average reliability pays
--     the base fee; more reliable pays less, less reliable pays more.
--   * an expired request now counts against the right people: the buyer's
--     `commitments_expired` and the seller's `commitments_ignored`

-- ----------------------------------------------------------------------------
-- Settings: weights, and the new base fee
-- ----------------------------------------------------------------------------
alter table public.market_settings
	-- Multiplies both the success rate (added) and the cancellation rate
	-- (subtracted).
	add column reputation_outcome_weight numeric not null default 0.20
		check (reputation_outcome_weight between 0 and 1),
	-- Multiplies the check-in rate (added).
	add column reputation_checkin_weight numeric not null default 0.05
		check (reputation_checkin_weight between 0 and 1);

-- $15.00 base. The floor and ceiling bound what reputation can do to it and
-- are what keeps a mistyped weight from asking for one cent or a fortune.
update public.market_settings
set
	min_commitment_fee_cents = 100,
	max_commitment_fee_cents = 5000,
	base_commitment_fee_cents = 1500
where id = 1;

-- Market reputation is shown beside a buyer's own when they see their fee.
grant select (market_reputation) on public.market_settings to anon, authenticated;

-- ----------------------------------------------------------------------------
-- The score reads its weights from market_settings
-- ----------------------------------------------------------------------------
create or replace function public.reputation_score(
	successful integer,
	cancelled integer,
	checkins integer
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
	select case
		when successful + cancelled = 0 then 1.000
		else round(
			1.000
			+ (successful::numeric / (successful + cancelled)) * s.reputation_outcome_weight
			- (cancelled::numeric / (successful + cancelled)) * s.reputation_outcome_weight
			+ (checkins::numeric / (successful + cancelled)) * s.reputation_checkin_weight,
			3
		)
	end
	from public.market_settings s
	where s.id = 1;
$$;

-- A new account starts at 1.000, the formula's value for no history, so it is
-- part of the market average from day one.
alter table public.profiles alter column reputation set default 1.000;
update public.profiles set reputation = 1.000, reputation_updated_at = now()
where reputation is null;

-- ----------------------------------------------------------------------------
-- Market reputation: the average of all individual reputations
-- ----------------------------------------------------------------------------
create or replace function public.refresh_market_reputation()
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
	average numeric;
begin
	select round(avg(reputation), 3) into average
	from public.profiles
	where reputation is not null;

	update public.market_settings
	set market_reputation = coalesce(average, 1.000)
	where id = 1 and market_reputation is distinct from coalesce(average, 1.000);

	return coalesce(average, 1.000);
end;
$$;

revoke all on function public.refresh_market_reputation() from public, anon, authenticated;

create or replace function public.refresh_market_reputation_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform public.refresh_market_reputation();
	return null;
end;
$$;

-- Once per statement, not per row: a bulk recalculation refreshes once.
create trigger profiles_refresh_market_reputation
	after insert or delete or update of reputation on public.profiles
	for each statement execute function public.refresh_market_reputation_trigger();

-- Changing a weight re-scores everyone straight away, so no reputation is
-- ever out of step with the weights it is supposed to reflect.
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
		reputation_updated_at = now();
	return null;
end;
$$;

create trigger market_settings_rescore
	after update of reputation_outcome_weight, reputation_checkin_weight on public.market_settings
	for each row
	when (
		old.reputation_outcome_weight is distinct from new.reputation_outcome_weight
		or old.reputation_checkin_weight is distinct from new.reputation_checkin_weight
	)
	execute function public.rescore_on_weight_change();

-- The settings history records decisions. A market reputation that moved
-- because someone's score changed is not one, so it is not recorded.
create or replace function public.record_market_settings_change()
returns trigger
language plpgsql
as $$
begin
	if tg_op = 'UPDATE'
		and (to_jsonb(new) - 'market_reputation' - 'updated_at')
			= (to_jsonb(old) - 'market_reputation' - 'updated_at')
	then
		return new;
	end if;

	insert into public.market_settings_history (changed_by, snapshot)
	values (new.updated_by, to_jsonb(new));
	return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- The fee
-- ----------------------------------------------------------------------------
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
				* coalesce(s.market_reputation, 1.000)
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

-- The Edge Functions call this through the service role to decide a stake.
revoke all on function public.commitment_fee_cents(uuid) from public, anon, authenticated;
grant execute on function public.commitment_fee_cents(uuid) to service_role;

-- What the signed-in user sees before they commit: the parts and the total.
create or replace function public.my_commitment_fee()
returns table (
	base_fee_cents bigint,
	reputation numeric,
	market_reputation numeric,
	fee_cents bigint
)
language sql
stable
security definer
set search_path = ''
as $$
	select
		s.base_commitment_fee_cents,
		coalesce(p.reputation, 1.000),
		coalesce(s.market_reputation, 1.000),
		public.commitment_fee_cents((select auth.uid()))
	from public.market_settings s
	left join public.profiles p on p.id = (select auth.uid())
	where s.id = 1;
$$;

revoke all on function public.my_commitment_fee() from public, anon;
grant execute on function public.my_commitment_fee() to authenticated;

-- ----------------------------------------------------------------------------
-- Expired requests: the buyer's expired, the seller's ignored
-- ----------------------------------------------------------------------------
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
			where id = c.buyer_id;
			update public.profiles set commitments_ignored = commitments_ignored + 1
			where id = c.seller_id;
		else
			null;
	end case;

	return new;
end;
$$;

-- Recount the two affected counters from history under the corrected rule.
with per_profile as (
	select
		p.id,
		count(e.id) filter (
			where (e.event_type = 'seller_declined' and c.seller_id = p.id)
				or (e.event_type = 'request_expired' and c.seller_id = p.id)
		) as ignored,
		count(e.id) filter (where e.event_type = 'request_expired' and c.buyer_id = p.id) as expired
	from public.profiles p
	left join public.commitments c on p.id in (c.buyer_id, c.seller_id)
	left join public.commitment_events e on e.commitment_id = c.id
	group by p.id
)
update public.profiles p
set commitments_ignored = pp.ignored, commitments_expired = pp.expired
from per_profile pp
where pp.id = p.id;

-- Everyone re-scored under the settings-driven weights, then the average.
update public.profiles
set
	reputation = public.reputation_score(
		commitments_successful, commitments_cancelled, commitment_checkins
	),
	reputation_updated_at = now();

select public.refresh_market_reputation();
