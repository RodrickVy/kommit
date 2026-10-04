import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2.117.0';

/**
 * Looking up the wallets a money movement needs.
 *
 * Each returns the encrypted key alongside the address, because the caller is
 * about to sign with it. These are only reachable from an Edge Function using
 * the service role, the secret column is granted to no role a browser can
 * reach.
 */

export interface WalletRecord {
	readonly id: string | null;
	readonly address: string;
	readonly secretEncrypted: string;
}

/**
 * The Main Wallet, holding commitment stakes between locking and settlement.
 *
 * Its `id` is null because it is not a row in `wallets`: it has no owner, which
 * is exactly why `wallet_transactions.wallet_id` is nullable.
 */
export async function getPlatformWallet(db: SupabaseClient): Promise<WalletRecord | null> {
	const { data } = await db
		.from('platform_wallet')
		.select('solana_address, secret_key_encrypted')
		.eq('id', 1)
		.maybeSingle<{ solana_address: string; secret_key_encrypted: string }>();

	if (!data) return null;

	return { id: null, address: data.solana_address, secretEncrypted: data.secret_key_encrypted };
}

export async function getUserWallet(
	db: SupabaseClient,
	profileId: string
): Promise<WalletRecord | null> {
	const { data } = await db
		.from('wallets')
		.select('id, solana_address, secret_key_encrypted')
		.eq('profile_id', profileId)
		.maybeSingle<{ id: string; solana_address: string; secret_key_encrypted: string }>();

	if (!data) return null;

	return { id: data.id, address: data.solana_address, secretEncrypted: data.secret_key_encrypted };
}

export async function getCharityWallet(
	db: SupabaseClient,
	charityId: string
): Promise<WalletRecord | null> {
	const { data } = await db
		.from('wallets')
		.select('id, solana_address, secret_key_encrypted')
		.eq('charity_id', charityId)
		.maybeSingle<{ id: string; solana_address: string; secret_key_encrypted: string }>();

	if (!data) return null;

	return { id: data.id, address: data.solana_address, secretEncrypted: data.secret_key_encrypted };
}

export interface MarketSettings {
	readonly base_commitment_fee_cents: number;
	readonly min_commitment_fee_cents: number;
	readonly max_commitment_fee_cents: number;
	readonly sol_price_cents: number;
	readonly active_charity_id: string | null;
}

export async function getMarketSettings(db: SupabaseClient): Promise<MarketSettings | null> {
	const { data } = await db
		.from('market_settings')
		.select(
			'base_commitment_fee_cents, min_commitment_fee_cents, max_commitment_fee_cents, sol_price_cents, active_charity_id'
		)
		.eq('id', 1)
		.maybeSingle<MarketSettings>();

	return data ?? null;
}
