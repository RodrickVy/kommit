<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		faArrowUp,
		faArrowUpRightFromSquare,
		faChild,
		faHandHoldingHeart,
		faPaw,
		faUserDoctor,
		type IconDefinition
	} from '@fortawesome/free-solid-svg-icons';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import { listingImageUrl } from '#lib/listings/images';
	import type { PageProps } from './$types';

	/**
	 * Impact, `/impact`.
	 *
	 * Where a no-show's stake goes, and a vote on it. The charity with the most
	 * votes this month receives every forfeited commitment.
	 */
	let { data, form }: PageProps = $props();

	/** Shown until a charity has a logo. Keyed by the fixed charity ids. */
	const FALLBACK_ICONS: Record<string, IconDefinition> = {
		'a1f0c3d2-0000-4000-8000-000000000001': faChild,
		'a1f0c3d2-0000-4000-8000-000000000002': faPaw,
		'a1f0c3d2-0000-4000-8000-000000000003': faUserDoctor
	};

	/** A logo is either a full https URL or a path in the media bucket. */
	function logoUrl(path: string): string {
		return path.startsWith('https://') ? path : listingImageUrl(path);
	}

	let voting = $state<string | null>(null);

	const monthName = new Intl.DateTimeFormat('en-CA', {
		month: 'long',
		timeZone: 'America/Vancouver'
	}).format(new Date());
</script>

<svelte:head>
	<title>Impact · kommitly</title>
</svelte:head>

<PageHeader
	title="Impact"
	description="When someone doesn’t show up, their commitment goes to charity, never to us. You decide which one."
/>

