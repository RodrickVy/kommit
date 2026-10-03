<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Button — every clickable action in kommitly.
	 *
	 * Renders a real `<button>` when it performs an action, and a real `<a>`
	 * when it navigates. That distinction is not cosmetic: a link can be
	 * opened in a new tab, is announced as a link by screen readers, and is
	 * followed without JavaScript. A `<div>` with a click handler, or a
	 * `<button>` that navigates, breaks all three.
	 *
	 * Pass `href` and you get a link; omit it and you get a button.
	 */
	interface Props {
		/**
		 * Visual weight, which should reflect importance rather than taste.
		 * At most one `primary` button should be visible in a given view —
		 * if everything is emphasised, nothing is.
		 *
		 * - `primary`   the one action the page is for
		 * - `secondary` an alternative action, outlined rather than filled
		 * - `quiet`     a tertiary action that should not compete for attention
		 */
		variant?: 'primary' | 'secondary' | 'quiet';

		/** `sm` for dense rows such as a toolbar; `md` everywhere else. */
		size?: 'sm' | 'md';

		/**
		 * Destination. Supplying it makes this an `<a>`; omitting it makes it
		 * a `<button>`.
		 */
		href?: string;

		/**
		 * Submit behaviour, for the `<button>` form only.
		 *
		 * Defaults to `'button'` rather than the HTML default of `'submit'`,
		 * so that adding a button inside a form cannot accidentally submit it.
		 * Set `type="submit"` explicitly on the button that is meant to.
		 */
		type?: 'button' | 'submit';

		/**
		 * Disables the control. Only meaningful for the `<button>` form:
		 * there is no accessible way to disable a link, so a navigation that
		 * is unavailable should not be rendered as a Button at all.
		 */
		disabled?: boolean;

		/** Button label. Text, not an icon on its own — an icon-only control needs a `.k-visually-hidden` label. */
		children: Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		href,
		type = 'button',
		disabled = false,
		children
	}: Props = $props();
</script>

{#if href}
	<a class="btn k-cut" data-variant={variant} data-size={size} {href}>
		{@render children()}
	</a>
{:else}
	<button class="btn k-cut" data-variant={variant} data-size={size} {type} {disabled}>
		{@render children()}
	</button>
{/if}

<style>
	/* Shared between the link and button forms. Both are styled through the
	   same `.btn` class so the two cannot drift apart visually. */
	.btn {
		/* Chamfer slightly tighter than a Panel's: on a control this small a
		   10px cut eats into the label. */
		--k-cut: var(--k-cut-sm);

		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--k-space-2);

		border: 0;
		background: none;
		font-weight: 550;
		letter-spacing: 0.01em;
		white-space: nowrap;
		cursor: pointer;

		/* A link inherits the global underline from `app.css`; a button does
		   not. Clearing it here keeps the two identical. */
		text-decoration: none;

		transition:
			background-color var(--k-duration-fast) var(--k-ease),
			color var(--k-duration-fast) var(--k-ease);
	}

	/* -- size ------------------------------------------------------------ */
	.btn[data-size='sm'] {
		padding: var(--k-space-2) var(--k-space-3);
		font-size: var(--k-text-sm);
	}

	.btn[data-size='md'] {
		padding: var(--k-space-3) var(--k-space-5);
		font-size: var(--k-text-base);
	}

	/* -- primary --------------------------------------------------------- */
	.btn[data-variant='primary'] {
		background-color: var(--k-primary);
		/* Never `--k-text` here: only `--k-on-primary` is guaranteed legible
		   against the primary fill. */
		color: var(--k-on-primary);
	}

	.btn[data-variant='primary']:hover:not(:disabled) {
		background-color: var(--k-primary-hover);
	}

	.btn[data-variant='primary']:active:not(:disabled) {
		background-color: var(--k-primary-active);
	}

	/* -- secondary -------------------------------------------------------
	   The outline is an INSET box-shadow, not a border: a border would be
	   sliced off at the chamfer. See `app.css`, section 6. */
	.btn[data-variant='secondary'] {
		box-shadow: inset 0 0 0 var(--k-line-width) var(--k-line-strong);
		color: var(--k-text);
	}

	.btn[data-variant='secondary']:hover:not(:disabled) {
		background-color: var(--k-surface-raised);
		color: var(--k-text);
	}

	/* -- quiet ----------------------------------------------------------- */
	.btn[data-variant='quiet'] {
		color: var(--k-text-muted);
	}

	.btn[data-variant='quiet']:hover:not(:disabled) {
		background-color: var(--k-surface-raised);
		color: var(--k-text);
	}

	/* -- disabled --------------------------------------------------------
	   Dimmed rather than hidden, and `cursor: not-allowed` so the pointer
	   explains why the click did nothing. */
	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
