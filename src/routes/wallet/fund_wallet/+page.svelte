<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import WalletBalance from '#lib/components/wallet/WalletBalance.svelte';
	import type { PageProps } from './$types';

	/**
	 * Fund wallet — `/wallet/fund_wallet`.
	 */
	let { data }: PageProps = $props();

	let copied = $state(false);
	let refreshing = $state(false);
	let copyFailed = $state(false);

	async function copyAddress() {
		if (!data.wallet) return;

		try {
			await navigator.clipboard.writeText(data.wallet.solana_address);
			copied = true;
			copyFailed = false;

			/** Reverts so the button can be used again without a reload. */
			setTimeout(() => (copied = false), 2000);
		} catch {
			/**
			 * The clipboard API is refused without a user gesture, on insecure
			 * origins, and in some mobile browsers. Saying so lets the user select
			 * the address manually, which is still shown in full below.
			 */
			copyFailed = true;
		}
	}

	async function refresh() {
		refreshing = true;
		/** Re-runs the load, which calls query_wallet and re-reads the chain. */
		await invalidateAll();
		refreshing = false;
	}
</script>

<svelte:head>
	<title>Add funds · kommitly</title>
</svelte:head>

<div class="narrow">
	<PageHeader
		title="Add funds"
		description="Your wallet is ready but empty. Send it some devnet SOL to start committing to meetups."
	/>

	{#if data.loadError}
		<Alert tone="error">{data.loadError}</Alert>
	{:else if data.wallet}
		<div class="stack">
			<WalletBalance wallet={data.wallet} />

			<Panel>
				<h2 class="title">Your wallet address</h2>
				<p class="hint">Send SOL here. Only ever send on the {data.wallet.network} network.</p>

				<!--
					Shown in full and selectable, not truncated. A partially displayed
					address is useless for the one thing this page exists for, and
					copying is not always available.
				-->
				<p class="address">{data.wallet.solana_address}</p>

				<div class="row">
					<Button type="button" variant="secondary" onclick={copyAddress}>
						{copied ? 'Copied' : 'Copy address'}
					</Button>
					<Button type="button" variant="quiet" onclick={refresh} disabled={refreshing}>
						{refreshing ? 'Checking…' : 'Refresh balance'}
					</Button>
				</div>

				{#if copyFailed}
					<p class="copy-failed">
						Could not reach the clipboard. Select the address above and copy it
						manually.
					</p>
				{/if}
			</Panel>

			<Panel>
				<h2 class="title">How to send devnet SOL</h2>

				<ol class="steps">
					<li>
						<strong>Install Solflare</strong> — a Solana wallet, available as a
						browser extension or a phone app.
					</li>
					<li>
						<strong>Switch it to {data.wallet.network}.</strong> In Solflare this
						is under Settings, then Network. This matters: SOL sent on mainnet
						will not appear here, and cannot be recovered.
					</li>
					<li>
						<strong>Get free devnet SOL.</strong> Solflare has a faucet on devnet,
						or use <a href="https://faucet.solana.com" rel="noreferrer noopener" target="_blank">faucet.solana.com</a>
						with the address above.
					</li>
					<li>
						<strong>Send it to your address.</strong> Paste the address above into
						Solflare and send. It usually arrives within a few seconds.
					</li>
					<li><strong>Press Refresh balance</strong> to see it here.</li>
				</ol>

				<!--
					The rent minimum catches people out constantly: a first transfer
					below it is rejected by the chain, with an error that reads like a
					bug. Better to say so before they try.
				-->
				<div class="warning">
					<Alert tone="info">
						Send at least <strong>0.01 SOL</strong> the first time. Solana will not
						create an account holding less than roughly 0.0009 SOL, so a very
						small first transfer is rejected.
					</Alert>
				</div>
			</Panel>

			<div class="done">
				<Button href="/">I have sent some funds</Button>
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

	.title {
		font-size: var(--k-text-lg);
	}

	.hint {
		margin-top: var(--k-space-2);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.address {
		margin-top: var(--k-space-3);
		padding: var(--k-space-3);
		background-color: var(--k-surface-sunken);
		font-family: var(--k-font-mono);
		font-size: var(--k-text-sm);
		overflow-wrap: anywhere;
		/* Makes a double-click select the whole address rather than one segment. */
		user-select: all;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
		margin-top: var(--k-space-4);
	}

	.copy-failed {
		margin-top: var(--k-space-3);
		color: var(--k-warning);
		font-size: var(--k-text-sm);
	}

	.steps {
		display: grid;
		gap: var(--k-space-3);
		margin-top: var(--k-space-3);
		padding-left: var(--k-space-5);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.warning {
		margin-top: var(--k-space-5);
	}

	.done {
		margin-top: var(--k-space-2);
	}
</style>
