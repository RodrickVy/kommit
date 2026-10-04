<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import FundingPanel from '#lib/components/wallet/FundingPanel.svelte';
	import WalletBalance from '#lib/components/wallet/WalletBalance.svelte';
	import type { PageProps } from './$types';

	/**
	 * Fund wallet — `/wallet/fund_wallet`.
	 *
	 * The address, a QR of it, and how to send to it. `FundingPanel` carries all
	 * three and is shared with /admin, where the operator funds the Main Wallet:
	 * same problem, same instructions, one copy of the devnet warning.
	 */
	let { data }: PageProps = $props();

</script>

<svelte:head>
	<title>Add funds · kommitly</title>
</svelte:head>

<div class="narrow">
	<PageHeader
		title="Add funds"
		description="Send devnet SOL to your wallet address to start committing to meetups."
	/>

	{#if data.loadError}
		<Alert tone="error">{data.loadError}</Alert>
	{:else if data.wallet}
		<div class="stack">
			<WalletBalance wallet={data.wallet} />

			<FundingPanel
				address={data.wallet.solana_address}
				network={data.wallet.network}
				qr={data.qr}
				title="Your wallet address"
				hint="Only ever send on the {data.wallet.network} network."
			/>

			<div class="done">
				<Button href="/">Done</Button>
			</div>
		</div>
	{/if}
</div>

<style>
	.narrow {
		max-width: 40rem;
	}

	.stack {
		display: grid;
		gap: var(--k-space-4);
	}

	.done {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
	}
</style>
