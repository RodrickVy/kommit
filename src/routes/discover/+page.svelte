<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import ListingCard from '#lib/components/listings/ListingCard.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import type { PageProps } from './$types';

	/**
	 * Discover — `/discover`.
	 */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Discover · kommitly</title>
</svelte:head>

<PageHeader
	title="Discover"
	description="Items near you, from sellers who back up their meetups with a refundable commitment."
/>

{#if data.loadError}
	<Alert tone="error">{data.loadError}</Alert>
{:else if data.listings.length === 0}
	<Panel>
		<p class="empty">
			Nothing listed yet. <a href="/join">Create an account</a> and you can add the
			first one — sample listings are included if you want them.
		</p>
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
				<a href="?page={data.page - 1}" rel="prev">Previous</a>
			{/if}

			<span class="position">Page {data.page} of {data.pageCount}</span>

			{#if data.page < data.pageCount}
				<a href="?page={data.page + 1}" rel="next">Next</a>
			{/if}
		</nav>
	{/if}
{/if}

<style>
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
