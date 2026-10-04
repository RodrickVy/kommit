<script lang="ts">
	import { navigating } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import OutcomesChart from '#lib/components/stats/OutcomesChart.svelte';
	import TimeSeriesChart from '#lib/components/stats/TimeSeriesChart.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import { formatSol, lamportsToCents } from '#lib/format';
	import { BUCKET_TABS, STATS_BUCKETS } from '#lib/stats/buckets';
	import type { PageProps } from './$types';

	/**
	 * Stats, `/stats`.
	 *
	 * The marketplace read like a price: what a commitment costs, the average
	 * reliability that sets it, and where forfeited stakes went.
	 *
	 * GRANULARITY LIVES IN THE URL. The selector is `TabBar`, the same
	 * component Discover and Commitments filter with, which renders real links.
	 * So a view is shareable, survives a reload, and works without JavaScript —
	 * and SvelteKit's client navigation means changing it re-runs only this
	 * page's load, not a full page fetch.
	 */
	let { data }: PageProps = $props();

	const money = (cents: number) =>
		new Intl.NumberFormat('en-CA', {
			style: 'currency',
			currency: data.currencyCode,
			maximumFractionDigits: cents % 100 === 0 ? 0 : 2
		}).format(cents / 100);

	/**
	 * True while the load for a new granularity is in flight.
	 *
	 * The charts stay on screen and dim rather than being replaced by a
	 * spinner: the previous series is still the truth until the new one
	 * arrives, and swapping a drawn chart for a loading state makes a quick
	 * change feel slower than it is.
	 */
	const loading = $derived(navigating.to !== null);

	const move = $derived(
		data.latestCents !== null && data.openCents !== null
			? data.latestCents - data.openCents
			: null
	);

	const movePercent = $derived(
		move !== null && data.openCents ? (move / data.openCents) * 100 : null
	);

	const marketAdjustment = $derived(Number(data.market?.market_adjustment ?? 0));

	/** Rows for the price chart: the fee, with reputation as the second series. */
	const priceRows = $derived(
		data.price.map((row) => ({
			at: row.bucket_at,
			value: row.close_fee_cents === null ? null : Number(row.close_fee_cents),
			secondary: row.close_reputation === null ? null : Number(row.close_reputation),
			active: row.event_count > 0
		}))
	);

	const donationRows = $derived(
		data.donations.map((row) => ({
			at: row.bucket_at,
			value: Number(row.lamports),
			active: Number(row.donation_count) > 0
		}))
	);

	const donatedTotal = $derived(
		data.donations.length ? Number(data.donations.at(-1)?.cumulative_lamports ?? 0) : 0
	);

	/**
	 * Donations in money, not lamports. Nobody thinks about a forfeited stake
	 * in SOL — it was quoted in dollars when it was taken.
	 *
	 * Falls back to SOL when no rate is configured, rather than showing a
	 * currency figure derived from a missing number.
	 */
	const donated = $derived((lamports: number) =>
		data.solPriceCents === null
			? formatSol(lamports)
			: money(lamportsToCents(lamports, data.solPriceCents))
	);

	/**
	 * A padded range around the values present, never anchored to zero.
	 *
	 * A number axis defaults to including zero, which is right for a quantity
	 * and wrong for a price: a fee moving between $13.80 and $13.90 on a
	 * $0-based axis is a flat line pinned to the top, and the movement the
	 * chart exists to show disappears.
	 *
	 * `anchor` is kept inside the range even when no value is near it, so a
	 * meaningful threshold stays visible instead of the axis silently
	 * re-centring. For reputation that is 1.000, the neutral point.
	 */
	function paddedRange(values: number[], anchor: number | null, fallback: { min: number; max: number }) {
		if (values.length === 0) return fallback;

		const low = anchor === null ? Math.min(...values) : Math.min(anchor, ...values);
		const high = anchor === null ? Math.max(...values) : Math.max(anchor, ...values);

		/** A flat series still needs height, hence the floor on the padding. */
		const pad = Math.max((high - low) * 0.25, Math.abs(high) * 0.02, 0.01);

		return { min: low - pad, max: high + pad };
	}

	const priceScale = $derived(
		paddedRange(
			priceRows.map((row) => row.value).filter((value): value is number => value !== null),
			null,
			{ min: 0, max: 100 }
		)
	);

	/**
	 * Reputation sits on its own axis, scaled to the data rather than to zero:
	 * the scores live in a narrow band around 1.000, and a zero-based axis
	 * would flatten every movement into a straight line.
	 *
	 * 1.000 is always inside the range, even when no score is near it, so
	 * "above or below neutral" stays readable instead of the axis silently
	 * re-centring.
	 */
	const reputationScale = $derived(
		paddedRange(
			priceRows.map((row) => row.secondary).filter((value): value is number => value !== null),
			1,
			{ min: 0.9, max: 1.3 }
		)
	);

	/**
	 * Auto-refresh, for the granularities where it means anything.
	 *
	 * The price now moves in real time, so a chart of seconds that never
	 * updates is misleading in a way a chart of weeks is not. Off for days and
	 * weeks, where a refresh could not change the picture.
	 */
	const LIVE_INTERVAL: Partial<Record<keyof typeof STATS_BUCKETS, number>> = {
		second: 5_000,
		minute: 15_000,
		hour: 60_000
	};

	const liveInterval = $derived(LIVE_INTERVAL[data.bucket] ?? null);

	let live = $state(true);

	$effect(() => {
		if (!live || liveInterval === null) return;

		const timer = setInterval(() => {
			/** Skipped while a navigation is already running, to avoid piling up loads. */
			if (navigating.to === null) void invalidateAll();
		}, liveInterval);

		return () => clearInterval(timer);
	});
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
		The two headline figures side by side, because one explains the other:
		the market's average reliability is the reason the fee is where it is.
		Above the chart, so the current state is readable before anyone
		interprets a trend.
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
						{marketAdjustment > 0 ? '+' : '−'}{Math.abs(marketAdjustment * 100).toFixed(2)}%
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
	<div class="controls">
		<!--
			Real links, so a granularity is a URL. `reset` is empty because this
			page has no other parameters to clear.
		-->
		<TabBar
			param="bucket"
			tabs={BUCKET_TABS}
			active={data.bucket}
			label="Chart granularity"
			variant="secondary"
			reset={[]}
		/>

		<div class="live">
			{#if liveInterval !== null}
				<!--
					Only offered where it could change the picture. A chart of weeks
					cannot move in the next minute, so a live toggle there would be
					a control that does nothing.
				-->
				<label class="live-toggle">
					<input type="checkbox" bind:checked={live} />
					<span>Live</span>
				</label>
			{/if}
			<Button type="button" variant="quiet" size="sm" onclick={() => invalidateAll()}>
				Refresh
			</Button>
		</div>
	</div>

	<div class="stack" class:loading aria-busy={loading}>
		<Panel padding="none">
			<div class="chart-head">
				<div>
					<h2 class="chart-title">Commitment fee</h2>
					<p class="chart-sub">
						What an average member puts down, against the market reputation that sets it.
					</p>
				</div>

				{#if data.latestCents !== null}
					<div class="ticker">
						<span class="ticker-value">{money(data.latestCents)}</span>
						{#if move !== null && move !== 0}
							<span class="delta" data-direction={move > 0 ? 'up' : 'down'}>
								{move > 0 ? '▲ +' : '▼ −'}{money(Math.abs(move))}
								{#if movePercent !== null}
									({movePercent > 0 ? '+' : ''}{movePercent.toFixed(1)}%)
								{/if}
							</span>
						{:else}
							<span class="delta" data-direction="flat">unchanged</span>
						{/if}
						<span class="ticker-note">
							over {STATS_BUCKETS[data.bucket].label.toLowerCase()} shown
							{#if data.highCents !== null && data.lowCents !== null}
								· {money(data.lowCents)}–{money(data.highCents)}
							{/if}
							· {data.eventCount}
							{data.eventCount === 1 ? 'commitment event' : 'commitment events'}
						</span>
					</div>
				{/if}
			</div>

			<TimeSeriesChart
				rows={priceRows}
				bucket={data.bucket}
				primary={{
					name: 'Commitment fee',
					tone: 'price',
					format: money,
					min: priceScale.min,
					max: priceScale.max
				}}
				secondary={{
					name: 'Market reputation',
					tone: 'reputation',
					format: (value) => value.toFixed(3),
					min: reputationScale.min,
					max: reputationScale.max
				}}
				height="22rem"
			/>
		</Panel>

		<Panel padding="none">
			<div class="chart-head">
				<div>
					<h2 class="chart-title">Charity donations</h2>
					<p class="chart-sub">
						Forfeited stakes, on the same buckets as the fee above. A bar here is a
						commitment somebody broke.
					</p>
				</div>
				<div class="ticker">
					<span class="ticker-value">{donated(donatedTotal)}</span>
					<span class="ticker-note">
						donated over the period shown
						{#if data.solPriceCents !== null}
							· at {money(data.solPriceCents)} per SOL
						{/if}
					</span>
				</div>
			</div>

			<!--
				Bars, not a line, and no carry-forward: a bucket with no donations
				really did receive nothing. A line would draw donations between the
				bars that never happened.
			-->
			<TimeSeriesChart
				rows={donationRows}
				bucket={data.bucket}
				kind="bar"
				primary={{ name: 'Donated', tone: 'donation', format: donated, min: 0 }}
				height="14rem"
			/>
		</Panel>

		{#if data.outcomes.length > 0}
			<Panel>
				<h2 class="chart-title">How commitments ended</h2>
				<p class="chart-sub">Every commitment to date, by outcome.</p>
				<OutcomesChart slices={data.outcomes} />
			</Panel>
		{/if}
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

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--k-space-3);
		margin-bottom: var(--k-space-3);
	}

	.live {
		display: flex;
		align-items: center;
		gap: var(--k-space-3);
	}

	.live-toggle {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.live-toggle input {
		width: auto;
	}

	.stack {
		display: grid;
		/* `minmax(0, 1fr)`, not `1fr`. A grid track sized `1fr` still refuses
		   to shrink below its content's min-content width, and a drawn canvas
		   reports an intrinsic width — so on a phone the panels pushed the page
		   13px wider than the viewport and the whole document scrolled
		   sideways. */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--k-space-4);
	}

	/* `:global`, and it is not optional. These children are component roots
	   (`Panel`), whose elements carry THAT component's scope hash rather than
	   this page's — so a plain `.stack > *` compiles to a selector that
	   matches nothing and fails silently. */
	.stack > :global(*) {
		min-width: 0;
	}

	/* The previous series stays visible and dims while the next one loads. It
	   is still the truth until the new data arrives, and replacing a drawn
	   chart with a spinner makes a quick change feel slower than it is. */
	.loading {
		opacity: 0.55;
		transition: opacity var(--k-duration-fast) var(--k-ease);
	}

	.chart-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--k-space-3);
		padding: var(--k-space-4) var(--k-space-4) var(--k-space-3);
	}

	.chart-title {
		font-size: var(--k-text-lg);
	}

	.chart-sub {
		margin-top: var(--k-space-1);
		max-width: 40ch;
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.ticker {
		display: grid;
		justify-items: end;
		gap: var(--k-space-1);
		margin-left: auto;
	}

	.ticker-value {
		font-size: var(--k-text-2xl);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.ticker-note {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-align: right;
	}

	/* Direction is carried by the arrow and sign as well as the colour, so it
	   survives for anyone who cannot tell the two hues apart. */
	.delta {
		font-size: var(--k-text-sm);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.delta[data-direction='up'] {
		color: var(--k-danger);
	}

	.delta[data-direction='down'] {
		color: var(--k-primary);
	}

	.delta[data-direction='flat'] {
		color: var(--k-text-subtle);
		font-weight: 400;
	}
</style>
