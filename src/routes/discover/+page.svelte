<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import ListingCard from '#lib/components/listings/ListingCard.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import { page } from '$app/state';
	import {
		CATEGORY_OPTIONS,
		CONDITION_TABS,
		DISCOVER_SORTS,
		MAX_QUERY_LENGTH
	} from '#lib/listings/discover-view';
	import type { PageProps } from './$types';

	/**
	 * Discover, `/discover`.
	 */
	let { data }: PageProps = $props();

	const sortTabs = Object.entries(DISCOVER_SORTS).map(([key, option]) => ({
		key,
		label: option.label
	}));

	/** Whether the visitor has narrowed the list, which changes the empty message. */
	const narrowed = $derived(
		data.view.q !== '' || data.view.condition !== 'all' || data.view.category !== 'all'
	);

	/** Pagination keeps the search, condition and sort. */
	function pageHref(target: number): string {
		const params = new URLSearchParams(page.url.search);
		params.set('page', String(target));
		return `?${params.toString()}`;
	}
</script>

<svelte:head>
	<title>Discover · kommitly</title>
</svelte:head>

<PageHeader
	title="Discover"
	description="Items near you, from sellers who back up their meetups with a refundable commitment."
/>

<!--
	A plain GET form, so a search is a URL like any other view. The current
	condition and sort ride along as hidden fields; a new search starts on page 1.
