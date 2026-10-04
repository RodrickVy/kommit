<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Field, a labelled form control with inline validation feedback.
	 *
	 * Every input in kommitly goes through this, so that the label/control
	 * association, the error wiring and the spacing are identical everywhere.
	 *
	 * The accessibility plumbing is the reason this exists as a component
	 * rather than as markup repeated per form. Three things have to agree with
	 * each other and are easy to get wrong by hand:
	 *
	 *   - the `<label for>` must match the control's `id`, or clicking the
	 *     label does nothing and a screen reader announces the control unnamed
	 *   - `aria-describedby` must point at the error element, or the error is
	 *     invisible to anyone not looking at the screen
	 *   - `aria-invalid` is what actually tells assistive technology the value
	 *     was rejected; a red border communicates nothing without it
	 */
	interface Props {
		/** Used for the control `id`, the label's `for`, and the form field name. */
		id: string;

		/** Visible label. Always present, placeholders are not labels. */
		label: string;

		/**
		 * Validation message for this field, or `undefined` when valid.
		 * Supplying it switches the field into its invalid state.
		 */
		/* `| undefined` is explicit because `exactOptionalPropertyTypes` is on:
		   a caller passing `error={maybeUndefined}` is passing the property,
		   not omitting it, and those are different things to the checker. */
		error?: string | undefined;

		/**
		 * Guidance shown under the label, before any error. Use for format
		 * requirements the user needs *before* they get it wrong.
		 */
		hint?: string | undefined;

		/** The control itself. */
		children: Snippet<[{ id: string; describedBy: string | undefined; invalid: boolean }]>;
	}

	let { id, label, error, hint, children }: Props = $props();

	/* Derived, not plain consts: `id` is a prop, and a const would capture only
	   its first value and silently stop matching if the field were reused. */
	const hintId = $derived(`${id}-hint`);
	const errorId = $derived(`${id}-error`);

	/**
	 * A control may be described by its hint, its error, or both. The order
	 * matters: screen readers read these in sequence, and the error is the more
	 * urgent of the two, so it comes last and is heard most recently.
	 */
	const describedBy = $derived(
		[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field">
	<label for={id}>{label}</label>

	{#if hint}
		<p id={hintId} class="hint">{hint}</p>
	{/if}

	{@render children({ id, describedBy, invalid: Boolean(error) })}

	{#if error}
		<!--
			`role="alert"` makes the message announced the moment it appears,
			rather than only when focus happens to reach it.
		-->
		<p id={errorId} class="error" role="alert">{error}</p>
	{/if}
</div>

<style>
	.field {
		display: grid;
		gap: var(--k-space-2);
	}

	label {
		font-size: var(--k-text-sm);
		font-weight: 600;
	}

	.hint {
		margin: 0;
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.error {
		margin: 0;
		color: var(--k-danger);
		font-size: var(--k-text-sm);
	}

	/*
	 * Styles the control the consumer renders, which this component never sees.
	 * `:global` is required because the control is passed in as a snippet and
	 * so carries the *caller's* scope hash, not this component's.
	 */
	.field :global(input),
	.field :global(textarea),
	.field :global(select) {
		--k-cut: var(--k-cut-sm);

		width: 100%;
		padding: var(--k-space-3);
		background-color: var(--k-surface-sunken);
		color: var(--k-text);
		border: 0;
		/* Inset, not a border: clip-path would slice a border at the chamfer. */
		box-shadow: inset 0 0 0 var(--k-line-width) var(--k-line-strong);
		clip-path: polygon(
			var(--k-cut) 0,
			calc(100% - var(--k-cut)) 0,
			100% var(--k-cut),
			100% calc(100% - var(--k-cut)),
			calc(100% - var(--k-cut)) 100%,
			var(--k-cut) 100%,
			0 calc(100% - var(--k-cut)),
			0 var(--k-cut)
		);
	}

	.field :global(textarea) {
		min-height: 8rem;
		resize: vertical;
	}

	.field :global(input:focus-visible),
	.field :global(textarea:focus-visible),
	.field :global(select:focus-visible) {
		outline: none;
		box-shadow:
			inset 0 0 0 var(--k-line-width) var(--k-bg),
			inset 0 0 0 3px var(--k-focus);
	}

	/* Driven by aria-invalid rather than a class, so the visible state and the
	   announced state cannot drift apart. */
	.field :global([aria-invalid='true']) {
		box-shadow: inset 0 0 0 2px var(--k-danger);
	}
</style>