{#if form?.voteError}
	<div class="banner"><Alert tone="error">{form.voteError}</Alert></div>
{/if}

<p class="intro">
	Vote for the charity you want forfeited commitments to support. The charity with the
	most votes in {monthName} receives them. You get one vote a month, and you can move it
	at any time.
	<span class="total">{data.totalVotes} vote{data.totalVotes === 1 ? '' : 's'} so far this month.</span>
</p>

{#if data.loadError}
	<Alert tone="error">{data.loadError}</Alert>
{:else}
	<ul class="charities" role="list">
		{#each data.charities as charity (charity.id)}
			{@const isActive = charity.id === data.activeCharityId}
			<li class="charity k-cut" class:active={isActive}>
				<div class="media">
					{#if charity.logo_path}
						<img src={logoUrl(charity.logo_path)} alt="{charity.short_name ?? charity.name} logo" loading="lazy" />
					{:else}
						<span class="fallback" aria-hidden="true">
							<Icon icon={FALLBACK_ICONS[charity.id] ?? faHandHoldingHeart} />
						</span>
					{/if}
				</div>

				<div class="body">
					{#if isActive}
						<span class="badge">Currently receiving forfeits</span>
					{/if}
					<h2 class="name">{charity.short_name ?? charity.name}</h2>
					{#if charity.short_name && charity.short_name !== charity.name}
						<p class="legal-name">{charity.name}</p>
					{/if}
					{#if charity.description}
						<p class="description">{charity.description}</p>
					{/if}
					{#if charity.website_url}
						<a class="site" href={charity.website_url} target="_blank" rel="noopener noreferrer">
							Visit {new URL(charity.website_url).hostname.replace(/^www\./, '')}
							<Icon icon={faArrowUpRightFromSquare} />
						</a>
					{/if}
				</div>

				<!--
					The up-vote. A form POST, so it works without JavaScript; signed-out
					visitors are sent to sign in first.
				-->
				<form
					method="POST"
					action="?/vote"
					class="vote"
					use:enhance={() => {
						voting = charity.id;
						return async ({ update }) => {
							await update({ reset: false });
							voting = null;
						};
					}}
				>
					<input type="hidden" name="charityId" value={charity.id} />
					<button
						type="submit"
						class="vote-button k-cut"
						class:voted={charity.isMyVote}
						aria-pressed={charity.isMyVote}
						aria-label={charity.isMyVote
							? `Your vote is for ${charity.short_name ?? charity.name}`
							: `Vote for ${charity.short_name ?? charity.name}`}
						disabled={voting !== null}
					>
						<Icon icon={faArrowUp} />
						<span class="count">{charity.votes}</span>
					</button>
					<span class="vote-label">
						{#if !data.signedIn}
							Sign in to vote
						{:else if charity.isMyVote}
							Your vote
						{:else}
							Vote
						{/if}
					</span>
				</form>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.banner {
		margin-bottom: var(--k-space-4);
	}

	.intro {
		max-width: 60ch;
		margin-bottom: var(--k-space-6);
		color: var(--k-text-muted);
	}

	.total {
		display: block;
		margin-top: var(--k-space-2);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.charities {
		display: grid;
		gap: var(--k-space-4);
		margin: 0;
	}

	.charity {
		display: grid;
		grid-template-columns: 6rem minmax(0, 1fr) auto;
		gap: var(--k-space-5);
		align-items: start;
		padding: var(--k-space-5);
		background-color: var(--k-surface-raised);
	}

	.charity.active {
		box-shadow: inset 4px 0 0 0 var(--k-primary);
	}

	.media {
		display: grid;
		place-items: center;
		width: 6rem;
		height: 6rem;
		background-color: var(--k-bg);
	}

	.media img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		padding: var(--k-space-2);
	}

	.fallback {
		color: var(--k-primary);
		font-size: 2.5rem;
	}

	.body {
		display: grid;
		gap: var(--k-space-2);
		min-width: 0;
	}

	.badge {
		justify-self: start;
		padding: var(--k-space-1) var(--k-space-2);
		background-color: var(--k-primary);
		color: var(--k-on-primary);
		font-size: var(--k-text-xs);
		font-weight: 700;
		letter-spacing: var(--k-tracking-wide);
		text-transform: uppercase;
	}

	.name {
		font-size: var(--k-text-xl);
	}

	.legal-name {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.description {
		max-width: 62ch;
		color: var(--k-text-muted);
	}

	.site {
		display: inline-flex;
		align-items: center;
		gap: var(--k-space-2);
		justify-self: start;
		font-size: var(--k-text-sm);
		font-weight: 600;
	}

	.vote {
		display: grid;
		justify-items: center;
		gap: var(--k-space-1);
	}

	.vote-button {
		display: grid;
		place-items: center;
		gap: var(--k-space-1);
		width: 4rem;
		padding: var(--k-space-3) 0;
		border: 0;
		background-color: var(--k-bg);
		color: var(--k-text-muted);
		font: inherit;
		font-size: var(--k-text-lg);
		cursor: pointer;
		box-shadow: inset 0 0 0 var(--k-line-width) var(--k-line);
		transition:
			background-color var(--k-duration-fast) var(--k-ease),
			color var(--k-duration-fast) var(--k-ease);
	}

	.vote-button:hover:not(:disabled) {
		color: var(--k-primary);
		box-shadow: inset 0 0 0 2px var(--k-primary);
	}

	.vote-button:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 2px var(--k-primary);
	}

	.vote-button.voted {
		background-color: var(--k-primary);
		color: var(--k-on-primary);
		box-shadow: none;
	}

	.vote-button:disabled {
		cursor: progress;
	}

	.count {
		font-size: var(--k-text-base);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.vote-label {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-align: center;
	}

	/* On a phone: logo and vote share the top row, text runs full width below. */
	@media (max-width: 40rem) {
		.charity {
			grid-template-columns: 4.5rem 1fr;
			gap: var(--k-space-4);
		}

		.media {
			width: 4.5rem;
			height: 4.5rem;
		}

		.fallback {
			font-size: 1.75rem;
		}

		.body {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		.vote {
			grid-column: 2;
			grid-row: 1;
			justify-self: end;
		}
	}
</style>
