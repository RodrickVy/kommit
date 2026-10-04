import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { logStep, recordOutcome } from '../_shared/outcome.ts';
import { getCommitmentStake, stakeToLamports } from '../_shared/stake.ts';
import { transferFunds } from '../_shared/transfer.ts';
import { getPlatformWallet, getUserWallet } from '../_shared/wallets.ts';

/**
 * request_commitment, the buyer asks to meet, and puts money behind it.
 *
 *   POST /request_commitment
 *   { "listing_id": "<uuid>", "meetup_location_id": "<uuid>", "scheduled_at": "<iso>" }
 *
 * A request is not successfully created from the buyer's point of view until
 * their stake has actually moved to the Main Wallet. That ordering is the
 * whole contract: a request that merely exists is an expression of interest,
 * which is precisely the thing kommitly exists to replace.
 *
 * NOTHING IS TRUSTED FROM THE BODY except which listing, place and time.
 * The buyer comes from the JWT; the seller, the price and ownership all come
 * from the listing. A browser cannot name its own seller or its own stake.
 */

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const buyerId = await callerId(request);
	if (!buyerId) return fail('UNAUTHORIZED', 'Sign in to request a meetup.', 401);

	let body: { listing_id?: string; meetup_location_id?: string; scheduled_at?: string };
	try {
		body = await request.json();
	} catch {
		return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
	}

	const { listing_id: listingId, meetup_location_id: locationId, scheduled_at: scheduledAt } = body;

	if (!listingId || !locationId || !scheduledAt) {
		return fail('INVALID_REQUEST', 'listing_id, meetup_location_id and scheduled_at are required.', 400);
	}

	const db = serviceClient();

	try {
		const { data: listing } = await db
			.from('listings')
			.select('id, seller_id, status')
			.eq('id', listingId)
			.maybeSingle<{ id: string; seller_id: string; status: string }>();

		if (!listing) return fail('INVALID_REQUEST', 'That listing does not exist.', 404);

		if (listing.status !== 'active') {
			return fail('INVALID_REQUEST', 'That listing is no longer available.', 409);
		}

		if (listing.seller_id === buyerId) {
			return fail('INVALID_REQUEST', 'You cannot request a meetup for your own listing.', 400);
		}

		/**
		 * The location must belong to this listing's seller. Without the check a
		 * buyer could name any location id and have the seller committed to meet
		 * somewhere the seller never offered.
		 */
		const { data: location } = await db
			.from('meetup_locations')
			.select('id, profile_id, is_archived')
			.eq('id', locationId)
			.maybeSingle<{ id: string; profile_id: string; is_archived: boolean }>();

		if (!location || location.profile_id !== listing.seller_id || location.is_archived) {
			return fail('INVALID_REQUEST', 'That meetup location is not offered for this listing.', 400);
		}

		/** Both wallets must exist before anything is created. */
		const buyerWallet = await getUserWallet(db, buyerId);
		if (!buyerWallet) {
			return fail('WALLET_NOT_FOUND', 'You need a wallet before you can commit. Set one up first.', 404);
		}

		const platform = await getPlatformWallet(db);
		if (!platform) {
			return fail('INTERNAL', 'The Main Wallet has not been set up.', 503);
		}

		const stakeCents = await getCommitmentStake(db, buyerId, 'buyer');
		if (stakeCents === null) return fail('INTERNAL', 'Market settings are missing.', 500);

		const stakeLamports = await stakeToLamports(db, stakeCents);
		if (stakeLamports === null) return fail('INTERNAL', 'Market settings are missing.', 500);

		/**
		 * Created first, with the lamport columns left null.
		 *
		 * Null is what distinguishes an unfunded request from a funded one, and
		 * the row has to exist before the transfer so the transfer can reference
		 * it, both in its record and in its idempotency key. A retry therefore
		 * settles against the same commitment rather than charging twice.
		 */
		const created = await db
			.from('commitments')
			.insert({
				listing_id: listing.id,
				buyer_id: buyerId,
				seller_id: listing.seller_id,
				meetup_location_id: locationId,
				scheduled_at: scheduledAt,
				buyer_stake_cents: stakeCents,
				seller_stake_cents: stakeCents
			})
			.select('id')
			.single<{ id: string }>();

		if (created.error) {
			if (created.error.code === '23505') {
				return fail('INVALID_REQUEST', 'You already have an open request on this listing, or that time is taken.', 409);
			}
			if (created.error.message.includes('hours away')) {
				return fail('INVALID_REQUEST', 'That meetup is too soon for the seller to be able to respond.', 400);
			}

			console.error('[request_commitment] insert failed', created.error);
			return fail('INTERNAL', 'The request could not be created.', 500);
		}

		const commitmentId = created.data.id;

		const transfer = await transferFunds(db, {
			fromSecretEncrypted: buyerWallet.secretEncrypted,
			fromAddress: buyerWallet.address,
			toAddress: platform.address,
			lamports: stakeLamports,
			type: 'commitment_lock',
			walletId: buyerWallet.id,
			commitmentId,
			idempotencyKey: `commitment:${commitmentId}:buyer:lock`
		});

		if (!transfer.ok) {
			/**
			 * The stake did not move, so the request must not survive. It is
			 * removed rather than left pending: an unfunded pending row would
			 * occupy the one-open-request index, blocking the buyer from trying
			 * again, and would show the seller a request with no money behind it.
			 *
			 * Safe to delete precisely because nothing moved, the failed transfer
			 * row remains, so the attempt is still on record.
			 */
			await db.from('commitments').delete().eq('id', commitmentId);

			return fail(
				transfer.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'INTERNAL',
				transfer.message,
				transfer.code === 'INSUFFICIENT_FUNDS' ? 402 : 502,
				{ required_lamports: stakeLamports, required_cents: stakeCents }
			);
		}

		/**
		 * Recorded only now, and only the amount that actually moved. Every later
		 * refund reads this rather than reconverting the CAD figure.
		 */
		await db
			.from('commitments')
			.update({ buyer_stake_lamports: transfer.lamports })
			.eq('id', commitmentId);

		/**
		 * The core action is done: the stake has moved and the request is
		 * recorded as funded. Everything below is derived, and a failure in it
		 * must not unwind any of that or invite a retry that would transfer
		 * again — `recordOutcome` therefore reports failures rather than
		 * raising them.
		 */
		logStep('request_commitment', 'core-complete', { commitmentId });

		const outcome = await recordOutcome(db, 'request_commitment', {
			commitmentId,
			eventType: 'request_created',
			actorId: buyerId,
			actorRole: 'buyer'
		});

		if (outcome.failedAt) {
			console.error('[request_commitment] derived update failed', outcome);
		}

		return json({
			commitment_id: commitmentId,
			status: 'pending',
			stake_cents: stakeCents,
			stake_lamports: transfer.lamports,
			signature: transfer.signature,
			explorer: transfer.explorer
		});
	} catch (error) {
		console.error('[request_commitment]', error);
		return fail('INTERNAL', 'The request could not be completed.', 500);
	}
});
