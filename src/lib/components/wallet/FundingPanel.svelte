<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';

	/**
	 * Everything needed to send SOL to one address.
	 *
	 * Shared by `/wallet/fund_wallet`, where a user funds their own wallet, and
	 * by `/admin`, where the operator funds the Main Wallet. The two pages are
	 * the same problem, here is an address, here is how to send to it, and
	 * writing it twice would mean the devnet warning eventually appeared on only
	 * one of them.
	 *
	 * THERE IS NO "FUND" BUTTON ANYWHERE IN KOMMITLY, by design. Nothing in the
	 * app can create SOL; money arrives from a wallet the app has no connection
	 * to. So funding is instructions plus an address, and the only honest thing
	 * the app can offer afterwards is to look at the chain again.
	 */

	interface Props {
		/** Base58 address to display. Shown in full, a truncated address is useless here. */
		address: string;

		/** The cluster, from `PUBLIC_SOLANA_NETWORK`. Named in the warning, because sending on the wrong one is unrecoverable. */
		network: string;

		/** Pre-rendered QR of the address, from `renderQrSvg`, or null if it could not be drawn. */
		qr?: string | null;

		/** Overrides the heading where "Your wallet address" would be wrong. */
		title?: string;

		/** One line under the heading, for whose wallet this is and what it is for. */
		hint?: string | undefined;
	}

	let {
		address,
		network,
		qr = null,
		title = 'Wallet address',
		hint = undefined
	}: Props = $props();

	let copied = $state(false);
	let copyFailed = $state(false);

	async function copyAddress() {
		try {
			await navigator.clipboard.writeText(address);
			copied = true;
			copyFailed = false;

			/** Reverts so the button can be used again without a reload. */
			setTimeout(() => (copied = false), 2000);
		} catch {
			/**
			 * The clipboard API is refused without a user gesture, on insecure
			 * origins, and in some mobile browsers. Saying so lets the user select
			 * the address manually, which is why it is always shown in full.
			 */
			copyFailed = true;
		}
	}
</script>

<Panel>
	<h2 class="title">{title}</h2>
	{#if hint}<p class="hint">{hint}</p>{/if}

	<div class="row">
		{#if qr}
			<!--
				Always on white, whatever the theme. A scanner needs the contrast,
				and `img`-style alt text is supplied by the caption rather than the
				SVG, which is marked decorative, the address beside it is the
				accessible form of the same information.
			-->
			<div class="qr" aria-hidden="true">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html qr}
			</div>
		{/if}

		<div class="details">
			<!--
				Selectable and complete. `user-select: all` makes a double-click
				take the whole address rather than one base58 run.
			-->
			<p class="address">{address}</p>

			<div class="actions">
				<Button type="button" variant="secondary" size="sm" onclick={copyAddress}>
					{copied ? 'Copied' : 'Copy address'}
				</Button>
			</div>

			{#if copyFailed}
				<p class="copy-failed">
					Could not reach the clipboard. Select the address above and copy it
					manually.
				</p>
			{/if}
		</div>
	</div>

	<h3 class="steps-title">How to send {network} SOL</h3>

	<ol class="steps">
		<li>
			<strong>Install Solflare</strong>, a Solana wallet, available as a browser
			extension or a phone app.
		</li>
		<li>
			<strong>Switch it to {network}.</strong> In Solflare this is under Settings,
			then Network. This matters: SOL sent on mainnet will not appear here and
			cannot be recovered.
		</li>
		<li>
			<strong>Get free {network} SOL.</strong> Solflare has a faucet on devnet, or
			use
			<a href="https://faucet.solana.com" rel="noreferrer noopener" target="_blank">
				faucet.solana.com
			</a>
			with the address above.
		</li>
		<li>
			<strong>Send to the address above</strong>, paste it, or scan the code with
			the Solflare app. It usually arrives within a few seconds.
		</li>
		<li><strong>Refresh the balance</strong> to see it here.</li>
	</ol>

	<!--
		The rent minimum catches people out constantly: a first transfer below it
		is rejected by the chain with an error that reads like a bug. Better said
		before they try than explained afterwards.
	-->
	<div class="warning">
		<Alert tone="info">
			Send at least <strong>0.01 SOL</strong> the first time. Solana will not
			create an account holding less than roughly 0.0009 SOL, so a very small
			first transfer is rejected.
		</Alert>
	</div>
</Panel>

<style>
	.title {
		font-size: var(--k-text-lg);
	}

	.hint {
		margin-top: var(--k-space-2);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-4);
		margin-top: var(--k-space-4);
	}

	.qr {
		flex: 0 0 auto;
		width: 9rem;
		padding: var(--k-space-2);
		background-color: #ffffff;
	}

	/* The SVG arrives with its own width; this makes it fill the tile instead. */
	.qr :global(svg) {
		display: block;
		width: 100%;
		height: auto;
	}

	.details {
		flex: 1 1 16rem;
		min-width: 0;
	}

	.address {
		padding: var(--k-space-3);
		background-color: var(--k-surface-sunken);
		font-family: var(--k-font-mono);
		font-size: var(--k-text-sm);
		overflow-wrap: anywhere;
		user-select: all;
	}

	.actions {
		margin-top: var(--k-space-3);
	}

	.copy-failed {
		margin-top: var(--k-space-3);
		color: var(--k-warning);
		font-size: var(--k-text-sm);
	}

	.steps-title {
		margin-top: var(--k-space-5);
		font-size: var(--k-text-sm);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
		color: var(--k-text-subtle);
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
</style>
