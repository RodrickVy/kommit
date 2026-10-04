<script lang="ts">
	import Panel from '#lib/components/ui/Panel.svelte';
	import type { WalletState } from '#lib/server/functions/invoke';

	/**
	 * WalletBalance — the balance, as read from Solana.
	 *
	 * Used on the wallet page, the account page and the home dashboard, so the
	 * same number is formatted identically everywhere and the network is always
	 * stated alongside it.
	 */
	interface Props {
		wallet: WalletState;
		/** Hide the address where it would be noise, e.g. a dashboard tile. */
		showAddress?: boolean;
	}

	let { wallet, showAddress = false }: Props = $props();

	/**
	 * Four decimal places. Two is not enough — commitment stakes and network
	 * fees both live below a hundredth of a SOL, so rounding to cents would
	 * display a non-zero balance as 0.00.
	 */
	const sol = $derived(wallet.sol.toFixed(4));

	const approximate = $derived(
		wallet.value_cents === null || wallet.currency_code === null
			? null
			: new Intl.NumberFormat('en-CA', {
					style: 'currency',
					currency: wallet.currency_code
				}).format(wallet.value_cents / 100)
	);

	const isLiveNetwork = $derived(wallet.network === 'mainnet-beta');
</script>

<Panel>
	<h2 class="title">Balance</h2>

	<p class="amount">
		{sol}
		<span class="unit">SOL</span>
	</p>

	{#if approximate}
		<!--
			Marked as approximate on purpose. The rate is a configured number an
			admin last agreed to, not a live quote, so presenting it as an exact
			value would overstate what the app actually knows.
		-->
		<p class="approx">about {approximate}</p>
	{/if}

	<p class="network" data-live={isLiveNetwork}>
		<span class="dot" aria-hidden="true"></span>
		Solana <span class="cluster">{wallet.network}</span>
		{#if !isLiveNetwork}
			— test network, no real value
		{/if}
	</p>

	{#if showAddress}
		<div class="address">
			<p class="address-label">Your wallet address</p>
			<p class="address-value">{wallet.solana_address}</p>
		</div>
	{/if}
</Panel>

<style>
	.title {
		font-size: var(--k-text-lg);
	}

	.amount {
		margin-top: var(--k-space-3);
		font-size: var(--k-text-3xl);
		font-weight: 600;
		/* Tabular figures so the balance does not shift as digits change. */
		font-variant-numeric: tabular-nums;
	}

	.unit {
		font-size: var(--k-text-lg);
		color: var(--k-text-subtle);
	}

	.approx {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.network {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
		margin-top: var(--k-space-4);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		background-color: var(--k-warning);
	}

	.network[data-live='true'] .dot {
		background-color: var(--k-success);
	}

	.cluster {
		font-family: var(--k-font-mono);
		color: var(--k-text-muted);
	}

	.address {
		margin-top: var(--k-space-4);
		padding-top: var(--k-space-4);
		border-top: var(--k-line-width) solid var(--k-line);
	}

	.address-label {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.address-value {
		margin-top: var(--k-space-1);
		font-family: var(--k-font-mono);
		font-size: var(--k-text-sm);
		overflow-wrap: anywhere;
	}
</style>
