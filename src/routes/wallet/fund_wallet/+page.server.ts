import { redirect } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards';
import { loadWallet } from '#lib/server/functions/invoke';
import { renderQrSvg } from '#lib/server/qr';
import type { PageServerLoad } from './$types';

/**
 * Fund wallet, `/wallet/fund_wallet`.
 *
 * Where a new user lands immediately after sign-up. Its only job is to get SOL
 * into their wallet, so it shows the address, the current balance, and how to
 * send to it, and nothing else.
 *
 * The balance is read live on every load. The user is about to send money from
 * an app we have no connection to, so the only way to know it arrived is to
 * ask Solana again.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	requireUser(await locals.getVerifiedUser(), url.pathname);

	const { wallet, error } = await loadWallet(locals.supabase);

	/**
	 * Without a wallet there is nothing to fund. Sent back to /wallet, which
	 * offers to create one, rather than showing an address-less funding page.
	 */
	if (!wallet && !error) {
		redirect(303, '/wallet');
	}

	/**
	 * Rendered on the server so the browser receives markup rather than a
	 * drawing library. Most people doing this have Solflare on their phone and
	 * kommitly open on a laptop, and scanning is the only way to move 44 base58
	 * characters between the two without a typo.
	 */
	const qr = wallet ? await renderQrSvg(wallet.solana_address) : null;

	return { wallet, qr, loadError: error?.message ?? null };
};
