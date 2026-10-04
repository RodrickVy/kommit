import { callerId, serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { createWallet } from '../_shared/solana.ts';

/**
 * create_wallet — gives an owner a custodial Solana wallet.
 *
 * Two endpoints, distinguished by path. They do almost the same thing; what
 * differs is who the wallet belongs to and who is allowed to ask.
 *
 *   POST /create_wallet/create_user_wallet     { "profile_id": "<uuid>" }
 *   POST /create_wallet/create_charity_wallet  { "charity_id": "<uuid>" }
 *
 * Response (both):
 *   { "created": true, "wallet_id": "<uuid>", "solana_address": "<base58>" }
 *
 * `created` is false when the owner already had a wallet. Calling twice is
 * safe and returns the existing one rather than failing — this is invoked
 * right after sign-up, where a retry after a timeout is ordinary, and a hard
 * error there would strand a new account with no wallet.
 *
 * The new wallet holds nothing. Funding is the user's job, and the app sends
 * them to /wallet/fund_wallet to do it.
 */

interface WalletRow {
	id: string;
	solana_address: string;
}

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const isCharity = new URL(request.url).pathname.endsWith('create_charity_wallet');

	let body: { profile_id?: string; charity_id?: string };
	try {
		body = await request.json();
	} catch {
		return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
	}

	const db = serviceClient();

	try {
		if (isCharity) {
			return await createFor(db, 'charity_id', body.charity_id, 'charities');
		}

		const profileId = body.profile_id;

		if (!profileId) {
			return fail('INVALID_REQUEST', 'profile_id is required.', 400);
		}

		/**
		 * The requested profile must be the caller's own.
		 *
		 * The id arrives in the body, but it is NOT what decides whose wallet
		 * this is — the JWT is. Without this check, any signed-in user could
		 * name someone else's profile and have a wallet created under it, and
		 * the owner would never know a custodial key existed in their name.
		 *
		 * A service-role caller skips the check, which is how the server
		 * invokes this during sign-up before any user session exists.
		 */
		const caller = await callerId(request);
		const isServiceRole = caller === null && isServiceRoleToken(request);

		if (!isServiceRole && caller !== profileId) {
			return fail('UNAUTHORIZED', 'You can only create your own wallet.', 403);
		}

		return await createFor(db, 'profile_id', profileId, 'profiles');
	} catch (error) {
		/**
		 * The message is logged but never returned. A failure here can carry
		 * details of the encryption setup, and this response goes to a browser.
		 */
		console.error('[create_wallet]', error);
		return fail('INTERNAL', 'The wallet could not be created.', 500);
	}
});

/** True when the bearer token is the service role rather than a user session. */
function isServiceRoleToken(request: Request): boolean {
	const token = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
	return token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

/**
 * Shared body of both endpoints.
 *
 * @param ownerColumn `profile_id` or `charity_id`.
 * @param ownerId     The owner to create a wallet for.
 * @param ownerTable  Where to confirm that owner exists.
 */
async function createFor(
	db: ReturnType<typeof serviceClient>,
	ownerColumn: 'profile_id' | 'charity_id',
	ownerId: string | undefined,
	ownerTable: 'profiles' | 'charities'
): Promise<Response> {
	if (!ownerId) {
		return fail('INVALID_REQUEST', `${ownerColumn} is required.`, 400);
	}

	/**
	 * Return the existing wallet rather than creating a second one. The unique
	 * constraint would reject a duplicate anyway, but failing on a retry is
	 * unhelpful when the correct outcome — this owner has a wallet — is already
	 * true.
	 */
	const existing = await db
		.from('wallets')
		.select('id, solana_address')
		.eq(ownerColumn, ownerId)
		.maybeSingle<WalletRow>();

	if (existing.data) {
		return json({
			created: false,
			wallet_id: existing.data.id,
			solana_address: existing.data.solana_address
		});
	}

	/**
	 * The owner must exist. Without this a typo creates an orphaned wallet
	 * holding a key nobody can ever reach — and for a charity, money sent to it
	 * would be unrecoverable.
	 */
	const owner = await db.from(ownerTable).select('id').eq('id', ownerId).maybeSingle();

	if (!owner.data) {
		return fail('OWNER_NOT_FOUND', `No ${ownerTable.slice(0, -1)} with that id.`, 404);
	}

	const wallet = await createWallet();

	const inserted = await db
		.from('wallets')
		.insert({
			[ownerColumn]: ownerId,
			solana_address: wallet.address,
			secret_key_encrypted: wallet.secretKeyEncrypted
		})
		.select('id, solana_address')
		.single<WalletRow>();

	if (inserted.error) {
		/**
		 * A unique violation means a concurrent call won the race. The desired
		 * state is reached either way, so read theirs back rather than failing.
		 */
		if (inserted.error.code === '23505') {
			const raced = await db
				.from('wallets')
				.select('id, solana_address')
				.eq(ownerColumn, ownerId)
				.single<WalletRow>();

			if (raced.data) {
				return json({
					created: false,
					wallet_id: raced.data.id,
					solana_address: raced.data.solana_address
				});
			}
		}

		console.error('[create_wallet] insert failed', inserted.error);
		return fail('INTERNAL', 'The wallet could not be saved.', 500);
	}

	return json({
		created: true,
		wallet_id: inserted.data.id,
		solana_address: inserted.data.solana_address
	});
}
