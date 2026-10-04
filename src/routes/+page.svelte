<script lang="ts">
	import { page } from '$app/state';
	import {
		faCircleCheck,
		faHandshake,
		faMagnifyingGlassLocation,
		faPeopleArrows
	} from '@fortawesome/free-solid-svg-icons';
	import ListingCard from '#lib/components/listings/ListingCard.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import type { PageProps } from './$types';

	/**
	 * Home — `/`.
	 *
	 * What kommitly is, how it works, and the newest listings as a sliding row.
	 */
	let { data }: PageProps = $props();

	/** Find → Commit → Meet → Complete. */
	const STEPS = [
		{
			icon: faMagnifyingGlassLocation,
			title: 'Find a local deal',
			text: 'Browse nearby items and choose what you want to buy.'
		},
		{
			icon: faHandshake,
			title: 'Make a promise to show up',
			text: 'Put down a small commitment fee to show the seller you’re serious.'
		},
		{
			icon: faPeopleArrows,
			title: 'Meet and check the item',
			text: 'Meet the seller in person and make sure everything is as expected.'
		},
		{
			icon: faCircleCheck,
			title: 'Complete the deal',
			text: 'Pay the seller and confirm the exchange. Your commitment fee is returned when you follow through.'
		}
	];

	const signedIn = $derived(page.data.user != null);

	let track = $state<HTMLUListElement>();
	let atStart = $state(true);
	let atEnd = $state(false);

	/** Which arrows make sense, recomputed as the row scrolls or resizes. */
	function updateEdges() {
		if (!track) return;
		atStart = track.scrollLeft <= 4;
		atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
	}

	/** One "page" of cards at a time; scroll-snap lines the result up. */
	function slide(direction: 1 | -1) {
		track?.scrollBy({ left: direction * track.clientWidth * 0.9, behavior: 'smooth' });
	}

	$effect(() => {
		void data.listings;
		updateEdges();
	});
</script>

<svelte:window onresize={updateEdges} />

<svelte:head>
	<title>kommitly — local meetups people actually show up to</title>
	<meta
		name="description"
		content="Buy and sell locally. Both sides put down a refundable $2 commitment, so everyone shows up."
	/>
</svelte:head>

