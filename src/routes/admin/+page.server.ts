import { error, fail } from '@sveltejs/kit';
import { PUBLIC_SOLANA_NETWORK } from '$app/env/public';
import { isAdminUser } from '#lib/server/auth/admin';
import { requireUser } from '#lib/server/auth/guards';
import { invokeFunction } from '#lib/server/functions/invoke';
import { renderQrSvg } from '#lib/server/qr';
import { getBalances } from '#lib/server/solana/balance';
import { adminClient } from '#lib/server/supabase/admin-client';
import type { Actions, PageServerLoad } from './$types';

/**
 * Admin — `/admin`.
 *
 * The whole operator surface, and deliberately small. Two jobs:
 *
 *   1. fund the Main Wallet — it pays every refund, so an empty treasury means
 *      every settlement fails
 *   2. decide which charity receives forfeited stakes, and keep the charity
 *      records right
 *
 * WHY 404 AND NOT 403
 * -------------------
 * A 403 confirms the page exists. There is no benefit in telling a visitor
 * that kommitly has an admin page at a path they just guessed correctly, so a
 * non-administrator gets the same answer as for any other URL that is not
 * theirs.
 *
 * WHY THE PRIVILEGED CLIENT IS USED HERE
 * --------------------------------------
 * `platform_wallet` has RLS enabled with no policies at all, and `charities`
 * has no write policy — both are reachable only by the service role. That is
 * correct: the treasury and the donation destination must not be writable from
 * any session, however the session was obtained.
 *
 * So this page authorises with the user's own verified session and then acts
 * with the service role, and the two steps stay in that order. Wallet
 * CREATION still goes through the Edge Function, because the encryption key
 * lives in the function runtime and nowhere else.
 */

/** Columns shown and edited. Listed once so load and actions cannot drift apart. */
const CHARITY_FIELDS = 'id, name, short_name, description, website_url, is_active, created_at';

interface CharityRow {
	id: string;
	name: string;
	short_name: string | null;
	description: string | null;
	website_url: string | null;
	is_active: boolean;
	created_at: string;
	wallets: { solana_address: string } | null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(await locals.getVerifiedUser(), url.pathname);

	if (!(await isAdminUser(user))) {
		error(404, 'Not found.');
	}

	const db = adminClient();

	const [treasury, charityResult, settingsResult] = await Promise.all([
		db.from('platform_wallet').select('solana_address, created_at').eq('id', 1).maybeSingle(),

		/**
		 * The wallet arrives as a single object, not a list, because
		 * `wallets.charity_id` is unique — a charity has at most one wallet and
		 * PostgREST knows it.
		 */
		db
			.from('charities')
			.select(`${CHARITY_FIELDS}, wallets(solana_address)`)
			.order('name')
			.returns<CharityRow[]>(),

		db
			.from('market_settings')
			.select('active_charity_id, currency_code, sol_price_cents, check_in_radius_metres, check_in_window_minutes, qr_token_expiry_minutes, base_commitment_fee_cents')
			.eq('id', 1)
			.maybeSingle()
	]);

	const charities = charityResult.data ?? [];

	/**
	 * Every address in one pass. The Main Wallet balance is the number an
	 * operator actually came here for, and a charity with a balance is visible
	 * proof that forfeits are landing somewhere real.
	 */
	const addresses = [
		treasury.data?.solana_address,
		...charities.map((charity) => charity.wallets?.solana_address)
	].filter((address): address is string => typeof address === 'string');

	const balances = await getBalances(addresses);

	return {
		network: PUBLIC_SOLANA_NETWORK,
		treasury: treasury.data
			? {
					address: treasury.data.solana_address,
					created_at: treasury.data.created_at,
					lamports: balances[treasury.data.solana_address] ?? null,

					/**
					 * A QR of the bare address, which is what every Solana wallet app
					 * expects to scan for a deposit. Rendered here so funding from a
					 * phone does not involve retyping 44 base58 characters.
					 */
					qr: await renderQrSvg(treasury.data.solana_address)
				}
			: null,
		charities: charities.map((charity) => ({
			...charity,
			address: charity.wallets?.solana_address ?? null,
			lamports: charity.wallets?.solana_address
				? (balances[charity.wallets.solana_address] ?? null)
				: null
		})),
		settings: settingsResult.data
	};
};

/** Every action returns this shape, so the page branches on one thing. */
interface ActionResult {
	actionError: string | null;
	message: string | null;
}

const ok = (message: string): ActionResult => ({ actionError: null, message });
const problem = (actionError: string): ActionResult => ({ actionError, message: null });

