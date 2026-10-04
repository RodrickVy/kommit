import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { createQrToken } from '../_shared/qr.ts';

/**
 * create_payment_qr — issues QR #2, the purchase code.
 *
 *   POST /create_payment_qr
 *   { "commitment_id": "<uuid>" }
 *
 * COMPLETELY SEPARATE FROM THE MEETUP. This code only exists because the buyer
 * inspected the item and wants to buy it. It is not needed to fulfil the
 * commitment, both stakes are already back, and a buyer who never scans it has
 * done nothing wrong.
 *
 * Only issued AFTER QR #1 succeeded. Purchase follows verification and never
 * precedes it: the alternative is a buyer paying for an item at a meetup the
 * platform has no evidence happened.
 */

interface CommitmentRow {
	id: string;
	status: string;
	seller_id: string;
	listing_id: string;
	meetup_verified_at: string | null;
	listings: { id: string; title: string; price_cents: number; status: string } | null;
}

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const sellerId = await callerId(request);
	if (!sellerId) return fail('UNAUTHORIZED', 'Sign in to show a purchase code.', 401);

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
				'id, status, seller_id, listing_id, meetup_verified_at, listings(id, title, price_cents, status)'
			)
			.eq('id', body.commitment_id)
			.maybeSingle<CommitmentRow>();

		if (!commitment) return fail('INVALID_REQUEST', 'That commitment does not exist.', 404);

		if (commitment.seller_id !== sellerId) {
			return fail('UNAUTHORIZED', 'Only the seller can show the purchase code.', 403);
		}

		/**
		 * Both conditions, not either. `completed` is the status; `meetup_verified_at`
		 * is the evidence. A commitment could in principle reach a resolved state
		 * by another route, and a purchase must only follow an actual verified
		 * meetup.
		 */
		if (commitment.status !== 'completed' || !commitment.meetup_verified_at) {
			return fail(
				'INVALID_REQUEST',
				'The meetup has to be verified before you can take a payment.',
				409
			);
		}

		if (!commitment.listings) {
			return fail('LISTING_UNAVAILABLE', 'This listing is no longer available.', 409);
		}

		if (commitment.listings.status === 'sold') {
			return fail('LISTING_UNAVAILABLE', 'This item has already been sold.', 409);
		}

		/**
		 * A pending payment means a purchase is mid-flight; a completed one means
		 * it is done. Issuing a fresh code in either case would invite a second
		 * charge attempt against the same item.
		 *
		 * A `failed` payment deliberately does not block: that attempt moved no
		 * money, and the buyer should be able to try again.
		 */
		const { data: live } = await db
			.from('payments')
			.select('id, status')
			.eq('commitment_id', commitment.id)
			.in('status', ['pending', 'completed'])
			.maybeSingle<{ id: string; status: string }>();

		if (live) {
			return fail(
				'ALREADY_PAID',
				live.status === 'completed'
					? 'This item has already been paid for.'
					: 'A payment for this item is already being processed.',
				409
			);
		}

		const { data: settings } = await db
			.from('market_settings')
			.select('qr_token_expiry_minutes')
			.eq('id', 1)
			.maybeSingle<{ qr_token_expiry_minutes: number }>();

		if (!settings) return fail('INTERNAL', 'Market settings are missing.', 500);

		const issued = await createQrToken(db, {
			commitmentId: commitment.id,
			purpose: 'purchase',
			issuedBy: sellerId,
			expiryMinutes: settings.qr_token_expiry_minutes
		});

		if (!issued) return fail('INTERNAL', 'The purchase code could not be created.', 500);

		/**
		 * The price is returned for the SELLER's own display, so they can read it
		 * aloud and see what they are charging. It is NOT what the buyer's page
		 * will trust: `pay_commitment` reads the price from the listing itself,
		 * because a price that travelled through a QR is a price that could have
		 * been edited on the way.
		 */
		return json({
			commitment_id: commitment.id,
			purpose: 'purchase',
			token: issued.token,
			path: `/commitment/${commitment.id}/pay?t=${encodeURIComponent(issued.token)}`,
			expires_at: issued.expiresAt,
			expires_in_minutes: settings.qr_token_expiry_minutes,
			listing_title: commitment.listings.title,
			price_cents: commitment.listings.price_cents
		});
	} catch (error) {
		console.error('[create_payment_qr]', error);
		return fail('INTERNAL', 'The purchase code could not be created.', 500);
	}
});
