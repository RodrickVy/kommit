import { requireUser } from '#lib/server/auth/guards';
import { fail } from '@sveltejs/kit';
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
			return fail(502, { actionError: result.error.message, withdrawal: null });
		}

		return { actionError: null, withdrawal: null };
	},

	/**
	 * Sends SOL out to an address the user supplies.
	 *
	 * The source is never accepted from the form — `withdraw_funds` resolves it
	 * from the caller's own session. An endpoint that took a source wallet would
	 * let anyone drain anyone, which is the risk a custodial design has to be
	 * most careful about.
	 */
	withdraw: async ({ request, locals, url }) => {
		requireUser(await locals.getVerifiedUser(), url.pathname);

		const form = await request.formData();
		const destination = String(form.get('destination') ?? '').trim();
		const amount = String(form.get('amount') ?? '').trim();
		const withdrawAll = form.get('all') !== null;

		if (!destination) {
			return fail(400, { actionError: 'Enter the address to send to.', withdrawal: null });
		}

		const sol = Number(amount);

		if (!withdrawAll && (!Number.isFinite(sol) || sol <= 0)) {
			return fail(400, { actionError: 'Enter an amount greater than zero.', withdrawal: null });
		}

		/**
		 * A key per submission, so a double-tapped button collapses into one
		 * transfer while two deliberate withdrawals of the same amount remain
		 * two separate operations.
		 */
		const result = await invokeFunction<{
			lamports: number;
			sol: number;
			signature: string;
			explorer: string;
		}>(locals.supabase, 'withdraw_funds', {
			destination_address: destination,
			...(withdrawAll ? { all: true } : { sol }),
			idempotency_key: `withdraw:${crypto.randomUUID()}`
		});

		if (!result.ok) {
			return fail(result.error.code === 'INSUFFICIENT_FUNDS' ? 402 : 502, {
				actionError: result.error.message,
				withdrawal: null
			});
		}

		return {
			actionError: null,
			withdrawal: {
				sol: result.data.sol,
				signature: result.data.signature,
				explorer: result.data.explorer
			}
		};
	}
};
