import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2.117.0';

/**
 * `handle_qr_token` from the function contracts — internal function #18.
 *
 * One implementation of create / validate / consume, shared by both QR codes.
 * Two copies would mean two implementations of "usable exactly once", and the
 * second one would eventually be wrong in a way that costs somebody money.
 *
 * WHAT A TOKEN PROVES, AND WHAT IT DOES NOT
 * -----------------------------------------
 * Holding a valid token proves someone scanned the seller's screen. It proves
 * nothing about who they are. Every caller independently checks that the
 * authenticated user is the commitment's buyer, so a screenshotted code
 * forwarded to a stranger authorises nothing at all.
 *
 * That is why the token is short-lived and single-use rather than the
 * commitment id on its own: a QR encoding only the id would be a static value
 * that could be photographed once and replayed forever, from anywhere.
 *
 * THE RAW TOKEN IS NEVER STORED. Only SHA-256 of it, exactly as a password
 * would be handled, so a database dump cannot complete anybody's meetup.
 */

export type QrPurpose = 'meetup_verification' | 'purchase';

/**
 * 32 bytes from the platform CSPRNG, base64url encoded.
 *
 * Sized so that guessing is not a strategy: 256 bits of entropy inside a
 * window measured in minutes. Base64url rather than base64 because the value
 * travels in a URL inside a QR code, where plus and slash would need
 * percent-escaping — and an escaping bug here would read as a mysteriously
 * invalid code.
 */
function generateToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));

	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/** Hex SHA-256. The only form of a token that touches the database. */
async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));

	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

export interface CreatedQrToken {
	readonly tokenId: string;
	/** The raw token. Goes into the QR and back to the seller's page — nowhere else. */
	readonly token: string;
	readonly expiresAt: string;
}

/**
 * Issues a token, revoking any live one for the same commitment and purpose.
 *
 * THE REVOKE IS NOT OPTIONAL. `qr_tokens_one_live_per_purpose` is a partial
 * unique index, so the insert is refused while an unconsumed, unrevoked token
 * exists. That constraint is what makes "refreshing the QR kills the old one"
 * a fact rather than an intention: there is no ordering of these two
 * statements in which both codes are briefly valid.
 */
export async function createQrToken(
	db: SupabaseClient,
	input: {
		readonly commitmentId: string;
		readonly purpose: QrPurpose;
		readonly issuedBy: string;
		readonly expiryMinutes: number;
	}
): Promise<CreatedQrToken | null> {
	const now = new Date();

	await db
		.from('qr_tokens')
		.update({ revoked_at: now.toISOString() })
		.eq('commitment_id', input.commitmentId)
		.eq('purpose', input.purpose)
		.is('consumed_at', null)
		.is('revoked_at', null);

	const token = generateToken();
	const expiresAt = new Date(now.getTime() + input.expiryMinutes * 60_000);

	const inserted = await db
		.from('qr_tokens')
		.insert({
			commitment_id: input.commitmentId,
			purpose: input.purpose,
			token_hash: await hashToken(token),
			issued_by: input.issuedBy,
			issued_at: now.toISOString(),
			expires_at: expiresAt.toISOString()
		})
		.select('id')
		.single<{ id: string }>();

	if (inserted.error) {
		console.error('[handle_qr_token] could not issue token', inserted.error);
		return null;
	}

	return { tokenId: inserted.data.id, token, expiresAt: expiresAt.toISOString() };
}

export type QrValidationFailure =
	/** No token matches the value presented. */
	| 'QR_INVALID'
	/** Ran out of time, or was replaced by a newer code. */
	| 'QR_EXPIRED'
	/** Already used. The one case where a retry can never help. */
	| 'QR_ALREADY_USED';

export type QrValidation =
	| { readonly ok: true; readonly tokenId: string; readonly issuedBy: string }
	| { readonly ok: false; readonly code: QrValidationFailure; readonly message: string };

