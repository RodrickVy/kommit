<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Alert, a form-level or page-level message.
	 *
	 * For things that are not about one specific field: "that email and
	 * password do not match", "listing saved", "upload failed".
	 * Field-specific validation belongs in `Field`, next to the input.
	 */
	interface Props {
		/**
		 * `error` for something that failed, `success` for something that
		 * worked, `info` for neutral context.
		 */
		tone?: 'error' | 'success' | 'info';

		/** Message content. */
		children: Snippet;
	}

	let { tone = 'info', children }: Props = $props();

	/**
	 * `alert` interrupts and is announced immediately; `status` waits for a
	 * natural pause. An error the user must act on earns the interruption, a
	 * confirmation does not.
	 */
	const role = $derived(tone === 'error' ? 'alert' : 'status');
</script>

<div class="alert k-cut" data-tone={tone} {role}>
	<!--
		Decorative mark. The tone is already carried by the text itself, so this
		is hidden rather than described: colour and iconography are never the
		only signal.
	-->
	<span class="mark" aria-hidden="true"></span>
	<div class="body">{@render children()}</div>
</div>

<style>
	.alert {
		--k-cut: var(--k-cut-sm);

		display: flex;
		align-items: flex-start;
		gap: var(--k-space-3);
		padding: var(--k-space-3) var(--k-space-4);
		font-size: var(--k-text-sm);
	}

	.mark {
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		/* Nudged down to sit on the first line's baseline rather than its top. */
		margin-top: 0.45em;
	}

	.body {
		min-width: 0;
	}

	.alert[data-tone='error'] {
		background-color: var(--k-surface-raised);
		box-shadow: inset 0 0 0 var(--k-line-width) var(--k-danger);
		color: var(--k-text);
	}

	.alert[data-tone='error'] .mark {
		background-color: var(--k-danger);
	}

	.alert[data-tone='success'] {
		background-color: var(--k-surface-raised);
		box-shadow: inset 0 0 0 var(--k-line-width) var(--k-success);
	}

	.alert[data-tone='success'] .mark {
		background-color: var(--k-success);
	}

	.alert[data-tone='info'] {
		background-color: var(--k-surface-raised);
		box-shadow: inset 0 0 0 var(--k-line-width) var(--k-line-strong);
	}

	.alert[data-tone='info'] .mark {
		background-color: var(--k-text-subtle);
	}
</style>
