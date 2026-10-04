<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import { formatTimeOfDay } from '#lib/format';
	import { DAY_LABELS } from '#lib/listings/labels';
	import type { PageProps } from './$types';

	/**
	 * Account — `/account`.
	 *
	 * Identity, commitment record, and the seller settings that every listing
	 * inherits: where this person will meet, and when they are free.
	 */
	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Account · kommitly</title>
</svelte:head>

<PageHeader title="Account" />

{#if form?.message}
	<div class="banner">
		<Alert tone={form.tone === 'success' ? 'success' : 'error'}>{form.message}</Alert>
	</div>
{/if}

{#if data.loadError}
	<Alert tone="error">{data.loadError}</Alert>
{:else}
	<div class="panels">
		<Panel>
			<h2 class="panel-title">You</h2>
			<dl class="pairs">
				<div class="pair">
					<dt>Display name</dt>
					<dd>{data.profile?.display_name ?? '—'}</dd>
				</div>
				<div class="pair">
					<dt>Email</dt>
					<!--
						Shown to the account holder only. It is never exposed to another
						user — it is not even stored on the profile row, which is
						world-readable.
					-->
					<dd>{data.user.email ?? 'None on this account'}</dd>
				</div>
			</dl>
		</Panel>

		<Panel>
			<h2 class="panel-title">Commitment record</h2>
			<dl class="pairs">
				<div class="pair">
					<dt>Reputation</dt>
					<dd>
						{#if data.profile?.reputation == null}
							<!-- Null means not yet calculated, deliberately distinguishable
							     from a genuine low score. -->
							<span class="muted">Not calculated yet</span>
						{:else}
							{data.profile.reputation}
						{/if}
					</dd>
				</div>
				<div class="pair">
					<dt>Commitments</dt>
					<dd>{data.profile?.commitments_total ?? 0}</dd>
				</div>
				<div class="pair">
					<dt>Successful</dt>
					<dd>{data.profile?.commitments_successful ?? 0}</dd>
				</div>
			</dl>
		</Panel>
	</div>

	<section class="section">
		<Panel>
			<div class="section-head">
				<div>
					<h2 class="panel-title">Meetup locations</h2>
					<p class="section-note">
						Public places you are willing to meet. Every listing you create offers
						all of them, unless you narrow it down on the listing itself.
					</p>
				</div>
				<form method="POST" action="?/addExampleLocations" use:enhance>
					<Button type="submit" variant="secondary" size="sm">Add examples</Button>
				</form>
			</div>

			{#if data.locations.length > 0}
				<ul class="rows" role="list">
					{#each data.locations as location (location.id)}
						<li class="row">
							<div class="row-body">
								<span class="row-title">{location.name}</span>
								<span class="row-detail">
									{location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
								</span>
							</div>
							<form method="POST" action="?/removeLocation" use:enhance>
								<input type="hidden" name="locationId" value={location.id} />
								<Button type="submit" variant="quiet" size="sm">Remove</Button>
							</form>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted empty">
					None yet. Add one below, or use the examples to see what they look like.
				</p>
			{/if}

			<form method="POST" action="?/addLocation" use:enhance class="inline-form">
				<Field id="name" label="Place">
					{#snippet children({ id, describedBy, invalid })}
						<input
							{id}
							name="name"
							type="text"
							required
							placeholder="Library main entrance"
							aria-describedby={describedBy}
							aria-invalid={invalid}
						/>
					{/snippet}
				</Field>

				<div class="pair-fields">
					<Field id="latitude" label="Latitude">
						{#snippet children({ id, describedBy, invalid })}
							<input
								{id}
								name="latitude"
								type="text"
								inputmode="decimal"
								required
								placeholder="49.2796"
								aria-describedby={describedBy}
								aria-invalid={invalid}
							/>
						{/snippet}
					</Field>

					<Field id="longitude" label="Longitude">
						{#snippet children({ id, describedBy, invalid })}
							<input
								{id}
								name="longitude"
								type="text"
								inputmode="decimal"
								required
								placeholder="-123.1156"
								aria-describedby={describedBy}
								aria-invalid={invalid}
							/>
						{/snippet}
					</Field>
				</div>

				<Button type="submit" variant="secondary">Add location</Button>
			</form>
		</Panel>
	</section>

	<section class="section">
		<Panel>
			<div class="section-head">
				<div>
					<h2 class="panel-title">Weekly availability</h2>
					<p class="section-note">
						When you are generally free to meet. These repeat every week — you
						never enter dates.
					</p>
				</div>
				<form method="POST" action="?/addExampleAvailability" use:enhance>
					<Button type="submit" variant="secondary" size="sm">Add examples</Button>
				</form>
			</div>

			{#if data.availability.length > 0}
				<ul class="rows" role="list">
					{#each data.availability as slot (slot.id)}
						<li class="row">
							<div class="row-body">
								<span class="row-title">{DAY_LABELS[slot.day_of_week]}</span>
								<span class="row-detail">
									{formatTimeOfDay(slot.start_time)} – {formatTimeOfDay(slot.end_time)}
									<span class="muted">· {slot.timezone}</span>
								</span>
							</div>
							<form method="POST" action="?/removeAvailability" use:enhance>
								<input type="hidden" name="availabilityId" value={slot.id} />
								<Button type="submit" variant="quiet" size="sm">Remove</Button>
							</form>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted empty">
					None yet. Buyers cannot request a meetup until you set some.
				</p>
			{/if}

			<form method="POST" action="?/addAvailability" use:enhance class="inline-form">
				<Field id="dayOfWeek" label="Day">
					{#snippet children({ id, describedBy, invalid })}
						<select {id} name="dayOfWeek" required aria-describedby={describedBy} aria-invalid={invalid}>
							{#each DAY_LABELS as label, index (label)}
								<option value={index}>{label}</option>
							{/each}
						</select>
					{/snippet}
				</Field>

				<div class="pair-fields">
					<Field id="startTime" label="From">
						{#snippet children({ id, describedBy, invalid })}
							<input
								{id}
								name="startTime"
								type="time"
								required
								value="17:00"
								aria-describedby={describedBy}
								aria-invalid={invalid}
							/>
						{/snippet}
					</Field>

					<Field id="endTime" label="Until">
						{#snippet children({ id, describedBy, invalid })}
							<input
								{id}
								name="endTime"
								type="time"
								required
								value="20:00"
								aria-describedby={describedBy}
								aria-invalid={invalid}
							/>
						{/snippet}
					</Field>
				</div>

				<Button type="submit" variant="secondary">Add availability</Button>
			</form>
		</Panel>
	</section>

	<div class="signout">
		<!--
			A POST, not a link. A GET that changes state can be triggered by
			anything that prefetches a URL, and SvelteKit's CSRF origin check only
			covers form submissions.
		-->
		<form method="POST" action="?/signout">
			<Button type="submit" variant="secondary">Sign out</Button>
		</form>
	</div>
{/if}

<style>
	.banner {
		margin-bottom: var(--k-space-4);
	}

	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
		gap: var(--k-space-4);
	}

	.section {
		margin-top: var(--k-space-4);
	}

	.section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--k-space-3);
		margin-bottom: var(--k-space-4);
	}

	.section-note {
		margin-top: var(--k-space-1);
		max-width: 56ch;
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.panel-title {
		font-size: var(--k-text-lg);
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
		overflow-wrap: anywhere;
	}

	.rows {
		display: grid;
		gap: var(--k-space-1);
		margin: 0;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--k-space-3);
		padding: var(--k-space-3);
		background-color: var(--k-surface-raised);
	}

	.row-body {
		display: grid;
		gap: var(--k-space-1);
		min-width: 0;
	}

	.row-title {
		font-size: var(--k-text-sm);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.row-detail {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.muted {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.empty {
		padding: var(--k-space-4) 0;
	}

	.inline-form {
		display: grid;
		gap: var(--k-space-4);
		justify-items: start;
		margin-top: var(--k-space-5);
		padding-top: var(--k-space-5);
		border-top: var(--k-line-width) solid var(--k-line);
	}

	.inline-form :global(.field) {
		width: 100%;
		max-width: 32rem;
	}

	.pair-fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));
		gap: var(--k-space-4);
		width: 100%;
		max-width: 32rem;
	}

	.signout {
		margin-top: var(--k-space-6);
		padding-top: var(--k-space-5);
		border-top: var(--k-line-width) solid var(--k-line);
	}
</style>
