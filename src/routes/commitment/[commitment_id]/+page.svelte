<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import { formatPrice } from '#lib/format';
	import { COMMITMENT_STATUS_LABELS, EVENT_LABELS, statusTone } from '#lib/commitments/labels';
	import type { PageProps } from './$types';

	/**
	 * Commitment detail — `/commitment/[commitment_id]`.
	 *
	 * One page for both parties. Which actions appear depends on role and
	 * status, decided on the server; every action re-checks before writing.
	 */
	let { data, form }: PageProps = $props();

	const c = $derived(data.commitment);
	const myStake = $derived(data.isBuyer ? c.buyer_stake_cents : c.seller_stake_cents);

	/** Shown in the viewer's own timezone — both parties mean the same instant. */
	function at(iso: string): string {
		return new Intl.DateTimeFormat('en-CA', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(iso));
	}
</script>

<svelte:head>
	<title>Commitment · kommitly</title>
</svelte:head>

<PageHeader title={c.listings?.title ?? 'Commitment'}>
	{#snippet actions()}
		<Badge tone="muted">{data.isBuyer ? 'Buying' : 'Selling'}</Badge>
		<Badge tone={statusTone(c.status)}>
			{data.expired ? 'Expired' : COMMITMENT_STATUS_LABELS[c.status]}
		</Badge>
	{/snippet}
</PageHeader>

{#if form?.actionError}
	<div class="banner"><Alert tone="error">{form.actionError}</Alert></div>
{:else if form?.message}
	<div class="banner"><Alert tone="success">{form.message}</Alert></div>
{/if}

<div class="layout">
	<div class="main">
		<Panel>
			<h2 class="panel-title">The meetup</h2>
			<dl class="pairs">
				<div class="pair">
					<dt>When</dt>
					<dd>{at(c.scheduled_at)}</dd>
				</div>
				<div class="pair">
					<dt>Where</dt>
					<dd>{c.meetup_locations?.name ?? 'Location removed'}</dd>
				</div>
				<div class="pair">
					<dt>Item</dt>
					<dd>
						{#if c.listings}
							<a href="/sell/{c.listings.id}">{c.listings.title}</a>
							· {formatPrice(c.listings.price_cents)}
						{:else}
							Listing removed
						{/if}
					</dd>
				</div>
			</dl>

			<!--
				Said prominently because it is the most misunderstood thing about the
				product: the stake is not a deposit on the item.
			-->
			<div class="note">
				<Alert tone="info">
					A commitment to <strong>meet</strong>, not to buy. Show up, verify the
					meetup, and your stake comes back — whether or not anything is bought.
				</Alert>
			</div>
		</Panel>

		<Panel>
			<h2 class="panel-title">History</h2>
			{#if data.events.length === 0}
				<p class="muted">Nothing recorded yet.</p>
			{:else}
				<ol class="timeline" role="list">
					{#each data.events as event (event.id)}
						<li>
							<span>{EVENT_LABELS[event.event_type]}</span>
							<span class="when">{at(event.occurred_at)}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</Panel>
	</div>

	<aside class="side">
		<Panel>
			<h2 class="panel-title">Your stake</h2>
			<p class="stake">{formatPrice(myStake)}</p>
			<p class="muted">
				{#if c.status === 'pending'}
					Not taken yet. It is only held once the seller accepts.
				{:else if c.status === 'accepted'}
					Held until the meetup is verified, then returned.
				{:else}
					Nothing is held.
				{/if}
			</p>

			<!--
				Honest about what is not built. Showing a figure without this would
				imply money has moved, and none has.
			-->
			<p class="deferred">
				Stakes are recorded but not collected — the wallet is not built yet.
				Both sides currently use the market default rather than a
				reputation-adjusted amount.
			</p>
		</Panel>

		<Panel>
			<h2 class="panel-title">What you can do</h2>

			{#if data.expired}
				<p class="muted">
					This request expired without a response. The buyer can send a new one.
				</p>
			{:else if c.status === 'pending' && !data.isBuyer}
				<p class="muted">
					Accepting commits you both. Declining is free and is not held against
					you.
				</p>
				<div class="actions">
					<form method="POST" action="?/accept" use:enhance>
						<Button type="submit">Accept</Button>
					</form>
					<form method="POST" action="?/decline" use:enhance>
						<Button type="submit" variant="secondary">Decline</Button>
					</form>
				</div>
			{:else if c.status === 'pending'}
				<p class="muted">Waiting for the seller. They have until {at(c.request_expires_at)}.</p>
				<div class="actions">
					<form method="POST" action="?/withdraw" use:enhance>
						<Button type="submit" variant="secondary">Withdraw request</Button>
					</form>
				</div>
			{:else if c.status === 'accepted'}
				<p class="muted">
					You are both committed. Cancelling now forfeits your stake and refunds
					the other person.
				</p>
				<div class="actions">
					<form
						method="POST"
						action="?/cancel"
						onsubmit={(event) => {
							if (!confirm('Cancel this commitment? You would forfeit your stake.')) {
								event.preventDefault();
							}
						}}
					>
						<Button type="submit" variant="quiet">Cancel commitment</Button>
					</form>
				</div>
			{:else}
				<p class="muted">
					This commitment is closed.
					{#if c.responsible_party}
						Recorded against the {c.responsible_party}.
					{/if}
				</p>
			{/if}
		</Panel>
	</aside>
</div>

<style>
	.banner {
		margin-bottom: var(--k-space-4);
	}

	.layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--k-space-4);
		align-items: start;
	}

	@media (min-width: 60rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr) 20rem;
		}
	}

	.main,
	.side {
		display: grid;
		gap: var(--k-space-4);
		min-width: 0;
	}

	.panel-title {
		margin-bottom: var(--k-space-3);
		font-size: var(--k-text-lg);
	}

	.pairs {
		display: grid;
		gap: var(--k-space-3);
	}

	.pair {
		display: grid;
		gap: var(--k-space-1);
	}

	.pair dt {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.pair dd {
		margin: 0;
		font-size: var(--k-text-sm);
		overflow-wrap: anywhere;
	}

	.note {
		margin-top: var(--k-space-5);
	}

	.timeline {
		display: grid;
		gap: var(--k-space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.timeline li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--k-space-3);
		padding-bottom: var(--k-space-2);
		border-bottom: var(--k-line-width) solid var(--k-line);
		font-size: var(--k-text-sm);
	}

	.when {
		color: var(--k-text-subtle);
	}

	.stake {
		font-size: var(--k-text-2xl);
		font-weight: 600;
	}

	.muted {
		margin-top: var(--k-space-2);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.deferred {
		margin-top: var(--k-space-4);
		padding-top: var(--k-space-3);
		border-top: var(--k-line-width) solid var(--k-line);
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
		margin-top: var(--k-space-4);
	}
</style>
