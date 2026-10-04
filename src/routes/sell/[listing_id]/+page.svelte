<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import ImageUploader from '#lib/components/listings/ImageUploader.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import { formatPrice, formatTimeOfDay } from '#lib/format';
	import { listingImageUrl } from '#lib/listings/images';
	import {
		CONDITION_LABELS,
		DAY_LABELS,
		STATUS_DESCRIPTIONS,
		STATUS_LABELS
	} from '#lib/listings/labels';
	import type { PageProps } from './$types';

	/**
	 * Listing detail — `/sell/[listing_id]`.
	 *
	 * One URL, two views. `data.isOwner` is decided on the server from the
	 * verified session, so the management controls cannot be revealed by editing
	 * anything in the browser — and even if the markup were forced to render,
	 * every action re-checks ownership before it writes.
	 */
	let { data, form }: PageProps = $props();

	let saving = $state(false);

	const statusTone = $derived(
		data.listing.status === 'active'
			? 'live'
			: data.listing.status === 'draft'
				? 'warning'
				: data.listing.status === 'reserved'
					? 'neutral'
					: 'muted'
	);

	/** The edit field expects plain decimal text, not a formatted currency. */
	const priceForInput = $derived((data.listing.price_cents / 100).toFixed(2));
</script>

<svelte:head>
	<title>{data.listing.title} · kommitly</title>
</svelte:head>

