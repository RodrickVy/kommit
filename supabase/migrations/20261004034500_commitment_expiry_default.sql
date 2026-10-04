-- ============================================================================
-- Give commitments.request_expires_at a default
-- ============================================================================
-- The column is NOT NULL and is computed by the `set_commitment_request_expiry`
-- BEFORE INSERT trigger. But without a default, the column is still *required*
-- at insert time: PostgREST's generated types demand it, and any caller has to
-- supply a value that the trigger then immediately discards.
--
-- Passing a throwaway value from the application would be worse than this
-- default — it would put a meaningless timestamp in the calling code and
-- invite someone to believe it mattered.
--
-- The value here is never persisted. The trigger runs BEFORE INSERT on every
-- row, so it always overwrites this with
-- LEAST(created + expiry window, scheduled - acceptance lead).
alter table public.commitments
	alter column request_expires_at set default now();

comment on column public.commitments.request_expires_at is
	'Acceptance deadline. Always computed by set_commitment_request_expiry(); the column default exists only so callers need not supply a value that would be discarded.';
