<script lang="ts">
	import type {
		AgCartesianAxesOptions,
		AgCartesianChartOptions,
		AgCartesianSeriesOptions,
		AgChartInstance,
		AgNumberAxisOptions
	} from 'ag-charts-community';
	import type { StatsBucket } from '#lib/stats/buckets';
	import { axisFormat, pointFormat } from '#lib/stats/buckets';

	/**
	 * A time series, at whichever granularity the page is showing, with an
	 * optional second series on its own value axis.
	 *
	 * Used twice on /stats: the commitment fee with market reputation over it,
	 * and the charity donations underneath. One component rather than three
	 * near-identical ones, so the axis formatting, the reactivity and the token
	 * handling exist in one place.
	 *
	 * THE SECOND AXIS IS WHY THE FEE AND REPUTATION SHARE A CHART. One causes
	 * the other — the fee rises exactly when the average falls — and that
	 * relationship is invisible in two separate pictures. They cannot share a
	 * scale, because reputation lives in a narrow band around 1.000 while the
	 * fee is in dollars, so the series names its axis with `yKeyAxis` and the
	 * axes are given as a keyed record.
	 *
	 * REACTIVE BY CONSTRUCTION. The chart is created once and then UPDATED when
	 * its props change. The component this replaces built itself inside
	 * `onMount` and never looked at its props again, so changing the
	 * granularity re-ran the page load, delivered new data, and left the canvas
	 * showing the old series. `update` also transitions between datasets, so
	 * switching from hours to minutes animates instead of blinking.
	 *
	 * AG Charts draws to a canvas, so it is imported inside an effect and never
	 * during server rendering.
	 */

	interface Row {
		/** ISO instant for the start of the bucket. */
		at: string;

		/** Null where this bucket has no value; the point is dropped rather than drawn as zero. */
		value: number | null;

		/** The optional second series, on the same buckets. */
		secondary?: number | null;

		/**
		 * Whether anything actually happened in this bucket. Drives the marker,
		 * so a flat stretch of carried-forward values looks flat rather than
		 * studded with points implying activity.
		 */
		active?: boolean;
	}

	interface SeriesStyle {
		name: string;
		tone: 'price' | 'reputation' | 'donation';
		format: (value: number) => string;
		/** Pins the scale, so a narrow band of values is not flattened. */
		min?: number | undefined;
		max?: number | undefined;
	}

	interface Props {
		rows: readonly Row[];
		bucket: StatsBucket;

		/** `area` for a continuous value, `bar` for a per-bucket quantity. */
		kind?: 'area' | 'bar';

		primary: SeriesStyle;
		secondary?: SeriesStyle | null;

		height?: string;
	}

	let { rows, bucket, kind = 'area', primary, secondary = null, height = '18rem' }: Props =
		$props();

	let container = $state<HTMLDivElement>();

	/**
	 * Plain variables, not `$state`. Nothing renders from them, and making them
	 * reactive would make the update effect re-run every time the chart
	 * assigned to itself.
	 */
	let chart: AgChartInstance | null = null;
	let charts: typeof import('ag-charts-community') | null = null;

	const TOKENS = {
		price: '--k-chart-line',
		reputation: '--k-chart-reputation',
		donation: '--k-chart-donation'
	} as const;

	const data = $derived(
		rows
			.filter((row) => row.value !== null)
			.map((row) => ({
				at: new Date(row.at),
				value: Number(row.value),
				secondary: row.secondary === null || row.secondary === undefined ? null : Number(row.secondary),
				active: row.active ?? false
			}))
	);

	/** Design tokens, read from the document rather than hardcoded. */
	const token = (name: string) =>
		getComputedStyle(document.documentElement).getPropertyValue(name).trim();

	/**
	 * A value axis, with `min`/`max` applied only when supplied.
	 *
	 * Assigned afterwards rather than spread in, because
	 * `exactOptionalPropertyTypes` forbids passing `undefined` to an optional
	 * property, and a conditional spread widens the object enough that AG
	 * Charts' discriminated union no longer resolves.
	 */
	function valueAxis(
		style: SeriesStyle,
		position: 'left' | 'right',
		gridStroke: string | null
	): AgNumberAxisOptions {
		const axis: AgNumberAxisOptions = {
			type: 'number',
			position,
			label: {
				color: token(TOKENS[style.tone]),
				formatter: ({ value }: { value: number }) => style.format(value)
			},
			line: { enabled: false },
			gridLine: gridStroke === null ? { enabled: false } : { style: [{ stroke: gridStroke }] }
		};

		if (style.min !== undefined) axis.min = style.min;
		if (style.max !== undefined) axis.max = style.max;

		return axis;
	}

	function options(target: HTMLElement): AgCartesianChartOptions {
		const text = token('--k-chart-text');
		const grid = token('--k-chart-grid');
		const stroke = token(TOKENS[primary.tone]);

		const axisLabel = new Intl.DateTimeFormat('en-CA', axisFormat(bucket));
		const point = new Intl.DateTimeFormat('en-CA', pointFormat(bucket));

		/** One tooltip for both series, so a hover explains the whole bucket. */
		const tooltip = {
			renderer: ({ datum }: { datum: (typeof data)[number] }) => ({
				heading: point.format(datum.at),
				data: [
					{ label: primary.name, value: primary.format(datum.value) },
					...(secondary && datum.secondary !== null
						? [{ label: secondary.name, value: secondary.format(datum.secondary) }]
						: [])
				]
			})
		};

		const series: AgCartesianSeriesOptions[] =
			kind === 'bar'
				? [
						{
							type: 'bar',
							xKey: 'at',
							yKey: 'value',
							yName: primary.name,
							fill: stroke,
							fillOpacity: 0.75,
							strokeWidth: 0,
							tooltip
						}
					]
				: [
						{
							/** The glow under the line. Purple-to-green for the price. */
							type: 'area',
							xKey: 'at',
							yKey: 'value',
							interpolation: { type: 'linear' },
							fill: {
								type: 'gradient',
								rotation: 90,
								colorStops: [
									{ color: primary.tone === 'price' ? token('--k-chart-area') : stroke, stop: 0 },
									{ color: stroke, stop: 1 }
								]
							},
							fillOpacity: 0.2,
							strokeWidth: 0,
							marker: { enabled: false },
							tooltip: { enabled: false },
							showInLegend: false
						},
						{
							type: 'line',
							xKey: 'at',
							yKey: 'value',
							yName: primary.name,
							interpolation: { type: 'linear' },
							stroke,
							strokeWidth: 2.5,
							/**
							 * A marker only where something happened. Every other bucket
							 * carries the previous value forward, and a point there would
							 * imply activity that did not occur.
							 */
							marker: {
								enabled: true,
								shape: 'circle',
								strokeWidth: 0,
								/**
								 * Static fill as well as the styler. `itemStyler` runs per
								 * datum and never for the legend, so without this the legend
								 * swatch falls back to the theme palette and disagrees with
								 * the line it is labelling.
								 */
								fill: stroke,
								itemStyler: ({ datum }: { datum: (typeof data)[number] }) => ({
									size: datum.active ? 7 : 0,
									fill: stroke
								})
							},
							tooltip
						}
					];

		if (secondary) {
			series.push({
				type: 'line',
				xKey: 'at',
				yKey: 'secondary',
				yName: secondary.name,
				/** Binds this series to the right-hand axis rather than the shared one. */
				yKeyAxis: 'secondary',
				interpolation: { type: 'linear' },
				stroke: token(TOKENS[secondary.tone]),
				strokeWidth: 1.75,
				/** Dashed, so the two lines stay apart without relying on colour. */
				lineDash: [4, 4],
				marker: { enabled: false },
				tooltip: { enabled: false }
			});
		}

		const axes: AgCartesianAxesOptions = {
			x: {
				type: 'time',
				position: 'bottom',
				label: {
					color: text,
					formatter: ({ value }: { value: Date }) => axisLabel.format(value)
				},
				line: { stroke: grid },
				gridLine: { enabled: false }
			},
			y: valueAxis(primary, 'left', grid)
		};

		/** The second axis carries no grid lines; two grids on one plot is noise. */
		if (secondary) axes.secondary = valueAxis(secondary, 'right', null);

		return {
			container: target,
			data,
			background: { visible: false },
			padding: { top: 20, right: 12, bottom: 8, left: 8 },
			legend: secondary
				? { enabled: true, position: 'top', item: { label: { color: text } } }
				: { enabled: false },
			series,
			axes
		};
	}

	/**
	 * Create once, then update.
	 *
	 * The effect reads `data`, `bucket` and the styling props before it
	 * suspends, which is what registers them as dependencies. An effect only
	 * tracks what it touches BEFORE its first await, so reading them after the
	 * dynamic import would register nothing and the chart would never update.
	 */
	$effect(() => {
		const tracked = { data, bucket, kind, primary, secondary };
		let cancelled = false;

		(async () => {
			if (!charts) {
				const mod = await import('ag-charts-community');
				if (cancelled) return;

				mod.ModuleRegistry.registerModules([
					mod.CartesianChartModule,
					mod.LineSeriesModule,
					mod.AreaSeriesModule,
					mod.BarSeriesModule,
					/** Needed by the legend, which only appears when there is a second series. */
					mod.LegendModule,
					mod.TimeAxisModule,
					mod.NumberAxisModule
				]);

				charts = mod;
			}

			if (cancelled || !container) return;
			void tracked;

			/**
			 * `update` rather than destroy-and-create: AG Charts transitions
			 * between datasets, so changing granularity animates instead of
			 * blinking, and the canvas and its listeners survive.
			 */
			if (chart) chart.update(options(container));
			else chart = charts.AgCharts.create(options(container));
		})();

		return () => {
			cancelled = true;
		};
	});

	/** Torn down on unmount only, never on a data change. */
	$effect(() => () => {
		chart?.destroy();
		chart = null;
	});
</script>

<div
	class="chart"
	style:height
	bind:this={container}
	role="img"
	aria-label={secondary ? `${primary.name} and ${secondary.name} over time` : `${primary.name} over time`}
></div>

<style>
	.chart {
		width: 100%;
		background-color: var(--k-chart-bg);
	}
</style>
