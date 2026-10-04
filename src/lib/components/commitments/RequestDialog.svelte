<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import RequestPanel from '#lib/components/commitments/RequestPanel.svelte';

	/**
	 * RequestDialog — request a meetup straight from a Discover card.
	 *
	 * Fetches the listing's places and times only when opened, so a grid of
	 * cards costs nothing until someone actually wants to request one.
	 */
	interface Props {
		listingId: string;
		title: string;
	}

	let { listingId, title }: Props = $props();

	type Options = {
		status: string;
		signedIn: boolean;
		isOwner: boolean;
		locations: { id: string; name: string }[];
		hasAvailability: boolean;
		slots: { startsAt: string }[];
		stakeCents: number | null;
		minimumLeadHours: number | null;
	};

	let dialog = $state<HTMLDialogElement>();
	let options = $state<Options | null>(null);
	let loadError = $state<string | null>(null);

	async function open() {
		dialog?.showModal();
		options = null;
		loadError = null;

		try {
			const response = await fetch(`/sell/${listingId}/request-options`);
			if (!response.ok) throw new Error();
			options = await response.json();
		} catch {
			loadError = 'The times for this listing could not be loaded. Try again.';
		}
	}
</script>

<Button type="button" size="sm" onclick={open}>Request a meetup</Button>

<!-- Clicking the backdrop (the dialog element itself) closes it. -->
<dialog
	bind:this={dialog}
	class="dialog k-cut"
	aria-labelledby="request-title-{listingId}"
	onclick={(event) => {
		if (event.target === dialog) dialog?.close();
	}}
>
	<div class="inner">
		<div class="head">
			<h2 id="request-title-{listingId}" class="title">{title}</h2>
			<Button type="button" variant="quiet" size="sm" onclick={() => dialog?.close()}>Close</Button>
		</div>

		{#if loadError}
			<p class="muted">{loadError}</p>
		{:else if !options}
			<p class="muted">Loading times…</p>
		{:else}
			<RequestPanel listingId={listingId} {...options} />
		{/if}

		<a class="details" href="/sell/{listingId}">View full listing</a>
	</div>
</dialog>

<style>
	.dialog {
		width: min(28rem, calc(100vw - 2rem));
		max-height: calc(100svh - 2rem);
		padding: 0;
		border: 0;
		background-color: var(--k-bg);
		color: var(--k-text);
	}

	.dialog::backdrop {
		background-color: rgb(0 0 0 / 0.5);
	}

	.inner {
		display: grid;
		gap: var(--k-space-4);
		padding: var(--k-space-5);
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--k-space-3);
	}

	.title {
		font-size: var(--k-text-lg);
	}

	.muted {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.details {
		font-size: var(--k-text-sm);
	}
</style>
