import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	SystemProgram,
	Transaction,
	sendAndConfirmTransaction
} from 'npm:@solana/web3.js@^1.98.0';

import { decryptSecret, encryptSecret } from './crypto.ts';

/**
 * Every Solana interaction in kommitly goes through this module.
 *
 * Keeping it in one place means the RPC endpoint, the fee assumption and the
 * rent rule are each stated once. Those three constants are the difference
 * between a transfer that works and one that fails with a message nobody can
 * act on.
 */

export { LAMPORTS_PER_SOL };

/** Network fee for a simple transfer. Must be left spendable or the send fails. */
export const TX_FEE_LAMPORTS = 5_000;

/**
 * Solana's rent-exempt minimum. An account must hold either zero or at least
 * this much — there is no valid state between, and a transfer that would leave
 * a wallet in that gap is rejected by the chain with an error that reads like
 * a bug rather than a rule.
 */
export const RENT_MINIMUM_LAMPORTS = 890_880;

export function connection(): Connection {
	const url = Deno.env.get('SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com';

	/**
	 * `confirmed`, not `finalized`. Finalisation takes tens of seconds, which
	 * is far too long for someone standing at a meetup waiting for a payment to
	 * clear. Confirmed is settled enough for devnet and for transfers this size.
	 */
	return new Connection(url, 'confirmed');
}

export interface NewWallet {
	readonly address: string;
	readonly secretKeyEncrypted: string;
}

/**
 * Creates a wallet and encrypts its key for storage.
 *
 * The raw secret never leaves this function — it is encrypted before being
 * returned, so no caller can accidentally log or persist it in the clear.
 */
export async function createWallet(): Promise<NewWallet> {
	const keypair = Keypair.generate();

	return {
		address: keypair.publicKey.toBase58(),
		secretKeyEncrypted: await encryptSecret(keypair.secretKey)
	};
}

/** Rebuilds a signing keypair from its stored form. */
export async function loadKeypair(secretKeyEncrypted: string): Promise<Keypair> {
	return Keypair.fromSecretKey(await decryptSecret(secretKeyEncrypted));
}

/** Rejects anything malformed before it reaches the chain. */
export function parseAddress(address: string): PublicKey {
	try {
		return new PublicKey(address.trim());
	} catch {
		throw new Error(`"${address}" is not a valid Solana address.`);
	}
}

export async function getBalanceLamports(address: string): Promise<number> {
	return await connection().getBalance(parseAddress(address));
}

export interface TransferFailure {
	readonly code: 'INSUFFICIENT_FUNDS' | 'RENT_MINIMUM';
	readonly message: string;
}

/**
 * Checks a transfer against the three rules that actually reject one, and
 * returns a message a person can act on.
 *
 * Run BEFORE signing, because the chain's own errors here are opaque:
 * "Transaction simulation failed: Insufficient funds for rent" tells a user
 * nothing about what to do next.
 *
 * @returns `null` when the transfer may proceed.
 */
export async function checkCanSend(
	fromAddress: string,
	toAddress: string,
	lamports: number
): Promise<TransferFailure | null> {
	const sol = (value: number) => (value / LAMPORTS_PER_SOL).toFixed(4);

	const balance = await getBalanceLamports(fromAddress);
	const remaining = balance - lamports - TX_FEE_LAMPORTS;

	if (remaining < 0) {
		return {
			code: 'INSUFFICIENT_FUNDS',
			message:
				`Not enough SOL. The wallet holds ${sol(balance)} and this needs ` +
				`${sol(lamports + TX_FEE_LAMPORTS)} including the network fee.`
		};
	}

	/**
	 * Leaving a non-zero amount below the rent minimum is invalid: the account
	 * must either keep the minimum or be emptied completely.
	 */
	if (remaining > 0 && remaining < RENT_MINIMUM_LAMPORTS) {
		return {
			code: 'RENT_MINIMUM',
			message:
				`Solana requires a wallet to keep at least ${sol(RENT_MINIMUM_LAMPORTS)} SOL ` +
				'or be emptied completely. Send a smaller amount, or send everything.'
		};
	}

	/** A brand-new account cannot be created holding less than the minimum. */
	if (lamports < RENT_MINIMUM_LAMPORTS && (await getBalanceLamports(toAddress)) === 0) {
		return {
			code: 'RENT_MINIMUM',
			message:
				'The receiving wallet is empty, so its first transfer must be at least ' +
				`${sol(RENT_MINIMUM_LAMPORTS)} SOL.`
		};
	}

	return null;
}

/**
 * Signs and sends a transfer, waiting for confirmation.
 *
 * THE REUSABLE MOVEMENT PRIMITIVE. Every flow that moves value — taking a
 * stake, refunding one, forfeiting one to a charity, paying for an item,
 * withdrawing — calls this and nothing else. There is exactly one piece of
 * code in kommitly that signs a transaction, which is the only way to be sure
 * the fee, rent and confirmation rules are applied consistently.
 *
 * @returns The confirmed transaction signature.
 */
export async function sendLamports(
	fromSecretEncrypted: string,
	toAddress: string,
	lamports: number
): Promise<string> {
	const sender = await loadKeypair(fromSecretEncrypted);

	const transaction = new Transaction().add(
		SystemProgram.transfer({
			fromPubkey: sender.publicKey,
			toPubkey: parseAddress(toAddress),
			lamports
		})
	);

	/**
	 * Waits for confirmation rather than returning on submission, so the caller
	 * knows the money actually moved before it writes a `completed` row. A
	 * record that claims a transfer happened when it did not is worse than no
	 * record at all.
	 */
	return await sendAndConfirmTransaction(connection(), transaction, [sender], {
		commitment: 'confirmed'
	});
}

/** Explorer link for a signature, so anyone can verify a transfer themselves. */
export function explorerUrl(signature: string): string {
	const cluster = Deno.env.get('SOLANA_NETWORK') ?? 'devnet';
	return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}
