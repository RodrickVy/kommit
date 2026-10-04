-- ============================================================================
-- Publishing needs a place and a time; holds last for the meetup day
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A listing cannot be published until its seller can actually be met
-- ----------------------------------------------------------------------------
-- A published listing with no meetup location or no upcoming availability
-- shows up in Discover but can never be requested. The publish action checks
-- this first so it can explain; this trigger is the guarantee.
--
-- Only a move INTO `active` from draft or withdrawn is checked. `reserved` ->
-- `active` is the system releasing a hold, and must never be refused.
create or replace function public.require_meetup_setup_to_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.status = 'active' and old.status in ('draft', 'withdrawn') then
		if not exists (
			select 1 from public.meetup_locations
			where profile_id = new.seller_id and not is_archived
		) then
			raise exception 'Add a meetup location before publishing.'
				using errcode = 'check_violation';
		end if;

		if not exists (
			select 1 from public.availability_rules
			where profile_id = new.seller_id
				and not is_archived
				and (specific_date is null
					or specific_date >= (now() at time zone 'America/Vancouver')::date)
		) then
			raise exception 'Add a time you can meet before publishing.'
				using errcode = 'check_violation';
		end if;
	end if;

	return new;
end;
$$;

create trigger listings_require_meetup_setup
	before update of status on public.listings
	for each row execute function public.require_meetup_setup_to_publish();

-- ----------------------------------------------------------------------------
-- Purchase hold: until the end of the meetup day
-- ----------------------------------------------------------------------------
-- Check-in, verification and payment are all bounded by the meetup's calendar
-- day now, not by a window of minutes. A verified meetup keeps the listing
-- reserved for its buyer until that day ends.
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
					and now() < (
						((c.scheduled_at at time zone 'America/Vancouver')::date + 1)::timestamp
							at time zone 'America/Vancouver'
					)
				)
			)
	);
$$;
