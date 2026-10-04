<script lang="ts">
	import { page } from '$app/state';
	import ListingCard from '#lib/components/listings/ListingCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import WalletBalance from '#lib/components/wallet/WalletBalance.svelte';
	import type { PageProps } from './$types';

	/**
	 * Home — `/`.
	 *
	 * What kommitly is, the newest listings as a sliding row, and — once signed
	 * in — the wallet balance, since funds decide whether a meetup can be
	 * requested at all.
	 */
	let { data }: PageProps = $props();

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

<div class="intro">
<section class="hero">
	<h1>Local deals, backed by a promise to show up.</h1>
	<p class="lede">
		Buyer and seller each put down a refundable <strong>$2 commitment</strong>. Meet at
		the agreed place, scan to confirm, and you both get it back. No-shows lose theirs
		to charity.
	</p>
	<div class="hero-actions">
		<Button href="/discover">Browse listings</Button>
		{#if signedIn}
			<Button href="/sell/create_listing" variant="secondary">Sell something</Button>
		{:else}
			<Button href="/join" variant="secondary">Create an account</Button>
		{/if}
	</div>
</section>

{#if data.wallet}
	<section class="wallet">
		<WalletBalance wallet={data.wallet} />
		<div class="wallet-actions">
			<Button href="/wallet/fund_wallet" size="sm">Add funds</Button>
			<Button href="/wallet" variant="secondary" size="sm">Wallet</Button>
		</div>
	</section>
{:else if data.walletError}
	<div class="wallet">
		<Alert tone="error">{data.walletError}</Alert>
	</div>
{/if}
</div>

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

<section class="steps" aria-labelledby="steps-title">
	<h2 id="steps-title">How it works</h2>
	<ol class="step-list">
		<li>
			<span class="step-number">1</span>
			<h3>Request a meetup</h3>
			<p>Pick a place and time the seller offers. You put down $2.</p>
		</li>
		<li>
			<span class="step-number">2</span>
			<h3>The seller commits</h3>
			<p>When they accept, they put down $2 too. Now you are both on the hook.</p>
		</li>
		<li>
			<span class="step-number">3</span>
			<h3>Meet and scan</h3>
			<p>Check in at the spot and scan the seller's code. Both commitments come back.</p>
		</li>
	</ol>
</section>

<style>
	/* Intro and wallet side by side when there is room; stacked on a phone. */
	.intro {
		display: grid;
		gap: var(--k-space-5);
		align-items: start;
		margin-bottom: var(--k-space-6);
	}

	@media (min-width: 60rem) {
		.intro {
			grid-template-columns: minmax(0, 1fr) 22rem;
		}
	}

	.hero {
		display: grid;
		gap: var(--k-space-4);
		max-width: 46rem;
		padding-block: var(--k-space-4) 0;
	}

	.hero h1 {
		font-size: clamp(var(--k-text-2xl), 5vw, var(--k-text-3xl));
		line-height: 1.15;
	}

	.lede {
		color: var(--k-text-muted);
		font-size: var(--k-text-lg);
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
	}

	.wallet {
		display: grid;
		gap: var(--k-space-3);
		max-width: 28rem;
	}

	.wallet-actions {
		display: flex;
		gap: var(--k-space-2);
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

	.preview-head h2,
	.steps h2 {
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

	.steps {
		padding-top: var(--k-space-6);
		border-top: var(--k-line-width) solid var(--k-line);
	}

	.step-list {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		gap: var(--k-space-4);
		margin: var(--k-space-4) 0 0;
		padding: 0;
		list-style: none;
	}

	.step-list li {
		display: grid;
		gap: var(--k-space-2);
		align-content: start;
	}

	.step-number {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		background-color: var(--k-primary);
		color: var(--k-on-primary);
		font-weight: 700;
	}

	.step-list h3 {
		font-size: var(--k-text-base);
	}

	.step-list p {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	@media (prefers-reduced-motion: reduce) {
		.track {
			scroll-behavior: auto;
		}
	}
</style>
