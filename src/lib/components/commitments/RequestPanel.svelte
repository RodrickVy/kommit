<script lang="ts">
	import type { CommitmentFee } from '#lib/commitments/fee';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import { formatPrice } from '#lib/format';

	/**
	 * RequestPanel, choose a place and a time, and request a meetup.
	 *
	 * Used on the listing page and in the request dialog on Discover cards. It
	 * always posts to the listing's own `requestCommitment` action, so there is
	 * exactly one place a request is created.
	 */
	interface Props {
		listingId: string;
		status: string;
		signedIn: boolean;
		isOwner: boolean;
		locations: { id: string; name: string }[];
		hasAvailability: boolean;
		slots: { startsAt: string }[];
		stakeCents: number | null;
		/**
		 * How the fee was reached: the base, what market reputation did to it,
		 * and what the buyer's own record did to that. See `#lib/commitments/fee`.
		 */
		fee?: CommitmentFee | null;
		minimumLeadHours: number | null;
	}

	let {
		listingId,
		status,
		signedIn,
		isOwner,
		locations,
		hasAvailability,
		slots,
		stakeCents,
		fee = null,
		minimumLeadHours
	}: Props = $props();

	let requesting = $state(false);

	/**
	 * TESTING: free date-and-time choice. Defaults to an hour from now, in the
	 * browser's local time, which is what a datetime-local input expects.
	 */
	const inAnHour = new Date(Date.now() + 3600_000);
	let localWhen = $state(
		new Date(inAnHour.getTime() - inAnHour.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
	);
	const scheduledAtIso = $derived(localWhen ? new Date(localWhen).toISOString() : '');
	let requestError = $state<string | null>(null);
	let needsFunds = $state(false);

	/** Why a request cannot be made, or null when it can. */
	const blocked = $derived.by(() => {
		if (isOwner) return 'This is your listing.';
		if (status === 'reserved') return 'Someone already has a meetup booked for this item.';
		if (status !== 'active') return 'This item is not available right now.';
		if (!signedIn) return null;
		if (locations.length === 0) return 'This seller has not added a meetup location yet.';
		// TESTING: any date and time can be requested, so the seller's own times
		// are not required. Uncomment to restore.
		// if (!hasAvailability) return 'This seller has not added any times they can meet yet.';
		// if (slots.length === 0) {
		// 	return `None of this seller's times are available right now. A meetup has to be at least ${minimumLeadHours ?? 5} hours away.`;
		// }
		return null;
	});

	function slotTime(iso: string): string {
		return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(
			new Date(iso)
		);
	}

	function slotDay(iso: string): string {
		return new Intl.DateTimeFormat('en-CA', {
			weekday: 'long',
			month: 'short',
			day: 'numeric'
		}).format(new Date(iso));
	}

	/** Grouped by the viewer's local day, so the picker reads as a calendar. */
	const days = $derived.by(() => {
		const grouped: { label: string; slots: { startsAt: string }[] }[] = [];
		for (const slot of slots) {
			const label = slotDay(slot.startsAt);
			const last = grouped.at(-1);
			if (last && last.label === label) last.slots.push(slot);
			else grouped.push({ label, slots: [slot] });
		}
		return grouped;
	});

	// TESTING: still needed once the slot picker is restored; referenced so the
	// type checker does not flag them while it is commented out.
	void (() => [hasAvailability, minimumLeadHours, slotTime, days]);
</script>

{#if blocked}
	<p class="note">{blocked}</p>
{:else if !signedIn}
	<Button href="/signin?redirectTo=/sell/{listingId}">Sign in to request</Button>
	<p class="note">You need an account to commit to a meetup.</p>
{:else}
	{#if requestError}
		<div class="error">
			<Alert tone="error">{requestError}</Alert>
			{#if needsFunds}
				<div class="fund">
					<Button href="/wallet/fund_wallet" variant="secondary" size="sm">Add funds</Button>
				</div>
			{/if}
		</div>
	{/if}

	<!--
		Handled here rather than by the page, because this form is also used from
		Discover, where the action belongs to a different route: a redirect is
		followed, and a refusal is shown in place.
	-->
	<form
		method="POST"
		action="/sell/{listingId}?/requestCommitment"
		use:enhance={() => {
			requesting = true;
			requestError = null;
			return async ({ result }) => {
				requesting = false;
				if (result.type === 'redirect') {
					await goto(result.location);
				} else if (result.type === 'failure') {
					requestError = String(result.data?.requestError ?? 'That request could not be made.');
					needsFunds = Boolean(result.data?.needsFunds);
				} else if (result.type === 'error') {
					requestError = 'Something went wrong. Please try again.';
				}
			};
		}}
	>
		<div class="fields">
			<Field id="meetupLocationId-{listingId}" label="Where">
				{#snippet children({ id, describedBy, invalid })}
					<select {id} name="meetupLocationId" required aria-describedby={describedBy} aria-invalid={invalid}>
						{#each locations as location (location.id)}
							<option value={location.id}>{location.name}</option>
						{/each}
					</select>
				{/snippet}
			</Field>

			<!--
				TESTING: any date and time, not just the seller's availability.
				The browser's local time is converted to an exact instant on submit.
				To restore, delete this field and uncomment the slot picker below.
			-->
			<Field id="scheduledAtLocal-{listingId}" label="When">
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						type="datetime-local"
						required
						bind:value={localWhen}
						aria-describedby={describedBy}
						aria-invalid={invalid}
					/>
				{/snippet}
			</Field>
			<input type="hidden" name="scheduledAt" value={scheduledAtIso} />

			<!-- TESTING: slot picker disabled.
			<Field id="scheduledAt-{listingId}" label="When">
				{#snippet children({ id, describedBy, invalid })}
					(shown in the viewer's timezone; the value is the exact instant)
					<select {id} name="scheduledAt" required aria-describedby={describedBy} aria-invalid={invalid}>
						{#each days as day (day.label)}
							<optgroup label={day.label}>
								{#each day.slots as slot (slot.startsAt)}
									<option value={slot.startsAt}>{day.label}, {slotTime(slot.startsAt)}</option>
								{/each}
							</optgroup>
						{/each}
					</select>
				{/snippet}
			</Field>
			-->
		</div>

		{#if fee}
			<!--
				EVERY STEP, not just the total. This is the moment money is
				committed, so the base, what the market did to it and what the
				buyer's own record did to that are all shown. A single figure would
				be easier to lay out and impossible to question.
			-->
			<dl class="fee">
				<div class="fee-row">
					<dt>Base commitment fee</dt>
					<dd>{formatPrice(fee.baseFeeCents)}</dd>
				</div>
				<div class="fee-row">
					<dt>Market reputation</dt>
					<dd>
						<span class="fee-delta" data-direction={fee.marketAdjustment > 0 ? 'up' : 'down'}>
							{fee.marketAdjustment > 0 ? '+' : '−'}{Math.abs(
								fee.marketAdjustment * 100
							).toFixed(2)}%
						</span>
						<span class="fee-hint">average {fee.marketReputation.toFixed(3)}</span>
					</dd>
				</div>
				<div class="fee-row fee-subtotal">
					<dt>An average member puts down</dt>
					<dd>{formatPrice(fee.adjustedBaseFeeCents)}</dd>
				</div>
				<div class="fee-row">
					<dt>Your reputation</dt>
					<dd>
						{fee.reputation.toFixed(3)}
						{#if fee.adjustedBaseFeeCents !== fee.feeCents}
							<span
								class="fee-delta"
								data-direction={fee.feeCents < fee.adjustedBaseFeeCents ? 'down' : 'up'}
							>
								{fee.feeCents < fee.adjustedBaseFeeCents ? '−' : '+'}{formatPrice(
									Math.abs(fee.adjustedBaseFeeCents - fee.feeCents)
								)}
							</span>
						{/if}
					</dd>
				</div>
				<div class="fee-row fee-total">
					<dt>You put down</dt>
					<dd>{formatPrice(fee.feeCents)} CAD</dd>
				</div>
			</dl>
		{/if}

		<div class="action">
			<Button type="submit" disabled={requesting}>
				{requesting ? 'Requesting…' : 'Request a meetup'}
			</Button>
		</div>
	</form>

	{#if stakeCents !== null}
		<p class="note">
			Refunded in full when you both show up. The seller puts down their own commitment
			when they accept. It is a commitment to <em>meet</em>, not to buy, so you can inspect
			the item and walk away.
		</p>
	{/if}
{/if}

<style>
	.note {
		margin-top: var(--k-space-3);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.error {
		margin-bottom: var(--k-space-3);
	}

	.fund {
		margin-top: var(--k-space-3);
	}

	.fields {
		display: grid;
		gap: var(--k-space-4);
	}

	.fields :global(select),
	.fields :global(input) {
		width: 100%;
	}

	.fee {
		display: grid;
		gap: var(--k-space-2);
		margin: var(--k-space-4) 0 0;
		padding: var(--k-space-3);
		background-color: var(--k-surface-sunken);
		font-size: var(--k-text-sm);
	}

	.fee-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--k-space-3);
	}

	.fee-row dt {
		color: var(--k-text-muted);
	}

	.fee-row dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.fee-hint {
		display: block;
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
	}

	/* A quieter rule than the total: this is a running subtotal, not the
	   figure being committed to. */
	.fee-subtotal {
		padding-top: var(--k-space-2);
		border-top: var(--k-line-width) dashed var(--k-line);
		font-weight: 600;
	}

	/* Direction is in the sign as well as the colour, so it survives for
	   anyone who cannot tell the two apart. */
	.fee-delta {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.fee-delta[data-direction='up'] {
		color: var(--k-danger);
	}

	.fee-delta[data-direction='down'] {
		color: var(--k-primary);
	}

	.fee-total {
		padding-top: var(--k-space-2);
		border-top: var(--k-line-width) solid var(--k-line);
		font-weight: 700;
	}

	.fee-total dt {
		color: var(--k-text);
	}

	.action {
		margin-top: var(--k-space-4);
	}
</style>
