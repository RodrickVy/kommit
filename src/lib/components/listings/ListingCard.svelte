<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import RequestDialog from '#lib/components/commitments/RequestDialog.svelte';
	import { formatPrice } from '#lib/format';
	import { CONDITION_LABELS, STATUS_LABELS, type ListingCondition, type ListingStatus } from '#lib/listings/labels';
	import { listingImageUrl } from '#lib/listings/images';

	/**
	 * ListingCard, one listing in a grid.
	 *
	 * Used by both Discover and a seller's own listings page, so the two cannot
	 * drift apart. The only difference between them is whether the status badge
	 * is shown, which the seller needs and a buyer does not.
	 */
	interface Props {
		listing: {
			id: string;
			title: string;
			price_cents: number;
			condition: ListingCondition;
			status: ListingStatus;
		};

		/** Primary image storage path, or null when the listing has no images. */
		imagePath?: string | null;

		/** Show the status badge. On for the seller's own listings. */
		showStatus?: boolean;

		/** Show the "Request a meetup" button. On in Discover. */
		showRequest?: boolean;
	}

	let { listing, imagePath = null, showStatus = false, showRequest = false }: Props = $props();

	const statusTone = $derived(
		listing.status === 'active'
			? 'live'
			: listing.status === 'draft'
				? 'warning'
				: listing.status === 'reserved'
					? 'neutral'
					: 'muted'
	);
</script>

<article class="card k-cut k-outline">
<a class="link" href="/sell/{listing.id}">
	<div class="media">
		{#if imagePath}
			<!--
				`loading="lazy"` because a grid can run to dozens of images, and
				the ones below the fold should not compete with the ones above it.
				Explicit dimensions reserve the space so the grid does not reflow
				as each image arrives.
			-->
			<img src={listingImageUrl(imagePath)} alt="" loading="lazy" width="400" height="300" />
		{:else}
			<!-- Not an error state. A draft legitimately has no photos yet. -->
			<div class="media-empty">No photo</div>
		{/if}
	</div>

	<div class="body">
		<h3 class="title">{listing.title}</h3>

		<p class="price">{formatPrice(listing.price_cents)}</p>

		<div class="meta">
			<span class="condition">{CONDITION_LABELS[listing.condition]}</span>
			{#if showStatus}
				<Badge tone={statusTone}>{STATUS_LABELS[listing.status]}</Badge>
			{/if}
		</div>
	</div>
</a>

{#if showRequest}
	<!-- A sibling of the card link, not inside it: a link cannot hold a link. -->
	<div class="request">
		<RequestDialog listingId={listing.id} title={listing.title} />
	</div>
{/if}
</article>

<style>
	.card {
		display: flex;
		flex-direction: column;
		background-color: var(--k-surface);
		transition: background-color var(--k-duration-fast) var(--k-ease);
	}

	.link {
		display: flex;
		flex: 1;
		flex-direction: column;
		color: inherit;
		text-decoration: none;
	}

	.request {
		display: grid;
		padding: 0 var(--k-space-4) var(--k-space-4);
	}

	.card:hover {
		background-color: var(--k-surface-raised);
	}

	.media {
		aspect-ratio: 4 / 3;
		background-color: var(--k-surface-sunken);
	}

	.media img {
		width: 100%;
		height: 100%;
		/* Fill the frame without distorting. Every card then has the same
		   geometry whatever shape the photograph is. */
		object-fit: cover;
	}

	.media-empty {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.body {
		display: grid;
		gap: var(--k-space-2);
		padding: var(--k-space-4);
	}

	.title {
		font-size: var(--k-text-base);
		font-weight: 600;
		/* Two lines, then ellipsis, long titles must not change card height. */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		/* The standard property, alongside the prefixed one. Browsers that
		   support it use this; older WebKit falls back to the prefix. */
		line-clamp: 2;
		overflow: hidden;
	}

	.price {
		font-weight: 600;
		font-size: var(--k-text-lg);
	}

	.meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--k-space-2);
	}

	.condition {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}
</style>
