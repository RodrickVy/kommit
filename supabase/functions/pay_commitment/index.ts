import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { cadCentsToLamports } from '../_shared/money.ts';
import { getSolRate } from '../_shared/price.ts';
import { consumeQrToken, validateQrToken } from '../_shared/qr.ts';
import { TX_FEE_LAMPORTS, getWalletBalance } from '../_shared/solana.ts';
import { transferFunds } from '../_shared/transfer.ts';
import { getUserWallet } from '../_shared/wallets.ts';
import { meetupDay } from '../_shared/meetup_day.ts';

/**
 * pay_commitment — the optional item purchase, after a verified meetup.
 *
 *   POST /pay_commitment
 *   { "commitment_id": "<uuid>", "token": "<from QR #2>" }                 -> quote
 *   { "commitment_id": "<uuid>", "token": "<from QR #2>", "confirm": true } -> pay
 *
 * TWO MODES, ONE CODE PATH. Without `confirm` it returns a quote: the price,
 * the exact lamports that would move, the rate used, and whether the buyer can
 * afford it. With `confirm: true` it charges that same figure.
 *
 * The quote is not a convenience. The buyer's page has to display the amount
 * it is about to take, and computing that anywhere else would mean two pieces
 * of code converting a price — which is how a button comes to say one number
 * and charge another. Both modes run every validation, so an expired code is
 * reported before the buyer reaches for the button.
 *
 * THE MAIN WALLET IS NOT INVOLVED. This is buyer wallet to seller wallet,
 * directly. Commitment stakes went through the treasury because they are held
 * and returned; a purchase is not held, so routing it through the platform
 * would mean the platform briefly owned the buyer's money for no reason.
 *
 * SCANNING NEVER CHARGES. `confirm` must be explicitly true, and the buyer's
 * page sends it only when they press the Pay button. A QR that debited on scan
 * would make a camera a payment instrument.
 *
 * THE PRICE COMES FROM THE LISTING, never from the request or the QR. Both are
 * attacker-controllable; the listing is the seller's own published figure.
 */

interface CommitmentRow {
	id: string;
	status: string;
	buyer_id: string;
	seller_id: string;
	listing_id: string;
	scheduled_at: string;
	meetup_verified_at: string | null;
	listings: { id: string; title: string; price_cents: number; status: string } | null;
}

/**
 * Statuses a listing may be bought in.
 *
 * A verified meetup keeps the listing `reserved` until the end of the meetup
 * day (see `listing_is_held` in the migrations), so `reserved` is the normal
 * state here.
 */
const PURCHASABLE = new Set(['active', 'reserved']);

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const buyerId = await callerId(request);
	if (!buyerId) return fail('UNAUTHORIZED', 'Sign in to pay.', 401);

	let body: { commitment_id?: string; token?: string; confirm?: boolean };
	try {
		body = await request.json();
	} catch {
		return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
	}

	if (!body.commitment_id || !body.token) {
		return fail('INVALID_REQUEST', 'commitment_id and token are required.', 400);
	}

	/**
	 * THE DELIBERATE-ACTION GATE. Anything other than exactly `true` is a
	 * quote, so a page that merely renders the purchase cannot take it, and a
	 * malformed or truthy-but-not-true value falls to the safe side.
	 */
	const confirmed = body.confirm === true;

	const db = serviceClient();

	try {
		const { data: commitment } = await db
			.from('commitments')
			.select(
				'id, status, buyer_id, seller_id, listing_id, scheduled_at, meetup_verified_at, listings(id, title, price_cents, status)'
			)
			.eq('id', body.commitment_id)
			.maybeSingle<CommitmentRow>();

		if (!commitment) return fail('INVALID_REQUEST', 'That commitment does not exist.', 404);

		/** Only the buyer pays. Another user scanning the code gets nothing. */
		if (commitment.buyer_id !== buyerId) {
			return fail('UNAUTHORIZED', 'Only the buyer on this commitment can pay for it.', 403);
		}

		if (commitment.status !== 'completed' || !commitment.meetup_verified_at) {
			return fail('INVALID_REQUEST', 'The meetup has to be verified before paying.', 409);
		}

		/** Buying happens at the meetup, on its day — not days later. */
		if (Date.now() >= meetupDay(commitment.scheduled_at).end.getTime()) {
			return fail('WINDOW_CLOSED', 'The day of this meetup has passed, so it can no longer be paid for here.', 409);
		}

		if (!commitment.listings || !PURCHASABLE.has(commitment.listings.status)) {
			return fail(
				'LISTING_UNAVAILABLE',
				commitment.listings?.status === 'sold'
					? 'This item has already been sold.'
					: 'This item is no longer available for purchase.',
				409
			);
		}

		/**
		 * An existing completed payment is reported as success, not as an error.
		 * A buyer whose connection dropped after the transfer confirmed should
		 * see that they paid — telling them the code was used would read as a
		 * failure for something that worked.
		 */
		const { data: existing } = await db
			.from('payments')
			.select('id, status, amount_cents, amount_lamports, solana_signature')
			.eq('commitment_id', commitment.id)
			.in('status', ['pending', 'completed'])
			.maybeSingle<{
				id: string;
				status: string;
				amount_cents: number;
				amount_lamports: number;
				solana_signature: string | null;
			}>();

		if (existing?.status === 'completed') {
			return json({
				commitment_id: commitment.id,
				payment_id: existing.id,
				already_paid: true,
				amount_cents: existing.amount_cents,
				amount_lamports: existing.amount_lamports,
				signature: existing.solana_signature,
				message: 'This item has already been paid for.'
			});
		}

		if (existing?.status === 'pending') {
			return fail(
				'ALREADY_PAID',
				'A payment for this item is already being processed. Check back in a moment.',
				409
			);
		}

		const validation = await validateQrToken(db, {
			commitmentId: commitment.id,
			purpose: 'purchase',
			token: body.token
		});

		if (!validation.ok) return fail(validation.code, validation.message, 409);

		return await resolve(db, commitment, validation.tokenId, buyerId, confirmed);
	} catch (error) {
		console.error('[pay_commitment]', error);
		return fail('INTERNAL', 'The payment could not be completed.', 500);
	}
});


