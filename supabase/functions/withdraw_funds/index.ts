import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { LAMPORTS_PER_SOL, TX_FEE_LAMPORTS, getWalletBalance, parseAddress } from '../_shared/solana.ts';
import { transferFunds } from '../_shared/transfer.ts';
import { getUserWallet } from '../_shared/wallets.ts';

/**
 * withdraw_funds, send SOL out of a kommitly wallet to an address the user
 * supplies.
 *
 *   POST /withdraw_funds
 *   { "destination_address": "<base58>", "sol": 0.5 }
 *   { "destination_address": "<base58>", "all": true }
 *
 * The SOURCE is always the caller's own wallet, resolved from the JWT. There
 * is deliberately no way to name a source: the whole point of a custodial
 * wallet is that the server signs, so an endpoint that accepted a source wallet
 * would let anyone drain anyone.
 */

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const profileId = await callerId(request);
	if (!profileId) return fail('UNAUTHORIZED', 'Sign in to withdraw.', 401);

	let body: { destination_address?: string; sol?: number; all?: boolean; idempotency_key?: string };
	try {
		body = await request.json();
	} catch {
		return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
	}

	const destination = (body.destination_address ?? '').trim();

	if (!destination) {
		return fail('INVALID_REQUEST', 'A destination address is required.', 400);
	}

	/** Checked before anything else: an invalid address burns a real transfer. */
	try {
		parseAddress(destination);
	} catch {
		return fail('INVALID_REQUEST', 'That is not a valid Solana address.', 400);
	}

	const db = serviceClient();

	try {
		const wallet = await getUserWallet(db, profileId);
		if (!wallet) return fail('WALLET_NOT_FOUND', 'You do not have a wallet.', 404);

		if (destination === wallet.address) {
			return fail('INVALID_REQUEST', 'That is your own kommitly wallet address.', 400);
		}

		const balance = await getWalletBalance(wallet.address);

		let lamports: number;

		if (body.all) {
			/**
			 * Emptying the wallet means leaving exactly nothing, which is the only
			 * state below the rent minimum that Solana permits. The fee has to come
			 * out of the amount sent rather than be added to it.
			 */
			lamports = balance - TX_FEE_LAMPORTS;

			if (lamports <= 0) {
				return fail('INSUFFICIENT_FUNDS', 'There is nothing to withdraw.', 402);
			}
		} else {
			if (typeof body.sol !== 'number' || !Number.isFinite(body.sol) || body.sol <= 0) {
				return fail('INVALID_REQUEST', 'Enter an amount greater than zero.', 400);
			}

			lamports = Math.round(body.sol * LAMPORTS_PER_SOL);

			if (lamports <= 0) {
				return fail('INVALID_REQUEST', 'That amount is too small to send.', 400);
			}
		}

		/**
		 * Without a caller-supplied key, every withdrawal is its own operation,
		 * a user may legitimately withdraw the same amount twice. The key is
		 * therefore derived from the request so a double-submitted FORM collapses
		 * into one transfer, while two deliberate withdrawals minutes apart do
		 * not.
		 *
		 * The UI supplies a key per attempt; absent one, the minute-bucketed
		 * fallback still absorbs an accidental double tap.
		 */
		const idempotencyKey =
			body.idempotency_key ??
			`withdraw:${profileId}:${destination}:${lamports}:${Math.floor(Date.now() / 60_000)}`;

		const transfer = await transferFunds(db, {
			fromSecretEncrypted: wallet.secretEncrypted,
			fromAddress: wallet.address,
			toAddress: destination,
			lamports,
			type: 'withdrawal',
			walletId: wallet.id,
			idempotencyKey
		});

		if (!transfer.ok) {
			const status =
				transfer.code === 'INSUFFICIENT_FUNDS' || transfer.code === 'RENT_MINIMUM'
					? 402
					: transfer.code === 'IN_FLIGHT'
						? 409
						: 502;

			return fail(
				transfer.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'CHAIN_UNAVAILABLE',
				transfer.message,
				status
			);
		}

		return json({
			destination,
			lamports: transfer.lamports,
			sol: transfer.lamports / LAMPORTS_PER_SOL,
			signature: transfer.signature,
			explorer: transfer.explorer,
			replayed: transfer.replayed
		});
	} catch (error) {
		console.error('[withdraw_funds]', error);
		return fail('INTERNAL', 'The withdrawal could not be completed.', 500);
	}
});
