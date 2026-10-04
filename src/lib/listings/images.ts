import { PUBLIC_SUPABASE_LISTINGS_BUCKET, PUBLIC_SUPABASE_URL } from '$app/env/public';

/**
 * Builds the public URL for a listing image.
 *
 * The database stores a storage PATH, never a URL. A stored URL would bake the
 * project host into every row, so moving the bucket or the project would mean
 * rewriting the table. Building the URL at render time keeps that reversible.
 *
 * The bucket is public, so this needs no signing and the result is served from
 * the CDN rather than through an authenticated request per image.
 *
 * @param storagePath Path within the bucket, as stored on `listing_images`.
 */
export function listingImageUrl(storagePath: string): string {
	return `${PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PUBLIC_SUPABASE_LISTINGS_BUCKET}/${storagePath}`;
}

/** Image types the bucket accepts. Mirrors the migration's allowed_mime_types. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/** Matches the bucket's file_size_limit, so the client can reject early. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
