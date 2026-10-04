<script lang="ts">
	import Panel from '#lib/components/ui/Panel.svelte';
	import { explorerTxUrl } from '#lib/solana/explorer';
	import type { ActivityItem } from '#lib/server/solana/activity';

	/**
	 * WalletActivity, everything this wallet has done, newest first.
	 *
	 * Money in is green, money out is red. Each row links to its public
	 * receipt on Solana Explorer, and to the commitment it belongs to.
	 */
	interface Props {
		/** Streamed from the load function; null means Solana could not be reached. */
		activity: Promise<ActivityItem[] | null>;
		/** For the approximate dollar figure beside each amount. */
		solPriceCents: number | null;
		currencyCode: string | null;
	}

	let { activity, solPriceCents, currencyCode }: Props = $props();

	function sol(lamports: number): string {
		const sign = lamports > 0 ? '+' : lamports < 0 ? '−' : '';
		return `${sign}${(Math.abs(lamports) / 1e9).toFixed(4)} SOL`;
	}

	function fiat(lamports: number): string | null {
		if (solPriceCents === null || currencyCode === null) return null;
		const cents = (Math.abs(lamports) / 1e9) * solPriceCents;
		return new Intl.NumberFormat('en-CA', { style: 'currency', currency: currencyCode }).format(
			cents / 100
		);
	}

	function when(iso: string | null): string {
		if (!iso) return 'Time unknown';
		return new Intl.DateTimeFormat('en-CA', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(iso));
	}
</script>

<Panel>
	<h2 class="title">Activity</h2>

	{#await activity}
		<p class="muted">Loading activity from Solana…</p>
	{:then items}
		{#if items === null}
			<p class="muted">
				Solana could not be reached, so your activity cannot be shown right now. Try
				Refresh.
			</p>
		{:else if items.length === 0}
			<p class="muted">No activity yet. Deposits, stakes and payments will appear here.</p>
		{:else}
			<ul class="rows" role="list">
				{#each items as item (item.signature)}
					{@const direction = item.failed ? 'failed' : item.lamports >= 0 ? 'in' : 'out'}
					<li class="row" data-direction={direction}>
						<div class="main">
							<span class="label">
								{item.label}
								{#if item.failed}<span class="failed-tag">Failed</span>{/if}
							</span>
							<span class="meta">
								{when(item.at)}
								·
								<a href={explorerTxUrl(item.signature)} target="_blank" rel="noopener noreferrer">
									Receipt ↗
								</a>
								{#if item.commitmentId}
									· <a href="/commitment/{item.commitmentId}">Commitment</a>
								{/if}
							</span>
						</div>
						<div class="amount">
							<span class="sol">{sol(item.lamports)}</span>
							{#if fiat(item.lamports)}
								<span class="fiat">about {fiat(item.lamports)}</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
			<p class="legend">
				<span class="swatch in" aria-hidden="true"></span> Money in
				<span class="swatch out" aria-hidden="true"></span> Money out
			</p>
		{/if}
	{/await}
</Panel>

<style>
	.title {
		font-size: var(--k-text-lg);
		margin-bottom: var(--k-space-3);
	}

	.muted {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.rows {
		display: grid;
		gap: var(--k-space-1);
		margin: 0;
	}

	/* The colour is backed by a sign on the amount and an edge marker, so the
	   direction never depends on colour alone. */
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--k-space-3);
		padding: var(--k-space-3);
		background-color: var(--k-surface-raised);
		box-shadow: inset 3px 0 0 0 var(--k-line);
	}

	.row[data-direction='in'] {
		box-shadow: inset 3px 0 0 0 var(--k-success);
	}

	.row[data-direction='out'] {
		box-shadow: inset 3px 0 0 0 var(--k-danger);
	}

	.main {
		display: grid;
		gap: var(--k-space-1);
		min-width: 0;
	}

	.label {
		font-size: var(--k-text-sm);
		font-weight: 600;
	}

	.failed-tag {
		margin-left: var(--k-space-2);
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		font-weight: 400;
		text-transform: uppercase;
	}

	.meta {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
	}

	.amount {
		display: grid;
		flex-shrink: 0;
		justify-items: end;
		gap: var(--k-space-1);
		text-align: right;
	}

	.sol {
		font-family: var(--k-font-mono);
		font-size: var(--k-text-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.row[data-direction='in'] .sol {
		color: var(--k-success);
	}

	.row[data-direction='out'] .sol {
		color: var(--k-danger);
	}

	.row[data-direction='failed'] .sol {
		color: var(--k-text-subtle);
		text-decoration: line-through;
	}

	.fiat {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
	}

	.legend {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
		margin-top: var(--k-space-3);
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
	}

	.swatch {
		width: 0.625rem;
		height: 0.625rem;
	}

	.swatch.in {
		background-color: var(--k-success);
	}

	.swatch.out {
		margin-left: var(--k-space-3);
		background-color: var(--k-danger);
	}
</style>
