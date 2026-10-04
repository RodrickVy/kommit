import { requireUser } from '#lib/server/auth/guards';
import { invokeFunction, loadWallet, type CreatedWallet } from '#lib/server/functions/invoke';
import type { Actions, PageServerLoad } from './$types';

/**
 * Wallet — `/wallet`.
 *
 * Everything shown here comes from `query_wallet`, which reads the balance
 * from Solana on every request. Nothing about a balance is cached or stored:
 * users are told to fund their wallet directly from Solflare, so the app would
 * otherwise be the last to know their money had arrived.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(await locals.getVerifiedUser(), url.pathname);

	const { wallet, error } = await loadWallet(locals.supabase);

	return {
		user,
		wallet,
		/**
		 * Three distinct states the page must tell apart:
		 *   wallet set        — show the balance
		 *   wallet null, no error — none created yet, offer to create one
		 *   error             — Solana or the function is down; say so rather
		 *                       than implying the money is gone
		 */
		loadError: error?.message ?? null
	};
};

export const actions: Actions = {
	/**
	 * Creates a wallet for someone who does not have one.
	 *
	 * Normally done at sign-up. This exists for the accounts that could not be
	 * — where email confirmation meant there was no session at the time — and
	 * as a recovery path if that call ever failed.
	 */
	createWallet: async ({ locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);

		const result = await invokeFunction<CreatedWallet>(
			locals.supabase,
			'create_wallet/create_user_wallet',
			{ profile_id: user.id }
		);

		if (!result.ok) {
			return { actionError: result.error.message };
		}

		return { actionError: null };
	}
};
