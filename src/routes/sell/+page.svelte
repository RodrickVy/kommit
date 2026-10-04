<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import ListingCard from '#lib/components/listings/ListingCard.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import type { PageProps } from './$types';

	/**
	 * Sell — `/sell`.
	 */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Sell · kommitly</title>
</svelte:head>

<PageHeader title="Your listings" description="Everything you have listed, including drafts.">
	{#snippet actions()}
		<Button href="/sell/create_listing">New listing</Button>
	{/snippet}
</PageHeader>

{#if data.loadError}
	<Alert tone="error">{data.loadError}</Alert>
{:else if data.listings.length === 0}
	<Panel>
		<h2 class="empty-title">Nothing listed yet</h2>
		<p class="empty-body">
			A listing is one item. Add a title, a price and some photographs, then
			publish it when you are ready.
		</p>
		<div class="empty-action">
			<Button href="/sell/create_listing">Create your first listing</Button>
		</div>
	</Panel>
{:else}
	<div class="grid">
		{#each data.listings as listing (listing.id)}
			<ListingCard
				{listing}
				imagePath={listing.listing_images[0]?.storage_path ?? null}
				showStatus
			/>
		{/each}
	</div>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr));
		gap: var(--k-space-4);
	}

	.empty-title {
		font-size: var(--k-text-lg);
	}

	.empty-body {
		margin-top: var(--k-space-2);
		max-width: 48ch;
		color: var(--k-text-muted);
	}

	.empty-action {
		margin-top: var(--k-space-5);
	}
</style>
