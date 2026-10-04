<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import RefreshButton from '#lib/components/wallet/RefreshButton.svelte';
	import { formatPrice, formatSol } from '#lib/format';
	import type { PageProps } from './$types';

	/**
	 * Purchase — `/commitment/[commitment_id]/pay`.
	 *
	 * Where QR #2 lands. Separate from the meetup in every respect: the
	 * commitment is already fulfilled, both stakes are already back, and
	 * nothing here is owed. Buying is a choice, and the page is written so that
	 * closing the tab is an obvious and complete option.
	 */
	let { data, form }: PageProps = $props();

	let paying = $state(false);

	const q = $derived(data.quote);
</script>

<svelte:head>
	<title>Pay · kommitly</title>
</svelte:head>

<div class="narrow">
	<PageHeader title="Buy this item">
		{#snippet actions()}
			<RefreshButton label="Refresh balance" />
		{/snippet}
	</PageHeader>

	{#if form?.actionError}
		<div class="banner">
			<Alert tone="error">{form.actionError}</Alert>
			{#if form.needsFunds}
				<div class="fund">
					<Button href="/wallet/fund_wallet" variant="secondary" size="sm">Add funds</Button>
					<p class="fund-note">
						Nothing was charged, and your commitment is unaffected — it is already
						complete and your stake is back. Add funds and try again, or walk
						away.
					</p>
				</div>
			{/if}
		</div>
	{/if}

	{#if data.outcome === 'paid' && data.payment}
		<Panel tone="raised">
			<h2 class="title">Paid</h2>
			<p class="lead">
				{formatPrice(data.payment.amount_cents)}
				({formatSol(data.payment.amount_lamports)}) went straight to the seller.
				{data.listingTitle ?? 'The item'} is yours.
			</p>

			{#if data.payment.solana_signature}
				<p class="muted">
					Transaction <span class="mono">{data.payment.solana_signature}</span>
				</p>
			{/if}

			<div class="actions">
				<Button href="/commitment/{data.commitmentId}">Back to the commitment</Button>
			</div>
		</Panel>
	{:else if data.outcome === 'ready' && q}
		<Panel>
			<h2 class="title">{q.listing_title}</h2>

			<p class="price">{formatPrice(q.amount_cents)}</p>
			<p class="price-sol">{formatSol(q.amount_lamports)}</p>

			<!--
				The rate and its source are both shown. A buyer agreed to a dollar
				price, and the SOL figure is a conversion made at this moment — so
				the page says what it converted at rather than presenting the result
				as if it were the price itself.
			-->
			<p class="rate">
				Converted at {formatPrice(q.sol_price_cents)} per SOL
				{#if q.rate_source === 'coingecko'}
					(live rate)
				{:else}
					(the configured rate — a live quote was unavailable)
				{/if}
			</p>

			<dl class="pairs">
				<div class="pair">
					<dt>Your wallet</dt>
					<dd>
						{#if q.balance_lamports === null}
							<!--
								Unknown, not empty. Telling someone they have nothing because
								an RPC call timed out would send them to top up a funded
								wallet.
							-->
							Could not be read just now
						{:else}
							{formatSol(q.balance_lamports)}
						{/if}
					</dd>
				</div>
				<div class="pair">
					<dt>Network fee</dt>
					<dd>{formatSol(q.fee_lamports)}</dd>
				</div>
			</dl>

			{#if q.sufficient === false}
				<div class="banner">
					<Alert tone="error">
						Not enough SOL in your wallet for this purchase and the network fee.
					</Alert>
					<div class="fund">
						<Button href="/wallet/fund_wallet" variant="secondary" size="sm">Add funds</Button>
					</div>
				</div>
			{/if}

			<!--
				Said plainly beside the button. Someone standing in front of a seller
				should know that not buying is a complete and penalty-free outcome.
			-->
			<div class="banner">
				<Alert tone="info">
					Your commitment is already complete and your stake is back. Buying is
					optional — you can close this page and owe nothing.
				</Alert>
			</div>

			<form
				method="POST"
				action="?/pay"
				use:enhance={() => {
					paying = true;

					return async ({ update }) => {
						await update();
						paying = false;
					};
				}}
			>
				<input type="hidden" name="token" value={data.token} />

				<div class="actions">
					<!--
						The amount is in the label. A button reading "Pay" relies on the
						person having read the figure above it; this one cannot be pressed
						without seeing what it costs.
					-->
					<Button type="submit" disabled={paying || q.sufficient === false}>
						{paying ? 'Paying…' : `Pay ${formatSol(q.amount_lamports)}`}
					</Button>
					<Button href="/commitment/{data.commitmentId}" variant="quiet">
						Not now
					</Button>
				</div>
			</form>
		</Panel>
	{:else}
		<Panel>
			<h2 class="title">{data.problemTitle}</h2>
			<p class="lead">{data.problem}</p>

			<div class="actions">
				<Button href="/commitment/{data.commitmentId}" variant="secondary">
					Back to the commitment
				</Button>
			</div>
		</Panel>
	{/if}
</div>

<style>
	.narrow {
		max-width: 34rem;
	}

	.banner {
		margin: var(--k-space-4) 0;
	}

	.fund {
		margin-top: var(--k-space-3);
	}

	.fund-note {
		margin-top: var(--k-space-2);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.title {
		font-size: var(--k-text-lg);
	}

	.lead {
		margin-top: var(--k-space-3);
		font-size: var(--k-text-sm);
	}

	.price {
		margin-top: var(--k-space-4);
		font-size: var(--k-text-2xl);
		font-weight: 600;
	}

	.price-sol {
		margin-top: var(--k-space-1);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
		font-variant-numeric: tabular-nums;
	}

	.rate {
		margin-top: var(--k-space-2);
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
	}

	.pairs {
		display: grid;
		gap: var(--k-space-3);
		margin-top: var(--k-space-4);
	}

	@media (min-width: 30rem) {
		.pairs {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.pair {
		display: grid;
		gap: var(--k-space-1);
	}

	.pair dt {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.pair dd {
		margin: 0;
		font-size: var(--k-text-sm);
		font-variant-numeric: tabular-nums;
	}

	.muted {
		margin-top: var(--k-space-3);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.mono {
		font-family: var(--k-font-mono);
		font-size: var(--k-text-xs);
		overflow-wrap: anywhere;
		user-select: all;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--k-space-2);
		margin-top: var(--k-space-5);
	}
</style>
