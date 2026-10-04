-- ============================================================================
-- TESTING: a commitment may be requested for any date and time
-- ============================================================================
-- Temporarily lifts the minimum-notice rule so a meetup can be requested for
-- today, a few minutes from now, or a date that has already passed. The
-- request still expires 24 hours after it was made if the seller ignores it.
--
-- TO RESTORE: write a new migration that re-creates this function with the
-- commented-out lines below put back (the original is in
-- 20261004032718_commitments.sql).
create or replace function public.set_commitment_request_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	expiry_hours integer;
	lead_hours integer;
begin
	select request_expiry_hours, minimum_acceptance_lead_hours
		into expiry_hours, lead_hours
		from public.market_settings where id = 1;

	-- TESTING: deadline no longer capped by the meetup time.
	new.request_expires_at := new.created_at + make_interval(hours => expiry_hours);

	-- TESTING: minimum notice disabled.
	-- new.request_expires_at := least(
	-- 	new.created_at + make_interval(hours => expiry_hours),
	-- 	new.scheduled_at - make_interval(hours => lead_hours)
	-- );
	--
	-- if new.request_expires_at <= new.created_at then
	-- 	raise exception 'A meetup must be at least % hours away.', lead_hours
	-- 		using errcode = 'check_violation';
	-- end if;

	return new;
end;
$$;
