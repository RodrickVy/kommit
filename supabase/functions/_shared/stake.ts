import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2.117.0';
import { cadCentsToLamports } from './money.ts';
import { transferFunds, type TransferResult } from './transfer.ts';
import { getCharityWallet, getMarketSettings, getPlatformWallet, getUserWallet } from './wallets.ts';

/**
 * `get_commitment_stake`, what this participant must stake, in CAD cents.
 *
 * Moves no money. The amount comes from `commitment_fee_cents` in the
 * database, the one definition of the fee shared with what the buyer is
 * shown before they commit:
 *
 *     fee = base_fee * market_reputation / their_reputation
 *
 * clamped to the configured floor and ceiling. The exact lamports transferred
 * are recorded on the commitment, so a stake agreed today stays valid however
 * the weights or reputations move later.
 */
export async function getCommitmentStake(
	db: SupabaseClient,
	profileId: string,
	_role: Party
): Promise<number | null> {
	const { data, error } = await db.rpc('commitment_fee_cents', { target: profileId });
	if (error || data === null || data === undefined) return null;
	return Number(data);
}

/** Converts a CAD stake into the lamports that will actually be transferred. */
export async function stakeToLamports(db: SupabaseClient, cents: number): Promise<number | null> {
	const settings = await getMarketSettings(db);
	if (!settings) return null;

	return cadCentsToLamports(cents, settings.sol_price_cents);
}

export type SettlementType = 'refund' | 'forfeit';

export type SettleResult =
	| {
			readonly ok: true;
			readonly signature: string;
			readonly lamports: number;
			readonly replayed: boolean;
	  }
	| { readonly ok: false; readonly code: string; readonly message: string };

/**
 * `settle_stake`, resolves money already held in the Main Wallet.
 *
 * A refund returns it to the participant; a forfeit sends it to the active
 * charity. Used by declines, cancellations, successful completions and the
 * scheduled resolver.
 *
 * IT NEVER RECALCULATES THE FEE. It reads the exact lamports recorded when the
 * stake was locked. The configured rate is editable, so reconverting the CAD
 * amount would return a different quantity of SOL than was taken, quietly
 * short-changing a user, or paying them out of other people's stakes.
 *
 * Settling the same stake twice is prevented by the idempotency key, which
 * names the commitment, the participant and the settlement type. A retry after
 * a timeout returns the original transfer rather than sending a second.
 */
export async function settleStake(
	db: SupabaseClient,
	commitmentId: string,
	role: Party,
	settlement: SettlementType
): Promise<SettleResult> {
	const { data: commitment } = await db
		.from('commitments')
		.select('id, buyer_id, seller_id, buyer_stake_lamports, seller_stake_lamports')
		.eq('id', commitmentId)
		.maybeSingle<{
			id: string;
			buyer_id: string;
			seller_id: string;
			buyer_stake_lamports: number | null;
			seller_stake_lamports: number | null;
		}>();

	if (!commitment) {
		return { ok: false, code: 'COMMITMENT_NOT_FOUND', message: 'That commitment does not exist.' };
	}

	const lamports =
		role === 'buyer' ? commitment.buyer_stake_lamports : commitment.seller_stake_lamports;

	/**
	 * Null means this participant never staked, a seller who declined, or a
	 * request whose transfer failed. Nothing is held, so there is nothing to
	 * settle, and treating it as a zero transfer would write a record claiming
	 * money moved when none did.
	 */
	if (!lamports) {
		return {
			ok: false,
			code: 'NOTHING_STAKED',
			message: `The ${role} has no stake held for this commitment.`
		};
	}

	const platform = await getPlatformWallet(db);
	if (!platform) {
		return {
			ok: false,
			code: 'MAIN_WALLET_MISSING',
			message: 'The Main Wallet has not been set up.'
		};
	}

	const participantId = role === 'buyer' ? commitment.buyer_id : commitment.seller_id;

	let toAddress: string;
	let destinationWalletId: string | null;
	let charityId: string | null = null;

	if (settlement === 'refund') {
		const wallet = await getUserWallet(db, participantId);
		if (!wallet) {
			return {
				ok: false,
				code: 'WALLET_NOT_FOUND',
				message: `The ${role} has no wallet to refund to.`
			};
		}
		toAddress = wallet.address;
		destinationWalletId = wallet.id;
	} else {
		const settings = await getMarketSettings(db);

		if (!settings?.active_charity_id) {
			/**
			 * Refusing is correct. Forfeited money belongs to a charity, and with
			 * none selected there is nowhere legitimate for it to go. Leaving it in
			 * the treasury would make the platform profit from a failed
			 * commitment, which the product explicitly forbids.
			 */
			return {
				ok: false,
				code: 'NO_ACTIVE_CHARITY',
				message: 'No charity is currently selected, so a forfeit cannot be paid.'
			};
		}

		const wallet = await getCharityWallet(db, settings.active_charity_id);
		if (!wallet) {
			return {
				ok: false,
				code: 'CHARITY_WALLET_MISSING',
				message: 'The selected charity has no wallet yet.'
			};
		}

		toAddress = wallet.address;
		destinationWalletId = wallet.id;
		charityId = settings.active_charity_id;
	}

	const result: TransferResult = await transferFunds(db, {
		fromSecretEncrypted: platform.secretEncrypted,
		fromAddress: platform.address,
		toAddress,
		lamports,
		type: settlement === 'refund' ? 'commitment_refund' : 'commitment_forfeit',
		/** Credited to the receiving wallet, which is whose history it belongs in. */
		walletId: destinationWalletId,
		commitmentId,
		charityId,
		idempotencyKey: `commitment:${commitmentId}:${role}:${settlement}`
	});

	if (!result.ok) {
		return { ok: false, code: result.code, message: result.message };
	}

	return {
		ok: true,
		signature: result.signature,
		lamports: result.lamports,
		replayed: result.replayed
	};
}
