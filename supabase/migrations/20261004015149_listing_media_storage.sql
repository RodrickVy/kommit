-- ============================================================================
-- Storage: the kommit_media bucket
-- ============================================================================
-- Holds listing photographs. Created idempotently because the bucket already
-- exists in the hosted project; this migration must still work when replayed
-- onto an empty database by `supabase db reset`.
--
-- PATH CONVENTION — policies below depend on it:
--
--     {seller_id}/{listing_id}/{random}.{ext}
--
-- The first segment being the owner's id is what lets a policy decide
-- ownership from the path alone, without a lookup.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'kommit_media',
	'kommit_media',
	-- Public read. Listing photographs are meant to be seen, and a public
	-- bucket is served from the CDN rather than through an authenticated
	-- request per image.
	--
	-- The trade-off, stated plainly: an image belonging to a draft listing is
	-- readable by anyone who knows its exact path. Paths contain two random
	-- UUIDs so they cannot be guessed or enumerated, but this is obscurity,
	-- not access control. If drafts ever need to be genuinely private, this
	-- bucket becomes private and images move to signed URLs.
	true,
	-- 8 MB. Large enough for a phone photograph, small enough that a single
	-- upload cannot tie up a connection for minutes on a weak signal.
	8388608,
	array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
	public = excluded.public,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- Policies on storage.objects
-- ----------------------------------------------------------------------------
-- storage.objects already has RLS enabled by Supabase; only policies are added.

create policy "Listing media is publicly readable"
	on storage.objects for select
	using (bucket_id = 'kommit_media');

-- A user may only write inside a folder named after their own id. This is the
-- whole reason the path begins with the seller id: without it, any
-- authenticated user could overwrite another seller's photographs.
create policy "A user can upload listing media into their own folder"
	on storage.objects for insert
	to authenticated
	with check (
		bucket_id = 'kommit_media'
		and (storage.foldername(name))[1] = (select auth.uid())::text
	);

create policy "A user can replace their own listing media"
	on storage.objects for update
	to authenticated
	using (
		bucket_id = 'kommit_media'
		and (storage.foldername(name))[1] = (select auth.uid())::text
	)
	with check (
		bucket_id = 'kommit_media'
		and (storage.foldername(name))[1] = (select auth.uid())::text
	);

create policy "A user can delete their own listing media"
	on storage.objects for delete
	to authenticated
	using (
		bucket_id = 'kommit_media'
		and (storage.foldername(name))[1] = (select auth.uid())::text
	);
