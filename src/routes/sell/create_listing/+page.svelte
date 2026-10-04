<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import { CONDITION_LABELS } from '#lib/listings/labels';
	import type { PageProps } from './$types';

	/**
	 * Create listing — `/sell/create_listing`.
	 */
	let { data, form }: PageProps = $props();

	let submitting = $state(false);
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
							value={form?.title ?? ''}
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
							value={form?.price ?? ''}
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
							<option value="" disabled selected={!form?.condition}>Choose a condition</option>
							{#each data.conditions as value (value)}
								<option {value} selected={form?.condition === value}>
									{CONDITION_LABELS[value]}
								</option>
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
							aria-describedby={describedBy}
							aria-invalid={invalid}>{form?.description ?? ''}</textarea
						>
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
