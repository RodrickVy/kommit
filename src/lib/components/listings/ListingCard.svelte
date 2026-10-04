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

	/* One ratio for every card, whatever shape the photograph is, so a row of
	   cards lines up and the text below each starts at the same height. */
	.media {
		display: grid;
		place-items: center;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background-color: var(--k-surface-sunken);
	}

	.media img {
		width: 100%;
		height: 100%;
		/* `contain`, not `cover`: the whole item is visible rather than having
		   its edges cropped to fill the frame. A tall photograph of a bike is
		   letterboxed instead of being reduced to its middle third, which is
		   what a buyer scanning a grid actually needs to see. The frame keeps
		   its ratio either way, so the cards stay uniform. */
		object-fit: contain;
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
		/* The middle row takes the slack, which pins `meta` to the bottom of
		   every card regardless of how tall the title ran. */
		grid-template-rows: auto 1fr auto;
		flex: 1;
		gap: var(--k-space-2);
		padding: var(--k-space-4);
	}

	.title {
		font-size: var(--k-text-base);
		font-weight: 600;
		line-height: 1.35;
		/* Two lines, then ellipsis, long titles must not change card height. */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		/* The standard property, alongside the prefixed one. Browsers that
		   support it use this; older WebKit falls back to the prefix. */
		line-clamp: 2;
		overflow: hidden;
		/* ALWAYS two lines tall, even for a one-line title. Clamping only caps
		   the maximum; without a floor a short title and a long one give the
		   two cards different heights and the prices stop lining up. */
		min-height: calc(2 * 1.35em);
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