<PageHeader title={data.listing.title}>
	{#snippet actions()}
		{#if data.isOwner}
			<Badge tone={statusTone}>{STATUS_LABELS[data.listing.status]}</Badge>
		{/if}
	{/snippet}
</PageHeader>

{#if form?.message}
	<div class="banner">
		<Alert tone={form.tone === 'success' ? 'success' : 'error'}>{form.message}</Alert>
	</div>
{/if}

<div class="layout">
	<div class="main">
		<Panel padding="none">
			{#if data.images.length > 0}
				<ul class="gallery" role="list">
					{#each data.images as image (image.id)}
						<li class="shot">
							<img src={listingImageUrl(image.storage_path)} alt="" loading="lazy" />
							{#if data.isOwner}
								<form method="POST" action="?/removeImage" use:enhance class="shot-remove">
									<input type="hidden" name="imageId" value={image.id} />
									<Button type="submit" variant="secondary" size="sm">Remove</Button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="no-photos">
					{data.isOwner
						? 'No photographs yet. Listings with photographs get far more interest.'
						: 'This listing has no photographs.'}
				</p>
			{/if}
		</Panel>

		{#if data.isOwner}
			<Panel>
				<h2 class="panel-title">Photographs</h2>
				<ImageUploader />
			</Panel>
		{/if}

		{#if data.listing.description}
			<Panel>
				<h2 class="panel-title">Description</h2>
				<p class="description">{data.listing.description}</p>
			</Panel>
		{/if}

		{#if data.isOwner}
			<Panel>
				<h2 class="panel-title">Details</h2>

				<form
					method="POST"
					action="?/updateDetails"
					use:enhance={() => {
						saving = true;
						return async ({ update }) => {
							await update();
							saving = false;
						};
					}}
				>
					<div class="fields">
						<Field id="title" label="Title" error={form?.errors?.title}>
							{#snippet children({ id, describedBy, invalid })}
								<input
									{id}
									name="title"
									type="text"
									maxlength="120"
									required
									value={data.listing.title}
									aria-describedby={describedBy}
									aria-invalid={invalid}
								/>
							{/snippet}
						</Field>

						<Field id="price" label="Price (CAD)" error={form?.errors?.price}>
							{#snippet children({ id, describedBy, invalid })}
								<input
									{id}
									name="price"
									type="text"
									inputmode="decimal"
									required
									value={priceForInput}
									aria-describedby={describedBy}
									aria-invalid={invalid}
								/>
							{/snippet}
						</Field>

						<Field id="condition" label="Condition" error={form?.errors?.condition}>
							{#snippet children({ id, describedBy, invalid })}
								<select
									{id}
									name="condition"
									required
									aria-describedby={describedBy}
									aria-invalid={invalid}
								>
									{#each data.conditions as value (value)}
										<option {value} selected={data.listing.condition === value}>
											{CONDITION_LABELS[value]}
										</option>
									{/each}
								</select>
							{/snippet}
						</Field>

						<Field id="description" label="Description">
							{#snippet children({ id, describedBy, invalid })}
								<textarea
									{id}
									name="description"
									maxlength="4000"
									aria-describedby={describedBy}
									aria-invalid={invalid}>{data.listing.description ?? ''}</textarea
								>
							{/snippet}
						</Field>
					</div>

					<div class="form-actions">
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving…' : 'Save changes'}
						</Button>
					</div>
				</form>
			</Panel>
		{/if}
	</div>

	<aside class="side">
		<Panel>
			<p class="price">{formatPrice(data.listing.price_cents)}</p>
			<p class="condition">{CONDITION_LABELS[data.listing.condition]}</p>

			<dl class="seller">
				<dt>Seller</dt>
				<dd>{data.listing.profiles?.display_name ?? 'Unknown'}</dd>
				<dt>Reputation</dt>
				<dd>
					{#if data.listing.profiles?.reputation == null}
						<span class="muted">Not calculated yet</span>
					{:else}
						{data.listing.profiles.reputation}
					{/if}
				</dd>
			</dl>

			{#if !data.isOwner}
				<div class="commit">
					<!--
						Present but inert. The commitment flow is not built: no stake is
						calculated, nothing is locked, and no row is written. Rendering it
						disabled rather than hiding it shows where the flow goes without
						pretending it works.
					-->
					<Button disabled>Request a commitment</Button>
					<p class="commit-note">
						Not available yet. When it is, you will pick a time and place from
						the seller's options below, and both of you will put down a
						refundable stake.
					</p>
				</div>
			{/if}
		</Panel>

		{#if data.isOwner}
			<Panel>
				<h2 class="panel-title">Status</h2>
				<p class="status-note">{STATUS_DESCRIPTIONS[data.listing.status]}</p>

				<div class="status-actions">
					{#if data.listing.status !== 'active'}
						<form method="POST" action="?/publish" use:enhance>
							<Button type="submit">Publish</Button>
						</form>
					{:else}
						<form method="POST" action="?/withdraw" use:enhance>
							<Button type="submit" variant="secondary">Withdraw</Button>
						</form>
					{/if}

					<!--
						A native confirm rather than a custom modal. Deleting destroys the
						photographs too and cannot be undone, so it earns a stop — and the
						native dialog is keyboard accessible and impossible to mis-style.
					-->
					<form
						method="POST"
						action="?/deleteListing"
						onsubmit={(event) => {
							if (!confirm('Delete this listing and its photographs? This cannot be undone.')) {
								event.preventDefault();
							}
						}}
					>
						<Button type="submit" variant="quiet">Delete</Button>
					</form>
				</div>
			</Panel>
		{/if}

		<Panel>
			<h2 class="panel-title">Where</h2>
			{#if data.locations.length > 0}
				<ul class="plain" role="list">
					{#each data.locations as location (location.id)}
						<li>{location.name}</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">No meetup locations set.</p>
			{/if}

			<h2 class="panel-title spaced">When</h2>
			{#if data.availability.length > 0}
				<ul class="plain" role="list">
					{#each data.availability as slot (slot.id)}
						<li>
							{DAY_LABELS[slot.day_of_week]}, {formatTimeOfDay(slot.start_time)} –
							{formatTimeOfDay(slot.end_time)}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">No availability set.</p>
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
		/* Side column first on narrow screens is wrong — the photographs and
		   description matter more — so a single column keeps source order, and
		   the sidebar only splits off once there is room for it. */
		grid-template-columns: 1fr;
		gap: var(--k-space-4);
		align-items: start;
	}

	@media (min-width: 60rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr) 20rem;
		}

		.side {
			/* Follows the reader down a long description. */
			position: sticky;
			top: calc(var(--k-header-h) + var(--k-space-4));
		}
	}

	.main,
	.side {
		display: grid;
		gap: var(--k-space-4);
		min-width: 0;
	}

	.gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(12rem, 100%), 1fr));
		gap: var(--k-space-1);
		margin: 0;
	}

	.shot {
		position: relative;
		aspect-ratio: 4 / 3;
		background-color: var(--k-surface-sunken);
	}

	.shot img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.shot-remove {
		position: absolute;
		right: var(--k-space-2);
		bottom: var(--k-space-2);
	}

	.no-photos {
		padding: var(--k-space-6) var(--k-space-5);
		color: var(--k-text-muted);
		text-align: center;
	}

	.panel-title {
		margin-bottom: var(--k-space-3);
		font-size: var(--k-text-lg);
	}

	.panel-title.spaced {
		margin-top: var(--k-space-5);
	}

	.description {
		/* Preserves the seller's own line breaks without allowing raw HTML. */
		white-space: pre-wrap;
		color: var(--k-text-muted);
	}

	.price {
		font-size: var(--k-text-2xl);
		font-weight: 600;
	}

	.condition {
		margin-top: var(--k-space-1);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.seller {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--k-space-1) var(--k-space-3);
		margin-top: var(--k-space-4);
		padding-top: var(--k-space-4);
		border-top: var(--k-line-width) solid var(--k-line);
		font-size: var(--k-text-sm);
	}

	.seller dt {
		color: var(--k-text-subtle);
	}

	.seller dd {
		margin: 0;
	}

	.commit {
		margin-top: var(--k-space-5);
	}

	.commit-note {
		margin-top: var(--k-space-3);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.status-note {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.status-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
		margin-top: var(--k-space-4);
	}

	.plain {
		display: grid;
		gap: var(--k-space-2);
		margin: 0;
		font-size: var(--k-text-sm);
	}

	.muted {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.fields {
		display: grid;
		gap: var(--k-space-5);
	}

	.form-actions {
		margin-top: var(--k-space-5);
	}
</style>
