import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { createQrToken } from '../_shared/qr.ts';

/**
 * create_commitment_qr, issues QR #1, the meetup verification code.
 *
 *   POST /create_commitment_qr
 *   { "commitment_id": "<uuid>" }
 *
 * QR #1 PROVES THE TWO PEOPLE MET. It buys nothing and moves no purchase
 * price. Scanning it returns both stakes and closes the commitment
 * successfully, whether or not the buyer goes on to buy the item.
 *
 * The seller displays it; the buyer scans it. That direction is deliberate:
 * the person being verified is the one who has to physically be there to
 * scan, so a seller cannot complete a meetup alone.
 *
 * WHAT THE RESPONSE DELIBERATELY DOES NOT CONTAIN
 * No key material, no wallet address, no price, and no buyer or seller id. The
 * code identifies the commitment and nothing more; everything about who may
 * act on it is resolved server-side from the scanner's own session. A QR that
 * carried identities would be a QR whose identities could be edited.
 */

interface CommitmentRow {
	id: string;
	status: string;
	seller_id: string;
	buyer_checked_in_at: string | null;
	seller_checked_in_at: string | null;
	meetup_verified_at: string | null;
}

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const sellerId = await callerId(request);
	if (!sellerId) return fail('UNAUTHORIZED', 'Sign in to show a verification code.', 401);

	let body: { commitment_id?: string };
	try {
		body = await request.json();
	} catch {
		return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
	}

	if (!body.commitment_id) return fail('INVALID_REQUEST', 'commitment_id is required.', 400);

	const db = serviceClient();

	try {
		const { data: commitment } = await db
			.from('commitments')
			.select(
				'id, status, seller_id, buyer_checked_in_at, seller_checked_in_at, meetup_verified_at'
			)
			.eq('id', body.commitment_id)
			.maybeSingle<CommitmentRow>();

		if (!commitment) return fail('INVALID_REQUEST', 'That commitment does not exist.', 404);

		if (commitment.seller_id !== sellerId) {
			return fail('UNAUTHORIZED', 'Only the seller can show the verification code.', 403);
		}

		if (commitment.status !== 'accepted') {
			return fail('INVALID_REQUEST', 'This commitment is no longer active.', 409);
		}

		if (commitment.meetup_verified_at) {
			return fail('INVALID_REQUEST', 'This meetup has already been verified.', 409);
		}

		/**
		 * BOTH CHECK-INS FIRST, and this is the load-bearing rule.
		 *
		 * The code proves a meeting happened. Issuing one before both people
		 * have shown they are at the location would let a seller generate it at
		 * home, send a screenshot, and have a buyer who never left the house
		 * "verify" a meetup, returning both stakes for nothing. The check-in
		 * requirement is the only thing tying the code to a physical place.
		 */
		if (!commitment.buyer_checked_in_at || !commitment.seller_checked_in_at) {
			return fail(
				'AWAITING_OTHER_PARTY',
				'Both of you need to be checked in before the verification code can be shown.',
				409,
				{
					buyer_checked_in: Boolean(commitment.buyer_checked_in_at),
					seller_checked_in: Boolean(commitment.seller_checked_in_at)
				}
			);
		}

		const { data: settings } = await db
			.from('market_settings')
			.select('qr_token_expiry_minutes')
			.eq('id', 1)
			.maybeSingle<{ qr_token_expiry_minutes: number }>();

		if (!settings) return fail('INTERNAL', 'Market settings are missing.', 500);

		/**
		 * Issuing revokes any previous code for this commitment, so pressing
		 * refresh genuinely invalidates what was on screen a moment ago rather
		 * than leaving two live codes.
		 */
		const issued = await createQrToken(db, {
			commitmentId: commitment.id,
			purpose: 'meetup_verification',
			issuedBy: sellerId,
			expiryMinutes: settings.qr_token_expiry_minutes
		});

		if (!issued) return fail('INTERNAL', 'The verification code could not be created.', 500);

		/**
		 * A relative path, not an absolute URL. The page that renders the QR
		 * knows its own origin; hardcoding one here would mean a code generated
		 * on a preview deployment pointed at production, or vice versa.
		 */
		return json({
			commitment_id: commitment.id,
			purpose: 'meetup_verification',
			token: issued.token,
			path: `/commitment/${commitment.id}/tap?t=${encodeURIComponent(issued.token)}`,
			expires_at: issued.expiresAt,
			expires_in_minutes: settings.qr_token_expiry_minutes
		});
	} catch (error) {
		console.error('[create_commitment_qr]', error);
		return fail('INTERNAL', 'The verification code could not be created.', 500);
	}
});
