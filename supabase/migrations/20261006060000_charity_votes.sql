-- ============================================================================
-- Charity votes decide where forfeited stakes go
-- ============================================================================
-- Each signed-in user has one vote per calendar month (America/Vancouver).
-- Voting again that month moves the vote rather than adding a second one.
-- After every vote, the charity with the most votes this month becomes
-- `market_settings.active_charity_id`, which is where a no-show's stake is
-- sent. On a tie the current charity stays, so a single vote cannot flip a
-- level contest back and forth.

create table public.charity_votes (
	id uuid primary key default gen_random_uuid(),
	profile_id uuid not null references public.profiles (id) on delete cascade,
	charity_id uuid not null references public.charities (id) on delete cascade,
	voted_at timestamptz not null default now(),
	-- First day of the month the vote belongs to, resolved once at write time
	-- in the marketplace's zone, so the month boundary never shifts.
	vote_month date not null,

	constraint charity_votes_one_per_month unique (profile_id, vote_month)
);

create index charity_votes_month_charity on public.charity_votes (vote_month, charity_id);

alter table public.charity_votes enable row level security;

-- A user may see their own votes. Tallies are public through
-- `charity_vote_tally()`, which never reveals who voted for what.
create policy "A user can read their own votes"
	on public.charity_votes for select
	to authenticated
	using (profile_id = (select auth.uid()));

-- No insert/update/delete policy: votes are cast only through
-- `cast_charity_vote()`, which enforces one per month and updates the choice.
revoke all on public.charity_votes from anon, authenticated;
grant select on public.charity_votes to authenticated;

-- The current month, as stored in `vote_month`.
create or replace function public.current_vote_month()
returns date
language sql
stable
set search_path = ''
as $$
	select date_trunc('month', now() at time zone 'America/Vancouver')::date;
$$;

-- ----------------------------------------------------------------------------
-- This month's tally, plus the caller's own vote
-- ----------------------------------------------------------------------------
create or replace function public.charity_vote_tally()
returns table (charity_id uuid, votes integer, is_my_vote boolean)
language sql
stable
security definer
set search_path = ''
as $$
	select
		c.id,
		count(v.id)::integer,
		coalesce(bool_or(v.profile_id = (select auth.uid())), false)
	from public.charities c
	left join public.charity_votes v
		on v.charity_id = c.id and v.vote_month = public.current_vote_month()
	where c.is_active
	group by c.id;
$$;

grant execute on function public.charity_vote_tally() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Picks this month's leader and makes it the active charity
-- ----------------------------------------------------------------------------
-- Only a charity that has a wallet can receive a forfeit, so only those are
-- eligible. Ties keep the current charity.
create or replace function public.apply_charity_vote_result()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	current_id uuid;
	top_votes integer;
	winner uuid;
begin
	select active_charity_id into current_id from public.market_settings where id = 1;

	select max(t.votes) into top_votes
	from (
		select count(v.id) as votes
		from public.charities c
		join public.wallets w on w.charity_id = c.id
		left join public.charity_votes v
			on v.charity_id = c.id and v.vote_month = public.current_vote_month()
		where c.is_active
		group by c.id
	) t;

	-- Nobody has voted this month: leave the current charity in place.
	if top_votes is null or top_votes = 0 then
		return current_id;
	end if;

	-- The current charity keeps its place if it is tied for the lead.
	select c.id into winner
	from public.charities c
	join public.wallets w on w.charity_id = c.id
	left join public.charity_votes v
		on v.charity_id = c.id and v.vote_month = public.current_vote_month()
	where c.is_active
	group by c.id
	having count(v.id) = top_votes
	order by (c.id = current_id) desc, min(v.voted_at) asc
	limit 1;

	if winner is not null and winner is distinct from current_id then
		update public.market_settings set active_charity_id = winner where id = 1;
	end if;

	return coalesce(winner, current_id);
end;
$$;

revoke all on function public.apply_charity_vote_result() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Cast (or move) the caller's vote for this month
-- ----------------------------------------------------------------------------
create or replace function public.cast_charity_vote(target uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	voter uuid := (select auth.uid());
	month date := public.current_vote_month();
begin
	if voter is null then
		raise exception 'Sign in to vote.' using errcode = 'insufficient_privilege';
	end if;

	if not exists (select 1 from public.charities where id = target and is_active) then
		raise exception 'That charity is not available to vote for.' using errcode = 'check_violation';
	end if;

	insert into public.charity_votes (profile_id, charity_id, vote_month)
	values (voter, target, month)
	on conflict (profile_id, vote_month)
	do update set charity_id = excluded.charity_id, voted_at = now();

	update public.profiles
	set last_vote = now(), last_vote_choice = target
	where id = voter;

	return public.apply_charity_vote_result();
end;
$$;

revoke all on function public.cast_charity_vote(uuid) from public, anon;
grant execute on function public.cast_charity_vote(uuid) to authenticated;