/**
 * Works out what the purchase costs, then quotes it or charges it.
 *
 * Both modes share every step up to the transfer, which is the point: the
 * figure the buyer is shown is produced by the code that will take it, so the
 * button cannot say one number and charge another.
 */
async function resolve(
	db: ReturnType<typeof serviceClient>,
	commitment: CommitmentRow,
	tokenId: string,
	buyerId: string,
	confirmed: boolean
): Promise<Response> {
	const listing = commitment.listings!;

	const buyerWallet = await getUserWallet(db, buyerId);
	if (!buyerWallet) {
		return fail('WALLET_NOT_FOUND', 'You need a wallet before you can pay.', 404);
	}

	const sellerWallet = await getUserWallet(db, commitment.seller_id);
	if (!sellerWallet) {
		/**
		 * Not the buyer's fault and not something they can fix, so it must not
		 * read as a problem with their payment.
		 */
		return fail(
			'WALLET_NOT_FOUND',
			'The seller has no wallet to receive payment. They need to set one up.',
			409
		);
	}

	const rate = await getSolRate(db);
	if (!rate) return fail('INTERNAL', 'Market settings are missing.', 500);

	const lamports = cadCentsToLamports(listing.price_cents, rate.centsPerSol);

	/**
	 * Read live, not from a stored figure. The buyer may have topped up in
	 * another tab seconds ago, and telling them they cannot afford something
	 * they can is worse than a slow page.
	 *
	 * A null balance means Solana could not be reached, which is NOT zero. It
	 * is reported as unknown so the page does not offer Add funds to someone
	 * who already has plenty.
	 */
	let balance: number | null = null;
	try {
		balance = await getWalletBalance(buyerWallet.address);
	} catch (cause) {
		console.warn('[pay_commitment] balance unavailable', cause);
	}

	const required = lamports + TX_FEE_LAMPORTS;

	if (!confirmed) {
		return json({
			quote: true,
			commitment_id: commitment.id,
			listing_title: listing.title,

			/** The authoritative price, from the listing. Never from the QR or the request. */
			amount_cents: listing.price_cents,
			amount_lamports: lamports,
			fee_lamports: TX_FEE_LAMPORTS,

			sol_price_cents: rate.centsPerSol,
			currency_code: rate.currencyCode,
			rate_source: rate.source,

			balance_lamports: balance,

			/**
			 * Null rather than false when the balance is unknown. "They cannot
			 * afford it" and "we could not check" need different wording, and
			 * collapsing them would send someone to top up a wallet that is
			 * already funded.
			 */
			sufficient: balance === null ? null : balance >= required
		});
	}

	return await pay(db, commitment, tokenId, buyerId, {
		buyerWallet,
		sellerWallet,
		rate,
		lamports
	});
}

/**
 * Moves the listing price from the buyer's wallet to the seller's.
 *
 * ORDER, AND WHY THE TOKEN IS CONSUMED LAST
 * -----------------------------------------
 *   1. claim a `pending` payment row — its partial unique index is what stops
 *      two concurrent taps from both reaching the chain
 *   2. transfer
 *   3. on success: complete the payment, mark the listing sold, consume the
 *      token
 *
 * The token SURVIVES A FAILED TRANSFER, deliberately. If Solana rejects it,
 * nothing moved, and the buyer should be able to add funds and press Pay again
 * using the code already on the seller's screen. Consuming first would force
 * the seller to reissue a code for a payment that never happened. Double
 * charging is prevented by the idempotency key, not by burning the code.
 */
