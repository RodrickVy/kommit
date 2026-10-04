-- ============================================================================
-- Market reputation was not refreshing when an individual score changed
-- ============================================================================
-- THE BUG
--
-- `profiles_refresh_market_reputation` was declared as:
--
--     after insert or delete or update OF reputation on public.profiles
--
-- and `UPDATE OF <column>` in Postgres fires only when that column is named
-- as a target of the UPDATE STATEMENT. It is decided from the statement's SET
-- list, before any trigger runs, and a BEFORE trigger that modifies NEW does
-- not retroactively add the column to it.
--
-- Every ordinary outcome reaches reputation through exactly that path.
-- `count_commitment_event` runs:
--
--     update public.profiles set commitments_successful = commitments_successful + 1
--
-- whose target column is `commitments_successful`. The BEFORE trigger
-- `profiles_recalculate_reputation` then recomputes `new.reputation` -- so the
-- individual score updated correctly -- but `reputation` was never a target of
-- the statement, so the market refresh never fired.
--
-- The result: market reputation only moved when something wrote the column
-- explicitly, which in practice meant a weight change from /admin or a
-- migration's bulk rescore. Between those it drifted. It was found at 1.114
-- while the true average of the six live profiles was 1.157, and since the
-- commitment fee divides by it, every stake quoted in between was wrong.
--
-- THE FIX
--
-- Watch the counters that cause a rescore, as well as `reputation` itself.
-- Those three columns are precisely the inputs to `reputation_score`, so any
-- statement targeting one of them is a statement that can change a score.
--
-- Deliberately NOT a bare `after update` with no column list. That would also
-- fire on a display-name edit or a receipts-preference toggle, recomputing an
-- aggregate over every profile for a change that cannot affect it. The list
-- is the same one `profiles_recalculate_reputation` watches, and the two
-- should be changed together -- if a fourth input ever joins the formula, it
-- belongs in both.
--
-- INSERT and DELETE need no column list; Postgres ignores one for those
-- events, so a new account joining the average and a deleted one leaving it
-- were already handled.
drop trigger if exists profiles_refresh_market_reputation on public.profiles;

create trigger profiles_refresh_market_reputation
	after insert or delete or update of
		reputation,
		commitments_successful,
		commitments_cancelled,
		commitment_checkins
	on public.profiles
	for each statement
	execute function public.refresh_market_reputation_trigger();

-- Bring the stored value back in line with the scores it is meant to average.
-- Safe to run on every deploy: `refresh_market_reputation` skips the write
-- when the answer has not changed, so a replay touches nothing.
select public.refresh_market_reputation();
