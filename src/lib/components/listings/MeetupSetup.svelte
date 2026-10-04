<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import { formatTimeOfDay } from '#lib/format';
	import { DAY_LABELS } from '#lib/listings/labels';

	/**
	 * MeetupSetup — where a seller will meet, and when.
	 *
	 * Both belong to the seller and apply to every listing they have. Shown on
	 * the account page and on the seller's own listing page; the host route
	 * provides the `addLocation`, `removeLocation`, `addAvailability` and
	 * `removeAvailability` actions (see `#lib/server/meetup-setup`).
	 */
	interface Props {
		locations: { id: string; name: string; latitude: number; longitude: number }[];
		availability: {
			id: string;
			day_of_week: number;
			start_time: string;
			end_time: string;
			timezone: string;
			specific_date: string | null;
		}[];
		/** The account page offers sample data; the listing page does not. */
		showExamples?: boolean;
	}

	let { locations, availability, showExamples = false }: Props = $props();

	let latitude = $state('');
	let longitude = $state('');
	let locating = $state(false);
	let locateError = $state<string | null>(null);
	let repeat = $state<'date' | 'weekly'>('date');

	const today = new Date().toISOString().slice(0, 10);

	function useMyLocation() {
		if (!('geolocation' in navigator)) {
			locateError = 'This browser cannot share its location. Enter the coordinates instead.';
			return;
		}

		locating = true;
		locateError = null;

		navigator.geolocation.getCurrentPosition(
			(position) => {
				latitude = position.coords.latitude.toFixed(6);
				longitude = position.coords.longitude.toFixed(6);
				locating = false;
			},
			() => {
				locateError = 'Your location could not be read. Enter the coordinates instead.';
				locating = false;
			},
			{ enableHighAccuracy: true, timeout: 10000 }
		);
	}

	/** A dated rule reads as its date; a weekly one as "Every Tuesday". */
	function whenLabel(slot: Props['availability'][number]): string {
		if (slot.specific_date) {
			return new Intl.DateTimeFormat('en-CA', {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				timeZone: 'UTC'
			}).format(new Date(`${slot.specific_date}T00:00:00Z`));
		}
		return `Every ${DAY_LABELS[slot.day_of_week]}`;
	}
</script>

<section class="section" id="meetup-setup">
	<Panel>
		<div class="section-head">
			<div>
				<h2 class="panel-title">Meetup locations</h2>
				<p class="section-note">
					Public places you are willing to meet. Every listing you have offers all of them.
				</p>
			</div>
			{#if showExamples}
				<form method="POST" action="?/addExampleLocations" use:enhance>
					<Button type="submit" variant="secondary" size="sm">Add examples</Button>
				</form>
			{/if}
		</div>

		{#if locations.length > 0}
			<ul class="rows" role="list">
				{#each locations as location (location.id)}
					<li class="row">
						<div class="row-body">
							<span class="row-title">{location.name}</span>
							<a
								class="row-detail"
								href="https://www.openstreetmap.org/?mlat={location.latitude}&mlon={location.longitude}#map=18/{location.latitude}/{location.longitude}"
								target="_blank"
								rel="noopener noreferrer"
							>
								{location.latitude.toFixed(4)}, {location.longitude.toFixed(4)} · View on map
							</a>
						</div>
						<form method="POST" action="?/removeLocation" use:enhance>
							<input type="hidden" name="locationId" value={location.id} />
							<Button type="submit" variant="quiet" size="sm">Remove</Button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted empty">None yet. Buyers cannot request a meetup until you add one.</p>
		{/if}

		<form method="POST" action="?/addLocation" use:enhance class="inline-form">
			<Field id="location-name" label="Place">
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

			<div class="locate">
				<Button type="button" variant="secondary" size="sm" onclick={useMyLocation} disabled={locating}>
					{locating ? 'Locating…' : 'Use my current location'}
				</Button>
				{#if locateError}
					<span class="muted">{locateError}</span>
				{/if}
			</div>

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
							bind:value={latitude}
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
							bind:value={longitude}
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
				<h2 class="panel-title">When you can meet</h2>
				<p class="section-note">
					Add a specific date, or a time that repeats every week. Buyers pick a
					half-hour start time inside one of these.
				</p>
			</div>
			{#if showExamples}
				<form method="POST" action="?/addExampleAvailability" use:enhance>
					<Button type="submit" variant="secondary" size="sm">Add examples</Button>
				</form>
			{/if}
		</div>

		{#if availability.length > 0}
			<ul class="rows" role="list">
				{#each availability as slot (slot.id)}
					<li class="row">
						<div class="row-body">
							<span class="row-title">{whenLabel(slot)}</span>
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
			<p class="muted empty">None yet. Buyers cannot request a meetup until you add a time.</p>
		{/if}

		<!--
			The radios have no `checked` attribute to reset to, so the form reset
			after saving would lose the choice. It is put back once the save lands.
		-->
		<form
			method="POST"
			action="?/addAvailability"
			class="inline-form"
			use:enhance={() => {
				const chosen = repeat;
				return async ({ update }) => {
					await update();
					repeat = chosen;
				};
			}}
		>
			<fieldset class="repeat">
				<legend class="k-visually-hidden">How often</legend>
				<label><input type="radio" name="repeat" value="date" bind:group={repeat} /> On a date</label>
				<label><input type="radio" name="repeat" value="weekly" bind:group={repeat} /> Every week</label>
			</fieldset>

			{#if repeat === 'date'}
				<Field id="date" label="Date">
					{#snippet children({ id, describedBy, invalid })}
						<input
							{id}
							name="date"
							type="date"
							required
							min={today}
							aria-describedby={describedBy}
							aria-invalid={invalid}
						/>
					{/snippet}
				</Field>
			{:else}
				<Field id="dayOfWeek" label="Day">
					{#snippet children({ id, describedBy, invalid })}
						<select {id} name="dayOfWeek" required aria-describedby={describedBy} aria-invalid={invalid}>
							{#each DAY_LABELS as label, index (label)}
								<option value={index}>{label}</option>
							{/each}
						</select>
					{/snippet}
				</Field>
			{/if}

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

			<Button type="submit" variant="secondary">Add time</Button>
		</form>
	</Panel>
</section>

<style>
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

	a.row-detail {
		text-decoration: none;
	}

	a.row-detail:hover {
		color: var(--k-text);
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

	.locate {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--k-space-2);
	}

	.repeat {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-4);
		margin: 0;
		padding: 0;
		border: 0;
		font-size: var(--k-text-sm);
	}

	.repeat label {
		display: inline-flex;
		align-items: center;
		gap: var(--k-space-2);
		cursor: pointer;
	}
</style>
