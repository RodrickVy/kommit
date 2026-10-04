import { error, fail } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards';
import { invokeFunction } from '#lib/server/functions/invoke';
import type { Actions, PageServerLoad } from './$types';

/**
 * Purchase — `/commitment/[commitment_id]/pay`.
 *
 * The destination encoded in QR #2. Entirely separate from the meetup: by the
 * time anyone reaches this page the commitment is already fulfilled and both
 * stakes are back, so buying is a free choice and the page has to read like
 * one.
 *
 * SCANNING NEVER CHARGES. The load asks `pay_commitment` for a QUOTE — the
 * same function, same conversion, no `confirm` — and only the POST pays. That
 * is why the figure on the button is the figure that will be taken: it was
 * produced by the code that takes it, not calculated again here.
 */

/** What a quote looks like. The same shape the page renders. */
interface Quote {
	quote: true;
	listing_title: string;
	amount_cents: number;
	amount_lamports: number;
	fee_lamports: number;
	sol_price_cents: number;
	currency_code: string;
	rate_source: string;
	balance_lamports: number | null;
	/** Null when Solana could not be reached — not the same as "cannot afford". */
	sufficient: boolean | null;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	/**
	 * `pathname + search` so signing in returns the buyer here WITH the token,
	 * rather than to a payment page that has forgotten what it was for.
	 */
	const user = requireUser(await locals.getVerifiedUser(), `${url.pathname}${url.search}`);

	const token = url.searchParams.get('t') ?? '';

	const { data: commitment } = await locals.supabase
		.from('commitments')
		.select('id, status, buyer_id, seller_id, meetup_verified_at, listings(title, price_cents, status)')
		.eq('id', params.commitment_id)
		.maybeSingle();

	if (!commitment) error(404, 'That commitment does not exist.');

	const { data: payment } = await locals.supabase
		.from('payments')
		.select('id, status, amount_cents, amount_lamports, solana_signature')
		.eq('commitment_id', commitment.id)
		.eq('status', 'completed')
		.maybeSingle();

	const base = {
		commitmentId: commitment.id,
		token,
		listingTitle: commitment.listings?.title ?? null,
		payment
	};

	const blocked = (problemTitle: string, problem: string) => ({
		...base,
		outcome: 'blocked' as const,
		problemTitle,
		problem,
		quote: null
	});

	/** A completed purchase is success, however the page was reached. */
	if (payment) {
		return { ...base, outcome: 'paid' as const, problemTitle: '', problem: '', quote: null };
	}

	if (commitment.buyer_id !== user.id) {
		return blocked(
			'The buyer scans this code',
			commitment.seller_id === user.id
				? 'You are the seller — this is the code you show, not one you scan.'
				: 'This code belongs to someone else’s purchase.'
		);
	}

	if (commitment.status !== 'completed' || !commitment.meetup_verified_at) {
		return blocked(
			'Verify the meetup first',
			'Buying comes after the meetup is verified. Open the commitment and complete the verification code.'
		);
	}

	if (!token) {
		return blocked(
			'No code was scanned',
			'This page needs the code from the seller’s screen. Ask them to show it again.'
		);
	}

	/**
	 * The quote runs every validation the payment will, so an expired or
	 * already-used code is reported here rather than after the buyer commits to
	 * pressing Pay.
	 */
	const quoted = await invokeFunction<Quote>(locals.supabase, 'pay_commitment', {
		commitment_id: commitment.id,
		token
	});

	if (!quoted.ok) {
		return blocked(
			quoted.error.code === 'QR_EXPIRED' ? 'This code has expired' : 'This purchase cannot proceed',
			quoted.error.message
		);
	}

	return {
		...base,
		outcome: 'ready' as const,
		problemTitle: '',
		problem: '',
		quote: quoted.data
	};
};

export const actions: Actions = {
	/**
	 * Takes the payment.
	 *
	 * `confirm: true` is set here and only here, which is what makes the
	 * difference between rendering this page and buying something.
	 */
	pay: async ({ locals, params, request, url }) => {
		requireUser(await locals.getVerifiedUser(), `${url.pathname}${url.search}`);

		const data = await request.formData();
		const token = data.get('token');

		if (typeof token !== 'string' || !token) {
			return fail(400, {
				actionError: 'The code was missing. Ask the seller to show it again.',
				needsFunds: false
			});
		}

		const result = await invokeFunction<{ signature: string; amount_cents: number }>(
			locals.supabase,
			'pay_commitment',
			{ commitment_id: params.commitment_id, token, confirm: true }
		);

		if (!result.ok) {
			const needsFunds = result.error.code === 'INSUFFICIENT_FUNDS';

			/**
			 * Insufficient funds leaves everything else intact — the commitment is
			 * still complete, the stakes are still back, and the code is still
			 * usable. Topping up and trying again is the whole remedy, and the
			 * message must not suggest the meetup is in doubt.
			 */
			return fail(needsFunds ? 402 : 409, {
				actionError: result.error.message,
				needsFunds
			});
		}

		/**
		 * The load re-runs and will now find a completed payment, so it renders
		 * the paid state from the database rather than from this return value.
		 */
		return { actionError: null, needsFunds: false };
	}
};