/**
 * Confirms the caller administers the marketplace, for an ACTION.
 *
 * Re-checked on every action rather than trusted from the load. A form POST is
 * a separate request, and admin rights could have been revoked in between —
 * and nothing stops a POST being sent without ever loading the page.
 */
async function requireAdmin(locals: App.Locals, pathname: string) {
	const user = requireUser(await locals.getVerifiedUser(), pathname);

	if (!(await isAdminUser(user))) error(404, 'Not found.');

	return user;
}

/** Trimmed, with blank normalised to null so "cleared" and "absent" are one value. */
function text(data: FormData, field: string): string | null {
	const value = data.get(field);

	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Accepts only an https URL.
 *
 * Mirrors the database check rather than duplicating its reasoning: a
 * donation destination shown over plain http is not verifiable by the person
 * whose stake was forfeited. Validated here too so the admin gets a sentence
 * instead of a constraint violation.
 */
function websiteUrl(data: FormData): { ok: true; value: string | null } | { ok: false } {
	const raw = text(data, 'website_url');
	if (!raw) return { ok: true, value: null };

	try {
		return new URL(raw).protocol === 'https:' ? { ok: true, value: raw } : { ok: false };
	} catch {
		return { ok: false };
	}
}

export const actions: Actions = {
	/**
	 * Chooses which charity receives forfeited stakes from now on.
	 *
	 * Only future forfeits follow the change. Every past one recorded the
	 * charity it actually went to on its `wallet_transactions` row, so the
	 * history stays truthful however often this is switched.
	 */
	activateCharity: async ({ locals, request, url }) => {
		const user = await requireAdmin(locals, url.pathname);
		const data = await request.formData();
		const charityId = text(data, 'charity_id');

		if (!charityId) return fail(400, problem('No charity was selected.'));

		const db = adminClient();

		/**
		 * The charity must exist, be active, AND have a wallet. Selecting one
		 * without a wallet would point every forfeit at an address that does not
		 * exist — and `settle_stake` would refuse, turning each cancellation into
		 * an error nobody could explain from the UI.
		 */
		const { data: charity } = await db
			.from('charities')
			.select('id, name, short_name, is_active, wallets(solana_address)')
			.eq('id', charityId)
			.maybeSingle<{
				id: string;
				name: string;
				short_name: string | null;
				is_active: boolean;
				wallets: { solana_address: string } | null;
			}>();

		if (!charity) return fail(404, problem('That charity does not exist.'));
		if (!charity.is_active) return fail(409, problem('That charity is archived. Reactivate it first.'));

		if (!charity.wallets?.solana_address) {
			return fail(
				409,
				problem(
					'That charity has no wallet yet, so forfeited stakes would have nowhere to go. Create its wallet first.'
				)
			);
		}

		/**
		 * `updated_by` is what the history trigger records. Without it the
		 * snapshot would say the configuration changed but not who changed it.
		 */
		const { error: updateError } = await db
			.from('market_settings')
			.update({ active_charity_id: charityId, updated_by: user.id, updated_at: new Date().toISOString() })
			.eq('id', 1);

		if (updateError) {
			console.error('[admin] could not set the active charity', updateError);
			return fail(500, problem('The active charity could not be changed.'));
		}

		return ok(`Forfeited stakes now go to ${charity.short_name ?? charity.name}.`);
	},

	/**
	 * Adds a charity and gives it a wallet.
	 *
	 * The wallet is created in the same action rather than left for later. A
	 * charity without one cannot be selected, so creating them separately just
	 * produces a record that looks complete and refuses to work.
	 */
	addCharity: async ({ locals, request, url }) => {
		await requireAdmin(locals, url.pathname);
		const data = await request.formData();

		const name = text(data, 'name');
		if (!name) return fail(400, problem('A legal name is required.'));

		const website = websiteUrl(data);
		if (!website.ok) return fail(400, problem('The website must be a full https:// address.'));

		const inserted = await adminClient()
			.from('charities')
			.insert({
				name,
				short_name: text(data, 'short_name'),
				description: text(data, 'description'),
				website_url: website.value,
				is_active: true
			})
			.select('id, name')
			.single();

		if (inserted.error) {
			console.error('[admin] could not add the charity', inserted.error);
			return fail(500, problem('The charity could not be added.'));
		}

		const wallet = await invokeFunction<{ created: boolean; solana_address: string }>(
			locals.supabase,
			'create_wallet/create_charity_wallet',
			{ charity_id: inserted.data.id }
		);

		/**
		 * The charity stands either way — it is a real record and deleting it
		 * would lose the detail just typed in. Said plainly rather than reporting
		 * success, because without a wallet it cannot be activated, and the
		 * operator needs to know that now rather than when a forfeit fails.
		 */
		if (!wallet.ok) {
			console.error('[admin] charity added without a wallet', wallet.error);

			return fail(
				502,
				problem(
					`${inserted.data.name} was added, but its wallet could not be created: ${wallet.error.message} Use Create wallet to retry.`
				)
			);
		}

		return ok(`${inserted.data.name} added, with wallet ${wallet.data.solana_address}.`);
	},

	/**
	 * Edits a charity's details.
	 *
	 * Deliberately cannot change the wallet. The address is recorded on every
	 * forfeit that has ever gone to this charity, so replacing it would leave
	 * past donations sitting at an address nothing refers to.
	 */
	updateCharity: async ({ locals, request, url }) => {
		await requireAdmin(locals, url.pathname);
		const data = await request.formData();

		const charityId = text(data, 'charity_id');
		const name = text(data, 'name');

		if (!charityId) return fail(400, problem('No charity was identified.'));
		if (!name) return fail(400, problem('A legal name is required.'));

		const website = websiteUrl(data);
		if (!website.ok) return fail(400, problem('The website must be a full https:// address.'));

		const isActive = data.get('is_active') === 'on';

		const db = adminClient();

		/**
		 * Archiving the charity that is currently selected would leave
		 * `active_charity_id` pointing at an inactive record, and every forfeit
		 * would then pay a charity the operator thought they had retired.
		 */
		if (!isActive) {
			const { data: settings } = await db
				.from('market_settings')
				.select('active_charity_id')
				.eq('id', 1)
				.maybeSingle<{ active_charity_id: string | null }>();

			if (settings?.active_charity_id === charityId) {
				return fail(
					409,
					problem('This charity is currently receiving forfeited stakes. Select another one first.')
				);
			}
		}

		const { error: updateError } = await db
			.from('charities')
			.update({
				name,
				short_name: text(data, 'short_name'),
				description: text(data, 'description'),
				website_url: website.value,
				is_active: isActive
			})
			.eq('id', charityId);

		if (updateError) {
			console.error('[admin] could not update the charity', updateError);
			return fail(500, problem('The charity could not be updated.'));
		}

		return ok(`${name} updated.`);
	},

	/**
	 * Creates a missing charity wallet.
	 *
	 * Idempotent, because `create_wallet` is: if one already exists it is
	 * returned rather than replaced. That is the behaviour that matters here —
	 * a second wallet would not be a duplicate, it would be an address the
	 * charity's existing donations no longer point at.
	 */
	createCharityWallet: async ({ locals, request, url }) => {
		await requireAdmin(locals, url.pathname);
		const data = await request.formData();

		const charityId = text(data, 'charity_id');
		if (!charityId) return fail(400, problem('No charity was identified.'));

		const wallet = await invokeFunction<{ created: boolean; solana_address: string }>(
			locals.supabase,
			'create_wallet/create_charity_wallet',
			{ charity_id: charityId }
		);

		if (!wallet.ok) return fail(502, problem(wallet.error.message));

		return ok(
			wallet.data.created
				? `Wallet created: ${wallet.data.solana_address}`
				: `That charity already had a wallet: ${wallet.data.solana_address}`
		);
	},

	/**
	 * Runs the scheduled resolver now.
	 *
	 * Normally the scheduler calls `process_commitments`; this is the same
	 * function invoked by hand, which is useful while testing and when
	 * something needs clearing after an outage. It is safe to press repeatedly:
	 * every status change is a compare-and-set and every settlement is
	 * idempotent, so a second run finds nothing left to do.
	 */
	runResolver: async ({ locals, url }) => {
		await requireAdmin(locals, url.pathname);

		const result = await invokeFunction<{
			expired: number;
			resolved: number;
			reconciled: number;
			settlements_outstanding: number;
		}>(locals.supabase, 'process_commitments');

		if (!result.ok) return fail(502, problem(result.error.message));

		const { expired, resolved, reconciled, settlements_outstanding } = result.data;

		const summary =
			`${expired} request(s) expired, ${resolved} commitment(s) resolved, ` +
			`${reconciled} settlement(s) reconciled.`;

		/**
		 * An outstanding settlement is reported as a problem, not folded into the
		 * success line. The run did its job; some money did not move, and that is
		 * the part an operator has to act on.
		 */
		return settlements_outstanding > 0
			? fail(
					502,
					problem(
						`${summary} ${settlements_outstanding} settlement(s) could not be paid — check the function logs.`
					)
				)
			: ok(summary);
	}
};
