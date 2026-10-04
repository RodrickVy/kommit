import { PUBLIC_SOLANA_NETWORK } from '$app/env/public';

/**
 * Solana Explorer link for a transaction signature — the public receipt
 * anyone can open to verify a transfer happened. Points at the cluster the
 * app is configured for, so a devnet signature never opens on mainnet.
 */
export function explorerTxUrl(signature: string): string {
	const cluster = PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? '' : `?cluster=${PUBLIC_SOLANA_NETWORK}`;
	return `https://explorer.solana.com/tx/${signature}${cluster}`;
}
