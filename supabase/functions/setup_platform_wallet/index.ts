import { serviceClient } from '../_shared/db.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';
import { hasServiceRole } from '../_shared/privileged.ts';
import { createWallet } from '../_shared/solana.ts';

/**
 * setup_platform_wallet — creates the single Kommitly Main Wallet.
 *
 * A SETUP STEP, not a feature. Run once, by an operator, with the service role
 * key. There is no UI for it and no user can reach it.
 *
 *   npm run setup:platform-wallet
 *
 * The Main Wallet temporarily holds commitment stakes between being locked and
 * being settled. It has no owner, which is why it lives in its own table
 * rather than as a `wallets` row with both owner columns null.
 *
 * WHY THIS IS A FUNCTION AND NOT A MIGRATION
 * The wallet's private key must be encrypted with the same mechanism as every
 * other custodial key, and that encryption key is an Edge Function secret. It
 * is deliberately absent from Postgres, so a migration could not encrypt
 * anything — it would have to store the key in the clear, which is the one
 * thing the design exists to prevent.
 *
 * IDEMPOTENT. Running it twice returns the existing wallet and generates
 * nothing. That matters more here than anywhere else: a second Main Wallet
 * would not be a duplicate, it would be an empty treasury while every held
 * stake sits in an address the app has stopped using.
 */

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	/**
	 * Service role only. A user's JWT is explicitly not enough — this creates
	 * the account that will hold everyone's staked funds.
	 *
	 * Checked as a CAPABILITY rather than by comparing the token to an expected
	 * string. Supabase issues service credentials in more than one format, and
	 * which one a project injects can change, so a string comparison fails for
	 * reasons that have nothing to do with authorisation.
	 *
	 * `platform_wallet` has RLS enabled and no policies at all, so every role
	 * except the service role is denied. Successfully reading from it with the
	 * caller's own token therefore proves the caller holds service-role rights,
	 * whatever the credential looks like. The database answers the question
	 * rather than a hardcoded assumption.
	 */
	if (!(await hasServiceRole(request))) {
		return fail('UNAUTHORIZED', 'This is a setup operation and requires the service role.', 403);
	}

	const db = serviceClient();

	try {
		const existing = await db
			.from('platform_wallet')
			.select('id, solana_address, created_at')
			.eq('id', 1)
			.maybeSingle<{ id: number; solana_address: string; created_at: string }>();

		if (existing.data) {
			return json({
				created: false,
				solana_address: existing.data.solana_address,
				created_at: existing.data.created_at,
				message: 'The Main Wallet already exists. Nothing was changed.'
			});
		}

		const wallet = await createWallet();

		const inserted = await db
			.from('platform_wallet')
			.insert({
				id: 1,
				solana_address: wallet.address,
				secret_key_encrypted: wallet.secretKeyEncrypted
			})
			.select('solana_address, created_at')
			.single<{ solana_address: string; created_at: string }>();

		if (inserted.error) {
			/**
			 * A unique violation means a concurrent run won. The desired state is
			 * reached either way, so read theirs back — the alternative is a
			 * caller who believes setup failed and runs it again.
			 */
			if (inserted.error.code === '23505') {
				const raced = await db
					.from('platform_wallet')
					.select('solana_address, created_at')
					.eq('id', 1)
					.single<{ solana_address: string; created_at: string }>();

				return json({
					created: false,
					solana_address: raced.data?.solana_address ?? null,
					created_at: raced.data?.created_at ?? null,
					message: 'The Main Wallet already exists. Nothing was changed.'
				});
			}

			console.error('[setup_platform_wallet] insert failed', inserted.error);
			return fail('INTERNAL', 'The Main Wallet could not be saved.', 500);
		}

		return json({
			created: true,
			solana_address: inserted.data.solana_address,
			created_at: inserted.data.created_at,
			message:
				'Main Wallet created. It holds no SOL yet — fund it before any stake is settled, ' +
				'since refunds are paid out of it.'
		});
	} catch (error) {
		console.error('[setup_platform_wallet]', error);
		return fail('INTERNAL', 'The Main Wallet could not be created.', 500);
	}
});
