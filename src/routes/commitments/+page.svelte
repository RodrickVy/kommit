<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import { formatPrice } from '#lib/format';
	import { COMMITMENT_STATUS_LABELS, statusTone } from '#lib/commitments/labels';
	import { ROLE_FILTERS, SORTS, STATUS_FILTERS } from '#lib/commitments/list-view';
	import type { PageProps } from './$types';

	/**
	 * Commitments — `/commitments`.
	 */
	let { data }: PageProps = $props();

	/** Whether anything other than the default view is selected. */
	const filtered = $derived(data.view.status !== 'all' || data.view.role !== 'all');

	const statusTabs = $derived(
		Object.entries(STATUS_FILTERS).map(([key, option]) => ({
			key,
			label: key === 'all' ? 'All' : key === 'closed' ? 'Did not happen' : option.label.replace(/ \(.*\)$/, ''),
			count: data.view.counts[key as keyof typeof STATUS_FILTERS]
		}))
	);

	const roleTabs = Object.entries(ROLE_FILTERS).map(([key, label]) => ({
		key,
		label: key === 'all' ? 'Buying & selling' : label
	}));

	const sortTabs = Object.entries(SORTS).map(([key, option]) => ({
		key,
		label: option.label.replace('Meetup date, ', 'Meetup ')
	}));

	/** Shown in the viewer's own timezone — both parties mean the same instant. */
	function when(iso: string): string {
		return new Intl.DateTimeFormat('en-CA', {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(iso));
	}
</script>

<svelte:head>
	<title>Commitments · kommitly</title>
</svelte:head>

<PageHeader
	title="Commitments"
	description="Meetups you have agreed to, as a buyer and as a seller."
/>

<div class="tabs">
	<TabBar
		param="status"
		tabs={statusTabs}
		active={data.view.status}
		label="Filter by status"
	/>
	<div class="secondary">
		<TabBar
			param="role"
			tabs={roleTabs}
			active={data.view.role}
			label="Filter by role"
			variant="secondary"
		/>
		<TabBar
			param="sort"
			tabs={sortTabs}
			active={data.view.sort}
			label="Sort commitments"
			variant="secondary"
		/>
	</div>
</div>

{#if data.loadError}
	<Alert tone="error">{data.loadError}</Alert>
{:else if data.commitments.length === 0 && filtered}
	<Panel>
		<p class="empty">
			No commitments match these filters. <a href="/commitments">Show all commitments</a>
		</p>
	</Panel>
{:else if data.commitments.length === 0}
	<Panel>
		<p class="empty">
			Nothing yet. Find something in <a href="/discover">Discover</a> and request
			a meetup — the seller accepts, you both put down a refundable stake, and you
			both show up.
		</p>
	</Panel>
{:else}
	<ul class="list" role="list">
		{#each data.commitments as commitment (commitment.id)}
			{@const isBuyer = commitment.buyer_id === data.user.id}
			<li>
				<Panel>
					<div class="row">
						<div class="body">
							<div class="heading">
								<!--
									The role is stated plainly. The same person is a buyer in
									one commitment and a seller in another, so a list without
									it is genuinely ambiguous.
								-->
								<Badge tone="muted">{isBuyer ? 'Buying' : 'Selling'}</Badge>
								<Badge tone={statusTone(commitment.status)}>
									{COMMITMENT_STATUS_LABELS[commitment.status]}
								</Badge>
							</div>

							<h2 class="title">{commitment.listings?.title ?? 'Listing removed'}</h2>

							<p class="detail">
								{when(commitment.scheduled_at)}
								{#if commitment.meetup_locations?.name}
									· {commitment.meetup_locations.name}
								{/if}
							</p>

							<p class="detail">
								Your stake
								{formatPrice(isBuyer ? commitment.buyer_stake_cents : commitment.seller_stake_cents)}
								{#if commitment.status === 'pending'}
									· not taken until the seller accepts
								{/if}
							</p>
						</div>

						<Button href="/commitment/{commitment.id}" variant="secondary" size="sm">View</Button>
						{#if commitment.status === 'completed'}
							<a class="receipt-link" href="/commitment/{commitment.id}#receipts">Receipts</a>
						{/if}
					</div>
				</Panel>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.tabs {
		display: grid;
		gap: var(--k-space-1);
		margin-bottom: var(--k-space-5);
	}

	/* Role and sort share a row when there is room. */
	.secondary {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--k-space-1) var(--k-space-4);
	}

	.secondary > :global(*) {
		min-width: 0;
		max-width: 100%;
	}




	.list {
		display: grid;
		gap: var(--k-space-3);
		margin: 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--k-space-4);
	}

	.body {
		min-width: 0;
	}

	.heading {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
		margin-bottom: var(--k-space-2);
	}

	.title {
		font-size: var(--k-text-lg);
		overflow-wrap: anywhere;
	}

	.detail {
		margin-top: var(--k-space-1);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.empty {
		color: var(--k-text-muted);
	}

	.receipt-link {
		font-size: var(--k-text-sm);
	}
</style>
