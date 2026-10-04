<script lang="ts">
	import FeeChart from '#lib/components/stats/FeeChart.svelte';
	import OutcomesChart from '#lib/components/stats/OutcomesChart.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import type { PageProps } from './$types';

	/**
	 * Stats, `/stats`.
	 *
	 * The base commitment fee, read like a ticker: the price now, its last
	 * move, its range, and every change as a bar.
	 */
	let { data }: PageProps = $props();

	const money = (cents: number) =>
		new Intl.NumberFormat('en-CA', { style: 'currency', currency: data.currencyCode }).format(
			cents / 100
		);

	const last = $derived(data.points.at(-1) ?? null);
	const previous = $derived(data.points.at(-2) ?? null);
	const changePercent = $derived(
		last && previous && previous.cents > 0 ? (last.changeCents / previous.cents) * 100 : null
	);
	const high = $derived(data.points.length ? Math.max(...data.points.map((p) => p.cents)) : null);
	const low = $derived(data.points.length ? Math.min(...data.points.map((p) => p.cents)) : null);

	/**
	 * How far market reputation has moved the base fee, as a fraction.
	 * Positive means dearer. Computed in the database by
	 * `market_fee_adjustment()` and only read here.
	 */
	const marketAdjustment = $derived(Number(data.market?.market_adjustment ?? 0));
</script>

<svelte:head>
	<title>Stats · kommitly</title>
</svelte:head>

<PageHeader
	title="Stats"
	description="What the marketplace currently costs, and why. Your own stake is this base, adjusted by your reputation."
/>

