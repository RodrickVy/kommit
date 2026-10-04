/**
 * Encryption for custodial wallet secret keys.
 *
 * AES-256-GCM via WebCrypto, which Deno provides natively — no dependency, and
 * GCM is authenticated, so ciphertext that has been tampered with fails to
 * decrypt rather than yielding garbage that gets used as a signing key.
 *
 * THE ENCRYPTION KEY IS NOT IN THE DATABASE. It is an Edge Function secret
 * (`WALLET_ENCRYPTION_KEY`), so a database dump on its own decrypts nothing.
 *
 * Losing that secret is unrecoverable: every wallet it protects becomes
 * permanently unspendable. It belongs in a password manager as well as in
 * Supabase.
 */

/** 96 bits, the size GCM is specified for. */
const IV_BYTES = 12;

function requireKeyMaterial(): Uint8Array {
	const raw = Deno.env.get('WALLET_ENCRYPTION_KEY');

	if (!raw) {
		throw new Error(
			'WALLET_ENCRYPTION_KEY is not set. Generate one with ' +
				'`openssl rand -base64 32` and set it with `supabase secrets set`.'
		);
	}

	const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

	if (bytes.length !== 32) {
		throw new Error(`WALLET_ENCRYPTION_KEY must decode to 32 bytes, got ${bytes.length}.`);
	}

	return bytes;
}

async function importKey(): Promise<CryptoKey> {
	return await crypto.subtle.importKey('raw', requireKeyMaterial(), { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
}

/**
 * Encrypts a secret key for storage.
 *
 * @returns base64 of `iv || ciphertext`. The IV is random per call and stored
 *          alongside rather than derived, because reusing an IV with the same
 *          key in GCM is catastrophic — it leaks the key stream.
 */
export async function encryptSecret(secret: Uint8Array): Promise<string> {
	const key = await importKey();
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secret)
	);

	const combined = new Uint8Array(iv.length + ciphertext.length);
	combined.set(iv);
	combined.set(ciphertext, iv.length);

	return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a stored secret key.
 *
 * Call this as late as possible and never hold the result longer than the
 * signature it produces.
 */
export async function decryptSecret(stored: string): Promise<Uint8Array> {
	const combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));

	const iv = combined.slice(0, IV_BYTES);
	const ciphertext = combined.slice(IV_BYTES);

	const key = await importKey();

	/**
	 * GCM throws here if the ciphertext or IV has been altered. That is the
	 * authentication doing its job, and the failure must not be swallowed —
	 * signing with a corrupted key would produce an invalid transaction at
	 * best, and at worst a transfer to nowhere.
	 */
	return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext));
}
