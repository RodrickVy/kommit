<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import WalletBalance from '#lib/components/wallet/WalletBalance.svelte';
	import type { PageProps } from './$types';

	/**
	 * Wallet — `/wallet`.
	 */
	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Wallet · kommitly</title>
</svelte:head>

<PageHeader title="Wallet" description="Your kommitly wallet, read live from Solana.">
	{#snippet actions()}
		{#if data.wallet}
			<Button href="/wallet/fund_wallet">Add funds</Button>
		{/if}
	{/snippet}
</PageHeader>

{#if form?.actionError}
	<div class="banner"><Alert tone="error">{form.actionError}</Alert></div>
{/if}

{#if data.loadError}
	<!--
		A failure to reach Solana is NOT a balance of zero. Saying so explicitly
		matters: telling someone their money is gone because a network call
		failed would be the worst answer available.
	-->
	<Alert tone="error">
		{data.loadError} Your funds are unaffected — this is a problem reading the
		balance, not with the wallet itself.
	</Alert>
{:else if !data.wallet}
	<Panel>
		<h2 class="title">No wallet yet</h2>
		<p class="body">
			You need a wallet before you can commit to a meetup. It takes a moment to
			create and starts empty.
		</p>
		<form method="POST" action="?/createWallet" use:enhance class="action">
			<Button type="submit">Create my wallet</Button>
		</form>
	</Panel>
{:else}
	<div class="grid">
		<WalletBalance wallet={data.wallet} />

		<Panel>
			<h2 class="title">Withdraw</h2>
			<p class="body">
				Sending SOL back out to another Solana address is not built yet. It is
				the next piece of wallet work.
			</p>
		</Panel>
	</div>
{/if}

<style>
	.banner {
		margin-bottom: var(--k-space-4);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
		gap: var(--k-space-4);
		align-items: start;
	}

	.title {
		font-size: var(--k-text-lg);
	}

	.body {
		margin-top: var(--k-space-2);
		max-width: 52ch;
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.action {
		margin-top: var(--k-space-5);
	}
</style>