{#if data.market}
	<!--
		The two headline figures, side by side, because one explains the other:
		the market's average reliability is the reason the base fee is where it
		is. Shown above the chart so the current state is readable before
		anyone interprets a trend.
	-->
	<div class="headline">
		<Panel tone="raised">
			<span class="headline-label">Market reputation</span>
			<span class="headline-value">{Number(data.market.market_reputation).toFixed(3)}</span>
			<p class="headline-note">
				The average across {data.market.scored_profiles}
				{data.market.scored_profiles === 1 ? 'member' : 'members'}.
				<strong>1.000</strong> is neutral
				{#if marketAdjustment > 0}
					&mdash; below it, so stakes are raised.
				{:else if marketAdjustment < 0}
					&mdash; above it, so stakes are reduced.
				{:else}
					&mdash; exactly where the market is, so the base fee is unchanged.
				{/if}
			</p>
		</Panel>

		<Panel tone="raised">
			<span class="headline-label">Commitment fee now</span>
			<span class="headline-value">{money(Number(data.market.adjusted_base_fee_cents))}</span>
			<p class="headline-note">
				{money(Number(data.market.base_fee_cents))} base
				{#if marketAdjustment !== 0}
					<span class="delta" data-direction={marketAdjustment > 0 ? 'up' : 'down'}>
						{marketAdjustment > 0 ? '+' : '&minus;'}{Math.abs(marketAdjustment * 100).toFixed(2)}%
					</span>
					from market reputation.
				{:else}
					with no market adjustment.
				{/if}
				What a member of exactly average reliability puts down.
			</p>
		</Panel>
	</div>
{/if}

{#if data.loadError}
	<Alert tone="error">{data.loadError}</Alert>
{:else}
	<div class="charts">
	<Panel>
		<div class="ticker">
			<div class="price">
				<span class="ticker-label">Base commitment fee</span>
				<span class="price-value">
					{data.currentCents === null ? 'Unknown' : money(data.currentCents)}
					<span class="currency">{data.currencyCode}</span>
				</span>
				{#if last && previous}
					<span class="move" data-direction={last.direction}>
						{last.changeCents > 0 ? '▲ +' : '▼ −'}{money(Math.abs(last.changeCents))}
						{#if changePercent !== null}
							({changePercent > 0 ? '+' : ''}{changePercent.toFixed(1)}%)
						{/if}
						<span class="move-note">last change</span>
					</span>
				{/if}
			</div>

			<dl class="facts">
				<div>
					<dt>High</dt>
					<dd>{high === null ? 'None' : money(high)}</dd>
				</div>
				<div>
					<dt>Low</dt>
					<dd>{low === null ? 'None' : money(low)}</dd>
				</div>
				<div>
					<dt>Changes</dt>
					<dd>{data.points.length}</dd>
				</div>
			</dl>
		</div>

		{#if data.points.length === 0}
			<p class="empty">No changes recorded yet.</p>
		{:else}
			<FeeChart hourly={data.hourly} currencyCode={data.currencyCode} />
			<p class="legend">
				<span class="swatch line" aria-hidden="true"></span> Base fee, hourly
				<span class="swatch up" aria-hidden="true"></span> Went up
				<span class="swatch down" aria-hidden="true"></span> Went down
			</p>
		{/if}
	</Panel>

	<!-- Beside the fee chart on a wide screen, beneath it on a phone. -->
	<Panel>
		<h2 class="side-title">How commitments ended</h2>
		{#if data.outcomes.length === 0}
			<p class="empty">No commitments yet. This fills in as meetups happen.</p>
		{:else}
			<OutcomesChart slices={data.outcomes} />
		{/if}
	</Panel>
	</div>
{/if}

<style>
	/* Two headline figures, stacking on a phone. They answer "what does this
	   cost right now, and why" before the chart asks anyone to read a trend. */
	.headline {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--k-space-3);
		margin-bottom: var(--k-space-4);
	}

	@media (min-width: 40rem) {
		.headline {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.headline-label {
		display: block;
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.headline-value {
		display: block;
		margin-top: var(--k-space-1);
		font-size: var(--k-text-2xl);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.headline-note {
		margin-top: var(--k-space-3);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	/* Direction is carried by the sign in the text as well as the colour. */
	.delta[data-direction='up'] {
		color: var(--k-danger);
		font-weight: 600;
	}

	.delta[data-direction='down'] {
		color: var(--k-primary);
		font-weight: 600;
	}

	.charts {
		display: grid;
		gap: var(--k-space-4);
		align-items: start;
	}

	/* Grid items default to their content's width; this lets each panel (and
	   the canvas inside it) shrink to the screen instead of overflowing it. */
	.charts > :global(*) {
		min-width: 0;
	}

	/* The fee chart keeps the larger share; the donut sits to its right. */
	@media (min-width: 64rem) {
		.charts {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		}
	}

	.side-title {
		margin-bottom: var(--k-space-4);
		font-size: var(--k-text-lg);
	}

	.ticker {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--k-space-4);
		margin-bottom: var(--k-space-4);
	}

	.price {
		display: grid;
		gap: var(--k-space-1);
	}

	.ticker-label,
	.facts dt {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		letter-spacing: var(--k-tracking-wide);
		text-transform: uppercase;
	}

	.price-value {
		font-size: var(--k-text-3xl);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	.currency {
		color: var(--k-text-subtle);
		font-size: var(--k-text-base);
		font-weight: 500;
	}

	.move {
		font-size: var(--k-text-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.move[data-direction='up'] {
		color: var(--k-success);
	}

	.move[data-direction='down'] {
		color: var(--k-danger);
	}

	.move-note {
		margin-left: var(--k-space-1);
		color: var(--k-text-subtle);
		font-weight: 400;
	}

	.facts {
		display: flex;
		gap: var(--k-space-5);
		margin: 0;
	}

	.facts div {
		display: grid;
		gap: var(--k-space-1);
	}

	.facts dd {
		margin: 0;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.empty {
		color: var(--k-text-muted);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
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

	.legend .swatch:not(:first-child) {
		margin-left: var(--k-space-3);
	}

	.swatch.line {
		height: 3px;
		background-color: var(--k-chart-line);
	}

	.swatch.up {
		border-radius: 50%;
		background-color: var(--k-chart-up);
	}

	.swatch.down {
		border-radius: 50%;
		background-color: var(--k-chart-down);
	}
</style>