<section class="hero" aria-labelledby="hero-title">
	<h1 id="hero-title">Local deals, backed by a promise to show up.</h1>

	<div class="hero-actions">
		<Button href="/discover">Browse listings</Button>
		{#if signedIn}
			<Button href="/sell/create_listing" variant="secondary">Sell something</Button>
		{:else}
			<Button href="/join" variant="secondary">Create an account</Button>
		{/if}
	</div>
</section>

<!-- The whole idea in four steps: Find → Commit → Meet → Complete. Each step
     is identified by its icon rather than a number. -->
<section class="how" aria-labelledby="how-title">
	<h2 id="how-title" class="section-title">How it works</h2>
	<ol class="flow" role="list">
		{#each STEPS as step (step.title)}
			<li class="step">
				<span class="step-icon k-cut"><Icon icon={step.icon} /></span>
				<h3 class="step-title">{step.title}</h3>
				<p class="step-text">{step.text}</p>
			</li>
		{/each}
	</ol>
</section>

<section class="preview" aria-labelledby="preview-title">
	<div class="preview-head">
		<div>
			<h2 id="preview-title">New on Discover</h2>
			<p class="muted">The latest items, from sellers who commit to meeting.</p>
		</div>
		<div class="preview-controls">
			{#if data.listings.length > 1}
				<button
					type="button"
					class="arrow k-cut"
					onclick={() => slide(-1)}
					disabled={atStart}
					aria-label="Previous listings">←</button
				>
				<button
					type="button"
					class="arrow k-cut"
					onclick={() => slide(1)}
					disabled={atEnd}
					aria-label="Next listings">→</button
				>
			{/if}
			<a class="see-all" href="/discover">See all</a>
		</div>
	</div>

	{#if data.listingsError}
		<Alert tone="error">{data.listingsError}</Alert>
	{:else if data.listings.length === 0}
		<Panel>
			<p class="muted">
				{#if signedIn}
					Nothing listed yet. <a href="/sell/create_listing">List something</a> and it
					will be the first thing buyers see.
				{:else}
					Nothing listed yet. <a href="/join">Create an account</a> to add the first one.
				{/if}
			</p>
		</Panel>
	{:else}
		<!--
			A native horizontal scroller with snap points: swipe on a phone, the
			arrow buttons or a trackpad on a computer, and it never traps the
			keyboard — every card is still an ordinary link in tab order.
		-->
		<ul class="track" role="list" bind:this={track} onscroll={updateEdges}>
			{#each data.listings as listing (listing.id)}
				<li class="slide">
					<ListingCard
						{listing}
						imagePath={listing.listing_images[0]?.storage_path ?? null}
						showRequest
					/>
				</li>
			{/each}
		</ul>
	{/if}
</section>


<style>


	.hero {
		display: grid;
		gap: var(--k-space-5);
		padding-block: var(--k-space-4) var(--k-space-6);
	}

	.how {
		display: grid;
		gap: var(--k-space-4);
		margin-bottom: var(--k-space-7);
	}

	.section-title {
		font-size: var(--k-text-xl);
	}

	.hero h1 {
		font-size: clamp(var(--k-text-2xl), 5vw, var(--k-text-3xl));
		line-height: 1.15;
	}


	.hero h1 {
		max-width: 22ch;
	}

	.flow {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(13rem, 100%), 1fr));
		gap: var(--k-space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.step {
		display: grid;
		align-content: start;
		gap: var(--k-space-2);
		padding: var(--k-space-4);
		background-color: var(--k-surface-raised);
	}

	.step-icon {
		display: grid;
		place-items: center;
		width: 2.75rem;
		height: 2.75rem;
		margin-bottom: var(--k-space-1);
		background-color: var(--k-primary);
		color: var(--k-on-primary);
		font-size: 1.25rem;
	}


	.step-title {
		font-size: var(--k-text-base);
		line-height: 1.3;
	}

	.step-text {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	/* On a phone, each step is a compact row: icon beside the text. */
	@media (max-width: 40rem) {
		.step {
			grid-template-columns: auto 1fr;
			column-gap: var(--k-space-3);
			row-gap: var(--k-space-1);
			padding: var(--k-space-3);
		}

		.step-icon {
			grid-row: span 2;
			width: 2.25rem;
			height: 2.25rem;
			margin-bottom: 0;
			font-size: 1rem;
		}
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--k-space-3);
	}




	.preview {
		margin-bottom: var(--k-space-7);
	}

	.preview-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--k-space-3);
		margin-bottom: var(--k-space-4);
	}

	.preview-head h2 {
		font-size: var(--k-text-xl);
	}

	.muted {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.preview-controls {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
	}

	.arrow {
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border: 0;
		background-color: var(--k-surface-raised);
		color: var(--k-text);
		font-size: var(--k-text-lg);
		cursor: pointer;
	}

	.arrow:hover:not(:disabled) {
		background-color: var(--k-surface-sunken);
	}

	.arrow:focus-visible {
		box-shadow: inset 0 0 0 2px var(--k-primary);
		outline: none;
	}

	.arrow:disabled {
		color: var(--k-text-subtle);
		cursor: default;
		opacity: 0.5;
	}

	.see-all {
		margin-left: var(--k-space-2);
		font-size: var(--k-text-sm);
	}

	.track {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: min(17rem, 78%);
		gap: var(--k-space-4);
		margin: 0;
		padding-bottom: var(--k-space-3);
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scroll-snap-type: x mandatory;
		scroll-padding-inline: 0;
		scrollbar-width: thin;
	}

	.slide {
		display: flex;
		scroll-snap-align: start;
	}

	.slide > :global(*) {
		flex: 1;
	}







	@media (prefers-reduced-motion: reduce) {
		.track {
			scroll-behavior: auto;
		}
	}
</style>
