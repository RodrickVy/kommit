<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import { CONDITION_LABELS } from '#lib/listings/labels';
	import { LISTING_EXAMPLES } from '#lib/listings/examples';
	import type { PageProps } from './$types';

	/**
	 * Create listing — `/sell/create_listing`.
	 */
	let { data, form }: PageProps = $props();

	let submitting = $state(false);

	/**
	 * Values currently in the form. Bound rather than set as plain `value`
	 * attributes, because the example filler below has to be able to change
	 * them.
	 *
	 * `untrack` because these are SEEDED from `form`, not synchronised with it,
	 * and that is correct in both directions:
	 *
	 *   - without JavaScript a failed submission re-renders the page, the
	 *     component mounts fresh, and this reads the returned values
	 *   - with JavaScript the component is not remounted, and the inputs
	 *     already hold what the user typed — re-reading `form` here would
	 *     overwrite their edits with the values they had just submitted
	 *
	 * Without `untrack` Svelte warns, and rightly: the pattern is usually a
	 * bug. Here it is deliberate, so it says so.
	 */
	let title = $state(untrack(() => form?.title) ?? '');
	let price = $state(untrack(() => form?.price) ?? '');
	let condition = $state(untrack(() => form?.condition) ?? '');
	let description = $state(untrack(() => form?.description) ?? '');

	/** Which example to offer next, so repeated clicks cycle rather than repeat. */
	let exampleIndex = $state(0);

	/**
	 * Fills the form with a worked example.
	 *
	 * Purely client-side: it populates the fields and nothing more. The seller
	 * can edit every value before saving, and what they submit goes through
	 * exactly the same validation as anything typed by hand — the example is a
	 * starting point, not a privileged path into the database.
	 */
	function fillWithExample() {
		const example = LISTING_EXAMPLES[exampleIndex % LISTING_EXAMPLES.length];
		if (!example) return;

		title = example.title;
		price = example.price;
		condition = example.condition;
		description = example.description;

		exampleIndex += 1;
	}
</script>

<svelte:head>
	<title>Create listing · kommitly</title>
</svelte:head>

<div class="narrow">
	<PageHeader
		title="New listing"
		description="One listing is one item. You will add photographs on the next step."
	/>

	<Panel>
		{#if form?.formError}
			<div class="banner">
				<Alert tone="error">{form.formError}</Alert>
			</div>
		{/if}

		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<!--
				Offered rather than imposed. Nothing is written until the seller
				submits, and every value stays editable, so this is a worked
				example of what a good listing looks like rather than data
				appearing in their account unasked.
			-->
			<div class="example">
				<p class="example-text">
					First listing? Fill the form with a worked example and edit it.
				</p>
				<Button type="button" variant="secondary" size="sm" onclick={fillWithExample}>
					Use an example
				</Button>
			</div>

			<div class="fields">
				<Field
					id="title"
					label="Title"
					hint="What the item is, as a buyer would search for it."
					error={form?.errors?.title}
				>
					{#snippet children({ id, describedBy, invalid })}
						<input
							{id}
							name="title"
							type="text"
							maxlength="120"
							required
							bind:value={title}
							aria-describedby={describedBy}
							aria-invalid={invalid}
						/>
					{/snippet}
				</Field>

				<Field id="price" label="Price (CAD)" hint="For example 45 or 45.50." error={form?.errors?.price}>
					{#snippet children({ id, describedBy, invalid })}
						<!--
							`inputmode="decimal"` brings up a numeric keypad on a phone
							while still allowing a decimal point, which `type="number"`
							handles inconsistently across browsers.
						-->
						<input
							{id}
							name="price"
							type="text"
							inputmode="decimal"
							required
							bind:value={price}
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
							bind:value={condition}
							aria-describedby={describedBy}
							aria-invalid={invalid}
						>
							<option value="" disabled>Choose a condition</option>
							{#each data.conditions as value (value)}
								<option {value}>{CONDITION_LABELS[value]}</option>
							{/each}
						</select>
					{/snippet}
				</Field>

				<Field
					id="description"
					label="Description"
					hint="Optional. Say what a buyer could not tell from the photographs — wear, missing parts, why you are selling."
					error={form?.errors?.description}
				>
					{#snippet children({ id, describedBy, invalid })}
						<textarea
							{id}
							name="description"
							maxlength="4000"
							bind:value={description}
							aria-describedby={describedBy}
							aria-invalid={invalid}
						></textarea>
					{/snippet}
				</Field>
			</div>

			<div class="actions">
				<Button type="submit" disabled={submitting}>
					{submitting ? 'Creating…' : 'Create draft'}
				</Button>
				<Button href="/sell" variant="quiet">Cancel</Button>
			</div>
		</form>
	</Panel>
</div>

<style>
	.narrow {
		max-width: 38rem;
	}

	.banner {
		margin-bottom: var(--k-space-4);
	}

	.example {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--k-space-3);
		margin-bottom: var(--k-space-5);
		padding: var(--k-space-3);
		background-color: var(--k-surface-raised);
	}

	.example-text {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.fields {
		display: grid;
		gap: var(--k-space-5);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
		margin-top: var(--k-space-6);
	}
</style>
