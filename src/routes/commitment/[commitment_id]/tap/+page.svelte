<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import { formatPrice } from '#lib/format';
	import type { PageProps } from './$types';

	/**
	 * Meetup verification, `/commitment/[commitment_id]/tap`.
	 *
	 * Where QR #1 lands. The buyer scans the seller's code with their phone
	 * camera, which opens this page, and the page asks them to confirm.
	 *
	 * SCANNING DOES NOT COMPLETE ANYTHING. The token arrives in the URL, so
	 * anything that happened on load would happen to whoever opened the link,
	 * including a preview fetcher in a messaging app. Completion is a POST the
	 * person makes.
	 *
	 * AND IT IS NOT A PURCHASE. This is the single most important thing the page
	 * has to say. Someone holding a phone at a meetup, pressing a button on a
	 * screen a stranger just showed them, must not be able to mistake this for
	 * paying for the item.
	 */
	let { data, form }: PageProps = $props();

	let submitting = $state(false);
</script>

<svelte:head>
	<title>Verify meetup · kommitly</title>
</svelte:head>

<div class="narrow">
	<PageHeader title="Complete meetup commitment" />

	{#if form?.actionError}
		<div class="banner"><Alert tone="error">{form.actionError}</Alert></div>
	{/if}

	{#if data.outcome === 'completed'}
		<!--
			The refund is reported from the ledger, not inferred from the status.
			Saying the stake is back when the transfer has not landed is a claim
			the user could only disprove by checking their balance.
		-->
		<Panel tone="raised">
			<h2 class="title">Meetup verified</h2>
			<p class="lead">
				{#if data.refundLanded}
					Your commitment stake has been returned to your wallet.
				{:else}
					The meetup is verified. Your stake refund is still processing and will
					complete shortly, nothing is lost.
				{/if}
			</p>

			<p class="muted">
				Your commitment is fulfilled. You can look the item over and walk away
				with no penalty, or buy it if you want it.
			</p>

			<div class="actions">
				<Button href="/commitment/{data.commitmentId}">Back to the commitment</Button>
			</div>
		</Panel>
	{:else if data.outcome === 'ready'}
		<Panel>
			<h2 class="title">{data.listingTitle ?? 'This meetup'}</h2>

			<!--
				Stated before the button, not after it. The whole product rests on
				this distinction and the moment of confusion would be here.
			-->
			<div class="banner">
				<Alert tone="info">
					This confirms you <strong>met</strong>. It returns both commitment
					stakes and buys nothing, no money leaves your wallet.
				</Alert>
			</div>

			<dl class="pairs">
				<div class="pair">
					<dt>Your stake</dt>
					<dd>{formatPrice(data.stakeCents)}, returned when you confirm</dd>
				</div>
				{#if data.priceCents !== null}
					<div class="pair">
						<dt>The item's price</dt>
						<dd>{formatPrice(data.priceCents)}, only if you decide to buy, later</dd>
					</div>
				{/if}
			</dl>

			<form
				method="POST"
				action="?/complete"
				use:enhance={() => {
					submitting = true;

					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				<input type="hidden" name="token" value={data.token} />

				<div class="actions">
					<Button type="submit" disabled={submitting}>
						{submitting ? 'Verifying…' : 'Confirm we met'}
					</Button>
				</div>
			</form>
		</Panel>
	{:else}
		<!--
			Every refusal gets its own explanation from the server, because the
			remedies differ: refresh the code, check in first, or you are the wrong
			person for this code.
		-->
		<Panel>
			<h2 class="title">{data.problemTitle}</h2>
			<p class="lead">{data.problem}</p>

			<div class="actions">
				<Button href="/commitment/{data.commitmentId}" variant="secondary">
					Back to the commitment
				</Button>
			</div>
		</Panel>
	{/if}
</div>

<style>
	.narrow {
		max-width: 34rem;
	}

	.banner {
		margin-bottom: var(--k-space-4);
	}

	.title {
		font-size: var(--k-text-lg);
	}

	.lead {
		margin-top: var(--k-space-3);
		font-size: var(--k-text-sm);
	}

	.muted {
		margin-top: var(--k-space-3);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.pairs {
		display: grid;
		gap: var(--k-space-3);
		margin-top: var(--k-space-4);
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
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
		margin-top: var(--k-space-5);
	}
</style>
