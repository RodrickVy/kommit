-- ============================================================================
-- Reputation recalculation becomes explicit and sequential
-- ============================================================================
-- The cascade was entirely trigger-driven:
--
--   insert commitment_events
--     -> commitment_events_count            profile counters
--     -> profiles_recalculate_reputation    profiles.reputation
--     -> profiles_refresh_market_reputation market_settings.market_reputation
--     -> market_settings_price              market_settings.adjusted_base_fee_cents
--     -> market_settings_record_history     a history row
--
-- Correct, but opaque. Five writes across three tables fire from one INSERT,
-- the order is implicit, and a failure anywhere surfaces as a single error on
-- the insert with nothing to say which step produced it.
--
-- WHAT CHANGES
--
-- The three triggers that chained the cascade are dropped, and their bodies
-- become functions the Edge Functions call deliberately, in order, AFTER the
-- core business action has succeeded. Each piece of state keeps exactly one
-- writer:
--
--   profile counters                  apply_event_counters()   called by the function
--   profiles.reputation               calculate_reputation()   called by the function
--   market_settings.market_reputation refresh_market_reputation() called by the function
--   adjusted_base_fee_cents           market_settings_price    trigger, see below
--   event snapshot columns            commitment_events_snapshot  trigger
--
-- WHAT DELIBERATELY STAYS A TRIGGER, AND WHY
--
-- `market_settings_price` is BEFORE INSERT OR UPDATE on the row being written
-- and derives `adjusted_base_fee_cents` from that row's own values. It cannot
-- recurse, cannot collide, and performs no write of its own — it fills a
-- column in a statement somebody else already issued.
--
-- Making the fee an inline update instead would give that column TWO writers:
-- the Edge Function and the trigger, which would still have to exist, because
-- an admin editing the base fee or the weight from /admin must also reprice
-- and never goes near an Edge Function. One derivation, in one place, for
-- every statement that can change its inputs. The function's final step issues
-- the UPDATE; this fills in the price it implies.
--
-- `commitment_events_snapshot` stays for the same reason, and because the
-- snapshot must be taken before the counters move — see that migration.
--
-- NO FORMULA, SCHEMA, COUNTER MEANING OR BUSINESS RULE CHANGES HERE. Every
-- body below is the one that was running, lifted out of its trigger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Counters become an explicit call
-- ----------------------------------------------------------------------------
-- The same map `count_commitment_event` applied, with one addition: it now
-- RETURNS the profiles whose SCORING counters moved, so the caller knows
-- exactly whose reputation to recalculate and recalculates nobody else's.
--
-- `commitments_ignored`, `commitments_expired` and `commitments_stale` are
-- tracked and are not inputs to the score, so an event that only touches those
-- returns an empty array and costs no further writes.
create or replace function public.apply_event_counters(
	p_commitment_id uuid,
	p_event_type public.commitment_event_type
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
	c record;
	rescore uuid[] := '{}';
begin
	select buyer_id, seller_id into c
	from public.commitments where id = p_commitment_id;

	if not found then
		return rescore;
	end if;

	case p_event_type
		when 'request_created' then
			update public.profiles set commitments_total = commitments_total + 1
			where id in (c.buyer_id, c.seller_id);
			rescore := array[c.buyer_id, c.seller_id];

		when 'buyer_checked_in' then
			update public.profiles set commitment_checkins = commitment_checkins + 1
			where id = c.buyer_id;
			rescore := array[c.buyer_id];

		when 'seller_checked_in' then
			update public.profiles set commitment_checkins = commitment_checkins + 1
			where id = c.seller_id;
			rescore := array[c.seller_id];

		when 'meetup_verified' then
			update public.profiles set commitments_successful = commitments_successful + 1
			where id in (c.buyer_id, c.seller_id);
			rescore := array[c.buyer_id, c.seller_id];

		when 'seller_declined' then
			update public.profiles set commitments_ignored = commitments_ignored + 1
			where id = c.seller_id;

		when 'buyer_cancelled', 'buyer_no_show' then
			update public.profiles set commitments_cancelled = commitments_cancelled + 1
			where id = c.buyer_id;
			rescore := array[c.buyer_id];

		when 'seller_cancelled', 'seller_no_show' then
			update public.profiles set commitments_cancelled = commitments_cancelled + 1
			where id = c.seller_id;
			rescore := array[c.seller_id];

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

	return rescore;
end;
$$;

revoke all on function public.apply_event_counters(uuid, public.commitment_event_type)
	from public, anon, authenticated;
grant execute on function public.apply_event_counters(uuid, public.commitment_event_type)
	to service_role;

-- The trigger that used to do this. Dropped, not disabled: a disabled trigger
-- is one `ALTER TABLE` away from silently double-counting every outcome.
drop trigger if exists commitment_events_count on public.commitment_events;
drop function if exists public.count_commitment_event();

-- ----------------------------------------------------------------------------
-- Reputation becomes an explicit call
-- ----------------------------------------------------------------------------
-- `calculate_reputation(uuid)` already exists and already writes exactly this.
-- Only the trigger that invoked it implicitly is removed.
--
-- The consequence worth stating: a bare UPDATE to a counter column no longer
-- recalculates anything. Nothing in the application does that — counters move
-- only through `apply_event_counters`, and the caller follows it with
-- `calculate_reputation` — but a hand-written UPDATE in a console now leaves
-- the score stale until someone recalculates it.
drop trigger if exists profiles_recalculate_reputation on public.profiles;
drop function if exists public.recalculate_reputation_on_counter_change();

-- ----------------------------------------------------------------------------
-- The market average becomes an explicit call
-- ----------------------------------------------------------------------------
-- `refresh_market_reputation()` already exists and already writes exactly
-- this. The statement-level trigger on `profiles` is removed, which also
-- removes the one genuinely awkward edge in the old chain: a bulk UPDATE
-- across many profiles fired it once per statement, so a batch and a single
-- row were indistinguishable from the outside.
drop trigger if exists profiles_refresh_market_reputation on public.profiles;
drop function if exists public.refresh_market_reputation_trigger();

-- ----------------------------------------------------------------------------
-- The final step, as one statement
-- ----------------------------------------------------------------------------
-- Recomputes the market average and returns it together with the base fee it
-- produced, so a caller can log both without a second read.
--
-- ONE UPDATE TO `market_settings`, not two. `refresh_market_reputation` writes
-- `market_reputation`; `market_settings_price` derives
-- `adjusted_base_fee_cents` inside that same statement. Issuing a separate
-- UPDATE for the fee would write the settings row twice per event, and
-- `market_settings_record_history` would record a second, identical snapshot.
--
-- `refresh_market_reputation` already skips the write when the average has not
-- changed, so an event that moves nobody's score touches nothing here.
create or replace function public.recalculate_market()
returns table (market_reputation numeric, adjusted_base_fee_cents bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform public.refresh_market_reputation();

	return query
	select s.market_reputation, s.adjusted_base_fee_cents
	from public.market_settings s
	where s.id = 1;
end;
$$;

revoke all on function public.recalculate_market() from public, anon, authenticated;
grant execute on function public.recalculate_market() to service_role;

-- ----------------------------------------------------------------------------
-- An admin changing a weight still reprices
-- ----------------------------------------------------------------------------
-- This rescores every profile, and used to rely on the statement trigger above
-- to refresh the average afterwards. With that gone it has to do it itself, or
-- changing a weight from /admin would leave the market average — and therefore
-- the base fee — describing the previous weights.
--
-- This path is admin-only and never runs inside a commitment flow, so it keeps
-- its trigger: there is no Edge Function in the sequence to make the call.
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
			commitments_successful, commitments_cancelled, commitment_checkins, commitments_total
		),
		reputation_updated_at = now()
	where id is not null;

	/** The statement trigger that used to follow this no longer exists. */
	perform public.refresh_market_reputation();

	return null;
end;
$$;
