<script lang="ts">
	import { page } from '$app/state';
	import {
		faArrowRight,
		faCircleCheck,
		faCoins,
		faGaugeHigh,
		faReceipt,
		faHandHoldingHeart,
		faHandshake,
		faMagnifyingGlassLocation,
		faPeopleArrows,
		faScaleBalanced,
		faShieldHalved,
		faUserSecret
	} from '@fortawesome/free-solid-svg-icons';
	import Icon from '#lib/components/ui/Icon.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	/**
	 * Home, `/`.
	 *
	 * What kommitly is, how it works, and what it stands for.
	 */
	/** What the marketplace stands for, shown under "Our mission". */
	const VALUES = [
		{
			icon: faScaleBalanced,
			title: 'Honest',
			text: 'A commitment on both sides means people only request what they intend to follow through on.'
		},
		{
			icon: faShieldHalved,
			title: 'Reputable and hard to scam',
			text: 'Meetups are confirmed in person, at the agreed place, before any money changes hands, and every record builds a trustworthy track record.'
		},
		{
			icon: faUserSecret,
			title: 'Private by default',
			text: 'No phone numbers or emails swapped with strangers. Everything you need to meet happens on kommitly.'
		},
		{
			icon: faHandHoldingHeart,
			title: 'Giving back',
			text: 'When someone doesn’t show up, their commitment doesn’t go to us, it goes to charity.'
		}
	];

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
</script>

<svelte:head>
	<title>kommitly, local meetups people actually show up to</title>
	<meta
		name="description"
		content="Buy and sell locally. Both sides put down a refundable $2 commitment, so everyone shows up."
	/>
</svelte:head>

<section class="hero" aria-labelledby="hero-title">
	<h1 id="hero-title">Local deals, backed by a promise to show up.</h1>
	<p class="lede">
		Buy and sell with people nearby. Both sides put down a small, refundable
		commitment, so the person you are meeting actually turns up.
	</p>

	<div class="hero-actions">
		<!-- The main action: most visitors come to find something. -->
		<a class="cta-primary k-cut" href="/discover">
			Browse listings
			<Icon icon={faArrowRight} />
		</a>
		<Button href="/sell/create_listing" variant="secondary">Sell a listing</Button>
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
<!--
	Full-width band. The background reaches the edges of the window while the
	content stays aligned with the rest of the page; see `.solana` below.
-->
<section class="solana" aria-labelledby="solana-title">
	<div class="solana-intro">
		<img class="solana-logo" src="/solana_logo.png" alt="Solana" width="316" height="316" />
		<div>
			<h2 id="solana-title" class="solana-title">
				Backed by blazingly fast <span class="solana-word">Solana</span>
			</h2>
			<p class="solana-text">
				Every commitment, refund and payment moves on Solana, so it lands in seconds,
				costs a fraction of a cent, and leaves a public receipt anyone can check.
			</p>
		</div>
	</div>

	<ul class="solana-facts" role="list">
		<li><Icon icon={faGaugeHigh} /> Settles in seconds</li>
		<!--
			"Network fees", not "Fees". A visitor reads a bare "Fees" claim as what
			kommitly charges, and the commitment fee is dollars, not fractions of a
			cent. Both numbers are true; only one of them is what this line is about.
		-->
		<li><Icon icon={faCoins} /> Network fees under a cent</li>
		<li><Icon icon={faReceipt} /> Every transfer verifiable</li>
	</ul>
</section>