async function pay(
	db: ReturnType<typeof serviceClient>,
	commitment: CommitmentRow,
	tokenId: string,
	buyerId: string,
	priced: {
		buyerWallet: { id: string | null; address: string; secretEncrypted: string };
		sellerWallet: { address: string };
		rate: { centsPerSol: number; source: string };
		lamports: number;
	}
): Promise<Response> {
	const listing = commitment.listings!;
	const { buyerWallet, sellerWallet, rate, lamports } = priced;

	/**
	 * Claims the right to pay. A unique index covers `pending` and `completed`
	 * rows for one commitment, so a second simultaneous tap loses here and
	 * never reaches the chain. Recorded BEFORE the transfer, so a crash
	 * mid-flight leaves a row to reconcile rather than a silent transfer.
	 */
	const claimed = await db
		.from('payments')
		.insert({
			commitment_id: commitment.id,
			listing_id: listing.id,
			buyer_id: buyerId,
			seller_id: commitment.seller_id,
			amount_cents: listing.price_cents,
			amount_lamports: lamports,
			sol_price_cents: rate.centsPerSol,
			rate_source: rate.source,
			status: 'pending',
			qr_token_id: tokenId
		})
		.select('id')
		.single<{ id: string }>();

	if (claimed.error) {
		/** 23505 is a unique violation: another attempt claimed it first. */
		if (claimed.error.code === '23505') {
			return fail('ALREADY_PAID', 'A payment for this item is already being processed.', 409);
		}

		console.error('[pay_commitment] could not record payment', claimed.error);
		return fail('INTERNAL', 'The payment could not be started.', 500);
	}

	const paymentId = claimed.data.id;

	const transfer = await transferFunds(db, {
		fromSecretEncrypted: buyerWallet.secretEncrypted,
		fromAddress: buyerWallet.address,
		toAddress: sellerWallet.address,
		lamports,
		type: 'purchase',
		walletId: buyerWallet.id,
		commitmentId: commitment.id,
		/** One purchase per commitment, so a retry under the same key cannot charge twice. */
		idempotencyKey: `commitment:${commitment.id}:purchase`
	});

	if (!transfer.ok) {
		/**
		 * `failed`, not deleted. The partial unique index only blocks `pending`
		 * and `completed`, so a failed row lets the buyer try again while leaving
		 * a record that an attempt was made and why it did not work.
		 */
		await db
			.from('payments')
			.update({ status: 'failed', failure_reason: transfer.message.slice(0, 400) })
			.eq('id', paymentId);

		const insufficient = transfer.code === 'INSUFFICIENT_FUNDS';

		return fail(
			insufficient ? 'INSUFFICIENT_FUNDS' : 'CHAIN_UNAVAILABLE',
			transfer.message,
			insufficient ? 402 : 502,
			{ required_lamports: lamports, price_cents: listing.price_cents }
		);
	}

	await db
		.from('payments')
		.update({
			status: 'completed',
			solana_signature: transfer.signature,
			completed_at: new Date().toISOString()
		})
		.eq('id', paymentId);

	/**
	 * The money has moved, so everything below is bookkeeping that must not be
	 * allowed to fail the request. Each is logged on failure instead: telling
	 * the buyer their payment failed after it confirmed would be the worst
	 * possible answer, because they would pay again.
	 */
	const sold = await db
		.from('listings')
		.update({ status: 'sold' })
		.eq('id', listing.id)
		.neq('status', 'sold');

	if (sold.error) {
		console.error('[pay_commitment] listing not marked sold', sold.error);
	}

	if (!(await consumeQrToken(db, tokenId, buyerId))) {
		console.error('[pay_commitment] token already consumed at completion', { paymentId });
	}

	await db.from('commitment_events').insert({
		commitment_id: commitment.id,
		event_type: 'purchase_completed',
		actor_profile_id: buyerId,
		actor_role: 'buyer'
	});

	return json({
		quote: false,
		commitment_id: commitment.id,
		payment_id: paymentId,
		already_paid: false,
		amount_cents: listing.price_cents,
		amount_lamports: transfer.lamports,

		/** Returned so the page can state the rate it charged at, and where it came from. */
		sol_price_cents: rate.centsPerSol,
		rate_source: rate.source,

		signature: transfer.signature,
		explorer: transfer.explorer,
		message: `Paid. ${listing.title} is yours.`
	});
}
