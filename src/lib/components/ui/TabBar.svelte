<script lang="ts">
	import { page } from '$app/state';

	/**
	 * TabBar, a Material-style tab bar that filters a list through the URL.
	 *
	 * Each tab is a real link that sets one query parameter and keeps the rest,
	 * so a view can be refreshed, bookmarked and shared, and works without
	 * JavaScript. The active tab carries `aria-current` and the indicator.
	 *
	 * `primary` is the main bar (filled indicator, full width on a phone);
	 * `secondary` is a lighter bar for a second dimension, such as role.
	 */
	interface Props {
		/** Query parameter this bar controls. */
		param: string;
		tabs: readonly { key: string; label: string; count?: number }[];
		active: string;
		/** Accessible name for the bar, e.g. "Filter by status". */
		label: string;
		variant?: 'primary' | 'secondary';
		/** Parameters to drop when a tab changes, typically `page`. */
		reset?: readonly string[];
	}

	let { param, tabs, active, label, variant = 'primary', reset = ['page'] }: Props = $props();

	function hrefFor(key: string): string {
		const params = new URLSearchParams(page.url.search);
		params.set(param, key);
		for (const name of reset) params.delete(name);
		return `?${params.toString()}`;
	}
</script>

<nav class="tabbar" data-variant={variant} aria-label={label}>
	<ul class="tabs" role="list">
		{#each tabs as tab (tab.key)}
			<li>
				<a
					class="tab"
					href={hrefFor(tab.key)}
					aria-current={tab.key === active ? 'page' : undefined}
					data-sveltekit-noscroll
					data-sveltekit-keepfocus
				>
					{tab.label}
					{#if tab.count !== undefined}
						<span class="count">{tab.count}</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.tabbar {
		/* Scrolls sideways on a narrow screen instead of wrapping, like Material's
		   scrollable tabs. */
		overflow-x: auto;
		scrollbar-width: none;
		box-shadow: inset 0 calc(-1 * var(--k-line-width)) 0 0 var(--k-line);
	}

	.tabs {
		display: flex;
		margin: 0;
		min-width: max-content;
	}

	.tabbar[data-variant='primary'] .tabs li {
		flex: 1 0 auto;
	}

	.tab {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--k-space-2);
		min-height: 3rem;
		padding: 0 var(--k-space-4);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
		font-weight: 600;
		letter-spacing: 0.02em;
		text-decoration: none;
		white-space: nowrap;
		transition:
			color var(--k-duration-fast) var(--k-ease),
			background-color var(--k-duration-fast) var(--k-ease);
	}

	.tabbar[data-variant='primary'] .tab {
		text-transform: uppercase;
	}

	.tabbar[data-variant='secondary'] .tab {
		min-height: 2.5rem;
		font-weight: 500;
	}

	/* Material's state layer: a faint wash on hover and press. */
	.tab:hover {
		color: var(--k-text);
		background-color: var(--k-surface-raised);
	}

	.tab:active {
		background-color: var(--k-surface-sunken);
	}

	.tab:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--k-primary);
	}

	.tab[aria-current='page'] {
		color: var(--k-primary);
	}

	/* The indicator. Drawn inside the tab so the cut-corner clipping elsewhere
	   cannot hide it, and styled from aria-current so the visible and the
	   announced state can never disagree. */
	.tab[aria-current='page']::after {
		content: '';
		position: absolute;
		right: var(--k-space-2);
		bottom: 0;
		left: var(--k-space-2);
		height: 3px;
		background-color: var(--k-primary);
	}

	.tabbar[data-variant='secondary'] .tab[aria-current='page']::after {
		right: 0;
		left: 0;
		height: 2px;
	}

	.count {
		min-width: 1.25rem;
		padding: 0 var(--k-space-1);
		background-color: var(--k-surface-sunken);
		color: var(--k-text-muted);
		font-size: var(--k-text-xs);
		text-align: center;
	}

	.tab[aria-current='page'] .count {
		background-color: var(--k-primary);
		color: var(--k-on-primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.tab {
			transition: none;
		}
	}
</style>