<!-- Why kommitly exists, ending in an invitation to be part of it. -->
<section class="mission" aria-labelledby="mission-title">
	<div class="mission-intro">
		<h2 id="mission-title" class="section-title">Our mission</h2>
		<p class="mission-text">
			Buying from a stranger shouldn't feel like a gamble. We are building a local
			marketplace where showing up is the norm, scams are hard to pull off, and every
			broken promise does some good.
		</p>
	</div>

	<ul class="values" role="list">
		{#each VALUES as value (value.title)}
			<li class="value">
				<span class="value-icon"><Icon icon={value.icon} /></span>
				<div>
					<h3 class="value-title">{value.title}</h3>
					<p class="value-text">{value.text}</p>
				</div>
			</li>
		{/each}
	</ul>

	<div class="movement k-cut">
		<p class="movement-text">
			<strong>This is a movement, not just a marketplace.</strong>
			Every meetup that happens as promised makes buying locally a little more
			trustworthy for everyone.
		</p>
		{#if signedIn}
			<Button href="/sell/create_listing">List something and join in</Button>
		{:else}
			<Button href="/join">Join the movement</Button>
		{/if}
	</div>
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
		margin-bottom: var(--k-space-8);
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
























	.lede {
		max-width: 46ch;
		color: var(--k-text-muted);
		font-size: var(--k-text-lg);
	}

	/* The main call to action, larger than a standard button so the eye lands
	   on it first; "Sell a listing" sits beside it as the quieter option. */
	.cta-primary {
		display: inline-flex;
		align-items: center;
		gap: var(--k-space-3);
		min-height: 3.25rem;
		padding: 0 var(--k-space-6);
		background-color: var(--k-primary);
		color: var(--k-on-primary);
		font-size: var(--k-text-lg);
		font-weight: 700;
		text-decoration: none;
		transition: background-color var(--k-duration-fast) var(--k-ease);
	}

	.cta-primary:hover {
		background-color: var(--k-primary-hover);
	}

	.cta-primary:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 3px var(--k-on-primary);
	}

	.mission {
		display: grid;
		gap: var(--k-space-6);
	}

	.mission-intro {
		display: grid;
		gap: var(--k-space-3);
		max-width: 46rem;
	}

	.mission-text {
		color: var(--k-text-muted);
		font-size: var(--k-text-lg);
	}

	.values {
		display: grid;
		gap: var(--k-space-5) var(--k-space-6);
		margin: 0;
	}

	/* Four values read best as an even 2 × 2, never 3 + 1. */
	@media (min-width: 40rem) {
		.values {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.value {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--k-space-3);
		align-items: start;
	}

	.value-icon {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		background-color: var(--k-surface-raised);
		color: var(--k-primary);
		font-size: 1.125rem;
	}

	.value-title {
		margin-bottom: var(--k-space-1);
		font-size: var(--k-text-base);
	}

	.value-text {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.movement {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--k-space-4);
		padding: var(--k-space-6);
		background-color: var(--k-surface-raised);
	}

	.movement-text {
		max-width: 48ch;
		color: var(--k-text-muted);
	}

	.movement-text strong {
		display: block;
		margin-bottom: var(--k-space-1);
		color: var(--k-text);
		font-size: var(--k-text-lg);
	}

	/* -- Solana band ------------------------------------------------------
	   Full-bleed without 100vw: the background is a border-image pushed out
	   100vw either side. That is paint only, so it never adds a horizontal
	   scrollbar the way a 100vw-wide box does once a vertical scrollbar
	   exists. The content inside keeps the page's own width and gutter. */
	.solana {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		align-items: center;
		gap: var(--k-space-6);
		margin-bottom: var(--k-space-8);
		padding-block: var(--k-space-7);
		border-image-source: linear-gradient(115deg, var(--k-band-bg-from), var(--k-band-bg-to));
		border-image-slice: 0 fill;
		border-image-width: 0;
		border-image-outset: 0 100vw;
		color: var(--k-band-text);
	}

	.solana-intro {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--k-space-4);
		align-items: start;
	}

	/* Round already, so it is not given the cut corners the tiles use. */
	.solana-logo {
		width: 3.5rem;
		height: 3.5rem;
		flex-shrink: 0;
	}

	.solana-title {
		font-size: clamp(var(--k-text-xl), 3.5vw, var(--k-text-2xl));
		line-height: 1.2;
	}

	.solana-word {
		background: linear-gradient(90deg, var(--k-band-accent-from), var(--k-band-accent-to));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.solana-text {
		max-width: 52ch;
		margin-top: var(--k-space-2);
		color: var(--k-band-text-muted);
	}

	.solana-facts {
		display: grid;
		gap: var(--k-space-3);
		margin: 0;
	}

	.solana-facts li {
		display: flex;
		align-items: center;
		gap: var(--k-space-3);
		padding: var(--k-space-3) var(--k-space-4);
		background-color: rgb(255 255 255 / 0.06);
		box-shadow: inset 3px 0 0 0 var(--k-band-accent-to);
		font-weight: 600;
	}

	.solana-facts :global(.icon) {
		color: var(--k-band-accent-to);
	}

	@media (max-width: 48rem) {
		.solana {
			grid-template-columns: 1fr;
			gap: var(--k-space-5);
			padding-block: var(--k-space-6);
		}
	}

	@media (max-width: 30rem) {
		.solana-intro {
			grid-template-columns: 1fr;
		}
	}
</style>