-->
<form method="GET" class="search" role="search" data-sveltekit-keepfocus>
	<label class="k-visually-hidden" for="discover-search">Search listings</label>
	<div class="search-field k-cut">
		<svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M10 4a6 6 0 1 0 3.7 10.7l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
			/>
		</svg>
		<input
			id="discover-search"
			type="search"
			name="q"
			value={data.view.q}
			maxlength={MAX_QUERY_LENGTH}
			placeholder="Search listings"
			autocomplete="off"
		/>
		{#if data.view.q}
			<a
				class="clear"
				href="?condition={data.view.condition}&category={data.view.category}&sort={data.view.sort}"
				aria-label="Clear search">×</a
			>
		{/if}
	</div>
	<input type="hidden" name="condition" value={data.view.condition} />
	<input type="hidden" name="category" value={data.view.category} />
	<input type="hidden" name="sort" value={data.view.sort} />
	<button type="submit" class="search-button k-cut">Search</button>
</form>

<div class="tabs">
	<!--
		A select rather than a TabBar: thirty-five categories would be a tab
		strip nobody scrolls to the end of. It is still a GET form, so choosing
		one is a navigation to a shareable URL like every other filter here,
		and it works without JavaScript — the Go button is only hidden once
		scripting can submit on change.
	-->
	<form method="GET" class="category" data-sveltekit-keepfocus data-sveltekit-noscroll>
		<input type="hidden" name="q" value={data.view.q} />
		<input type="hidden" name="condition" value={data.view.condition} />
		<input type="hidden" name="sort" value={data.view.sort} />

		<label class="k-visually-hidden" for="category">Filter by category</label>
		<select
			id="category"
			name="category"
			value={data.view.category}
			onchange={(event) => event.currentTarget.form?.requestSubmit()}
		>
			{#each CATEGORY_OPTIONS as option (option.key)}
				<option value={option.key}>{option.label}</option>
			{/each}
		</select>

		<noscript><button type="submit" class="category-go k-cut">Go</button></noscript>
	</form>

	<TabBar param="condition" tabs={CONDITION_TABS} active={data.view.condition} label="Filter by condition" />
	<TabBar
		param="sort"
		tabs={sortTabs}
		active={data.view.sort}
		label="Sort listings"
		variant="secondary"
	/>
</div>

{#if data.view.q}
	<p class="summary">
		{data.total} result{data.total === 1 ? '' : 's'} for <strong>“{data.view.q}”</strong>
	</p>
{/if}

{#if data.loadError}
	<Alert tone="error">{data.loadError}</Alert>
{:else if data.listings.length === 0 && narrowed}
	<Panel>
		<p class="empty">
			Nothing matches {data.view.q ? `“${data.view.q}”` : 'those filters'}.
			<a href="/discover">Show all listings</a>
		</p>
	</Panel>
{:else if data.listings.length === 0}
	<Panel>
		{#if data.user}
			<p class="empty">
				Nothing listed yet. <a href="/sell/create_listing">List something</a> and it
				will be the first thing buyers see here.
			</p>
		{:else}
			<p class="empty">
				Nothing listed yet. <a href="/join">Create an account</a> and you can add the
				first one, sample listings are included if you want them.
			</p>
		{/if}
	</Panel>
{:else}
	<div class="grid">
		{#each data.listings as listing (listing.id)}
			<ListingCard
				{listing}
				imagePath={listing.listing_images[0]?.storage_path ?? null}
				showRequest
			/>
		{/each}
	</div>

	{#if data.pageCount > 1}
		<!--
			Real links, not buttons. A page of results should be shareable,
			bookmarkable and reachable without JavaScript.
		-->
		<nav class="pagination" aria-label="Listing pages">
			{#if data.page > 1}
				<a href={pageHref(data.page - 1)} rel="prev">Previous</a>
			{/if}

			<span class="position">Page {data.page} of {data.pageCount}</span>

			{#if data.page < data.pageCount}
				<a href={pageHref(data.page + 1)} rel="next">Next</a>
			{/if}
		</nav>
	{/if}
{/if}

<style>
	.category select {
		max-width: 16rem;
	}

	.category-go {
		margin-left: var(--k-space-2);
		padding: var(--k-space-2) var(--k-space-3);
		background-color: var(--k-primary);
		color: var(--k-on-primary);
		border: 0;
		font-size: var(--k-text-sm);
	}

	.search {
		display: flex;
		gap: var(--k-space-2);
		margin-bottom: var(--k-space-4);
	}

	.search-field {
		position: relative;
		display: flex;
		flex: 1;
		align-items: center;
		min-width: 0;
		background-color: var(--k-surface-raised);
	}

	.search-field:focus-within {
		box-shadow: inset 0 0 0 2px var(--k-primary);
	}

	.search-icon {
		position: absolute;
		left: var(--k-space-3);
		width: 1.25rem;
		height: 1.25rem;
		fill: var(--k-text-subtle);
		pointer-events: none;
	}

	.search-field input {
		flex: 1;
		min-width: 0;
		height: 3rem;
		padding: 0 var(--k-space-6) 0 calc(var(--k-space-3) * 2 + 1.25rem);
		border: 0;
		background: transparent;
		color: var(--k-text);
		font: inherit;
	}

	.search-field input:focus {
		outline: none;
	}

	/* The browser's own clear button duplicates ours. */
	.search-field input::-webkit-search-cancel-button {
		display: none;
	}

	.clear {
		position: absolute;
		right: var(--k-space-3);
		color: var(--k-text-subtle);
		font-size: var(--k-text-xl);
		line-height: 1;
		text-decoration: none;
	}

	.clear:hover {
		color: var(--k-text);
	}

	.search-button {
		padding: 0 var(--k-space-5);
		border: 0;
		background-color: var(--k-primary);
		color: var(--k-on-primary);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.search-button:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--k-on-primary);
	}

	.tabs {
		display: grid;
		gap: var(--k-space-1);
		margin-bottom: var(--k-space-5);
	}

	.summary {
		margin-bottom: var(--k-space-4);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.grid {
		display: grid;
		/* Collapses to one column on a phone without a media query. The min()
		   caps the track floor at the container width, so it can shrink below
		   16rem rather than overflowing. */
		grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
		gap: var(--k-space-4);
	}

	.empty {
		color: var(--k-text-muted);
	}

	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--k-space-4);
		margin-top: var(--k-space-6);
	}

	.position {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}
</style>
