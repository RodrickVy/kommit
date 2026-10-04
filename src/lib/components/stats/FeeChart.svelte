<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * FeeChart, the base commitment fee as a stock-style line chart.
	 *
	 * Built on AG Charts Community (the free, MIT-licensed edition): a line with
	 * linear interpolation over a time axis, one point an hour, on a black
	 * background in Solana's colours. A purple-to-green area sits under the
	 * green line, and a marker shows each hour the fee changed, green when it
	 * went up and red when it went down.
	 *
	 * AG Charts draws to a canvas in the browser, so it is loaded on mount and
	 * never during server rendering. Colours come from the design tokens.
	 */
	interface HourPoint {
		at: string;
		cents: number;
		change: 'up' | 'down' | null;
	}

	interface Props {
		hourly: readonly HourPoint[];
		currencyCode: string;
	}

	let { hourly, currencyCode }: Props = $props();

	let container = $state<HTMLDivElement>();

	const money = (cents: number) =>
		new Intl.NumberFormat('en-CA', { style: 'currency', currency: currencyCode }).format(cents / 100);

	const when = (date: Date) =>
		new Intl.DateTimeFormat('en-CA', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(date);

	onMount(() => {
		let chart: { destroy(): void } | null = null;
		let cancelled = false;

		import('ag-charts-community').then(
			({
				AgCharts,
				ModuleRegistry,
				CartesianChartModule,
				LineSeriesModule,
				AreaSeriesModule,
				TimeAxisModule,
				NumberAxisModule
			}) => {
				if (cancelled || !container) return;

				ModuleRegistry.registerModules([
					CartesianChartModule,
					LineSeriesModule,
					AreaSeriesModule,
					TimeAxisModule,
					NumberAxisModule
				]);

				const token = (name: string) =>
					getComputedStyle(document.documentElement).getPropertyValue(name).trim();

				const c = {
					line: token('--k-chart-line'),
					area: token('--k-chart-area'),
					up: token('--k-chart-up'),
					down: token('--k-chart-down'),
					text: token('--k-chart-text'),
					grid: token('--k-chart-grid')
				};

				const data = hourly.map((point) => ({
					at: new Date(point.at),
					fee: point.cents / 100,
					change: point.change
				}));

				const tooltip = {
					renderer: ({ datum }: { datum: (typeof data)[number] }) => ({
						heading: when(datum.at),
						data: [
							{ label: 'Base fee', value: money(datum.fee * 100) },
							...(datum.change
								? [{ label: 'Change', value: datum.change === 'up' ? 'Went up' : 'Went down' }]
								: [])
						]
					})
				};

				chart = AgCharts.create({
					container,
					data,
					background: { visible: false },
					padding: { top: 24, right: 16, bottom: 8, left: 8 },
					series: [
						{
							/** The glow under the line: Solana purple fading towards green. */
							type: 'area',
							xKey: 'at',
							yKey: 'fee',
							interpolation: { type: 'linear' },
							fill: {
								type: 'gradient',
								rotation: 90,
								colorStops: [
									{ color: c.area, stop: 0 },
									{ color: c.line, stop: 1 }
								]
							},
							fillOpacity: 0.22,
							strokeWidth: 0,
							marker: { enabled: false },
							tooltip: { enabled: false },
							showInLegend: false
						},
						{
							type: 'line',
							xKey: 'at',
							yKey: 'fee',
							yName: 'Base fee',
							interpolation: { type: 'linear' },
							stroke: c.line,
							strokeWidth: 2.5,
							marker: {
								enabled: true,
								shape: 'circle',
								strokeWidth: 2,
								/** Markers only where the fee moved; every other hour is the line alone. */
								itemStyler: ({ datum }) =>
									datum.change
										? {
												size: 14,
												fill: datum.change === 'up' ? c.up : c.down,
												stroke: '#000000'
											}
										: { size: 0 }
							},
							tooltip
						}
					],
					axes: {
						x: {
							type: 'time',
							position: 'bottom',
							label: { color: c.text },
							line: { stroke: c.grid },
							gridLine: { enabled: false }
						},
						y: {
							type: 'number',
							position: 'right',
							min: 0,
							label: { color: c.text, formatter: ({ value }) => money(Number(value) * 100) },
							line: { stroke: c.grid },
							gridLine: { style: [{ stroke: c.grid }] }
						}
					}
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
	<div class="chart" bind:this={container} role="img" aria-label="Line chart of the base commitment fee, hour by hour"></div>
</div>

<style>
	/* Black in both themes, like a trading terminal. */
	.frame {
		padding: var(--k-space-3);
		background-color: var(--k-chart-bg);
	}

	.chart {
		width: 100%;
		height: 22rem;
	}

	@media (max-width: 40rem) {
		.chart {
			height: 18rem;
		}
	}
</style>
