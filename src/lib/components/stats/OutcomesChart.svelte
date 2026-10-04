<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * OutcomesChart, how commitments have ended, as a donut.
	 *
	 * AG Charts Community (free) donut series, styled to match the fee chart:
	 * black background, Solana colours. A donut rather than bars because these
	 * are parts of one whole, every commitment ends in exactly one of them.
	 * The total sits in the hole.
	 */
	interface Slice {
		label: string;
		total: number;
		/** Design token holding this slice's colour. */
		colour: string;
	}

	interface Props {
		slices: readonly Slice[];
	}

	let { slices }: Props = $props();

	let container = $state<HTMLDivElement>();

	const total = $derived(slices.reduce((sum, slice) => sum + slice.total, 0));

	onMount(() => {
		let chart: { destroy(): void } | null = null;
		let cancelled = false;

		import('ag-charts-community').then(
			({ AgCharts, ModuleRegistry, PolarChartModule, DonutSeriesModule }) => {
				if (cancelled || !container) return;

				ModuleRegistry.registerModules([PolarChartModule, DonutSeriesModule]);

				const token = (name: string) =>
					getComputedStyle(document.documentElement).getPropertyValue(name).trim();

				const data = slices.map((slice) => ({ label: slice.label, total: slice.total }));

				chart = AgCharts.create({
					container,
					data,
					background: { visible: false },
					padding: { top: 8, right: 8, bottom: 8, left: 8 },
					legend: { enabled: false },
					series: [
						{
							type: 'donut',
							angleKey: 'total',
							legendItemKey: 'label',
							innerRadiusRatio: 0.68,
							fills: slices.map((slice) => token(slice.colour)),
							strokes: slices.map(() => '#000000'),
							strokeWidth: 2,
							innerLabels: [
								{ text: String(total), color: '#ffffff', fontSize: 28, fontWeight: 'bold' },
								{ text: total === 1 ? 'commitment' : 'commitments', color: token('--k-chart-text'), fontSize: 12 }
							],
							tooltip: {
								renderer: ({ datum }) => ({
									heading: datum.label,
									data: [
										{
											label: 'Commitments',
											value: `${datum.total} (${((datum.total / total) * 100).toFixed(0)}%)`
										}
									]
								})
							}
						}
					]
				});
			}
		);

		return () => {
			cancelled = true;
			chart?.destroy();
		};
	});
</script>

<div class="frame k-cut">
	<div class="chart" bind:this={container} role="img" aria-label="Donut chart of how commitments ended"></div>
</div>

<!-- The legend is HTML, so it wraps cleanly and reads with a screen reader. -->
<ul class="legend" role="list">
	{#each slices as slice (slice.label)}
		<li>
			<span class="swatch" style:background-color="var({slice.colour})" aria-hidden="true"></span>
			<span class="name">{slice.label}</span>
			<span class="count">{slice.total}</span>
		</li>
	{/each}
</ul>

<style>
	.frame {
		padding: var(--k-space-3);
		background-color: var(--k-chart-bg);
	}

	.chart {
		width: 100%;
		height: 16rem;
	}

	.legend {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--k-space-2) var(--k-space-4);
		margin: var(--k-space-3) 0 0;
		font-size: var(--k-text-sm);
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
		min-width: 0;
	}

	.swatch {
		flex-shrink: 0;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
	}

	.name {
		overflow: hidden;
		color: var(--k-text-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.count {
		margin-left: auto;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
</style>