/**
 * Checks that a presented token is live and belongs where the caller claims.
 *
 * Both the commitment and the purpose are matched, not merely looked up: a
 * purchase token must not be accepted as proof of a meetup, and a token from
 * one commitment must not resolve against another.
 *
 * VALIDATING DOES NOT CONSUME. A caller that finds the token valid but then
 * fails its own checks must leave the code usable, so the buyer can try again
 * without the seller refreshing the display.
 */
export async function validateQrToken(
	db: SupabaseClient,
	input: {
		readonly commitmentId: string;
		readonly purpose: QrPurpose;
		readonly token: string;
	}
): Promise<QrValidation> {
	/**
	 * Length-checked before hashing. Any string hashes to something, so without
	 * this an empty value would become a well-formed lookup for a hash that
	 * simply never matches — the same outcome, reached more slowly and with a
	 * pointless round trip.
	 */
	if (typeof input.token !== 'string' || input.token.length < 16) {
		return { ok: false, code: 'QR_INVALID', message: 'That code is not valid.' };
	}

	const { data } = await db
		.from('qr_tokens')
		.select('id, commitment_id, purpose, issued_by, expires_at, revoked_at, consumed_at')
		.eq('token_hash', await hashToken(input.token))
		.maybeSingle<{
			id: string;
			commitment_id: string;
			purpose: QrPurpose;
			issued_by: string;
			expires_at: string;
			revoked_at: string | null;
			consumed_at: string | null;
		}>();

	/**
	 * A token for the wrong commitment or the wrong purpose is reported as
	 * simply invalid, with no hint that it exists. Saying "that is a purchase
	 * code, not a meetup code" would confirm to whoever scanned it that they
	 * hold a real token for a real commitment they are not part of.
	 */
	if (!data || data.commitment_id !== input.commitmentId || data.purpose !== input.purpose) {
		return {
			ok: false,
			code: 'QR_INVALID',
			message: 'That code is not valid for this commitment.'
		};
	}

	if (data.consumed_at) {
		return { ok: false, code: 'QR_ALREADY_USED', message: 'That code has already been used.' };
	}

	/**
	 * Revoked and expired share one message deliberately. Both mean "ask the
	 * seller to show it again", and the difference between running out of time
	 * and being superseded is not something the person holding the phone can
	 * act on differently.
	 */
	if (data.revoked_at || new Date(data.expires_at) <= new Date()) {
		return {
			ok: false,
			code: 'QR_EXPIRED',
			message: 'That code has expired. Ask the seller to refresh it.'
		};
	}

	return { ok: true, tokenId: data.id, issuedBy: data.issued_by };
}

/**
 * Marks a token used, and reports whether this caller is the one that used it.
 *
 * A COMPARE-AND-SET, which is the whole of the single-use guarantee. Two
 * simultaneous scans both validate successfully — validation is a read — and
 * both arrive here. `.is('consumed_at', null)` means exactly one finds the
 * token unconsumed and updates it; the other matches no rows and gets `false`.
 * Checking first and updating after would leave a gap both could pass through.
 *
 * @returns `true` when this call consumed the token, `false` when someone else
 *          already had.
 */
export async function consumeQrToken(
	db: SupabaseClient,
	tokenId: string,
	consumedBy: string
): Promise<boolean> {
	const claimed = await db
		.from('qr_tokens')
		.update({ consumed_at: new Date().toISOString(), consumed_by: consumedBy })
		.eq('id', tokenId)
		.is('consumed_at', null)
		.select('id');

	if (claimed.error) {
		console.error('[handle_qr_token] could not consume token', claimed.error);
		return false;
	}

	return (claimed.data?.length ?? 0) === 1;
}

/**
 * Releases a token that was consumed by an operation that then failed.
 *
 * Narrow on purpose, and only safe where the caller knows nothing irreversible
 * happened — a status change that was refused, a validation that came after
 * consumption. Calling it after money has moved would re-arm a code that has
 * already been paid against.
 */
export async function releaseQrToken(db: SupabaseClient, tokenId: string): Promise<void> {
	await db
		.from('qr_tokens')
		.update({ consumed_at: null, consumed_by: null })
		.eq('id', tokenId);
}
