<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Badge, a short status label.
	 *
	 * Used for listing status. Carries its meaning in text, never in colour
	 * alone: someone who cannot distinguish the tones still reads "Draft".
	 */
	interface Props {
		tone?: 'neutral' | 'live' | 'warning' | 'muted';
		children: Snippet;
	}

	let { tone = 'neutral', children }: Props = $props();
</script>

<span class="badge k-cut" data-tone={tone}>{@render children()}</span>

<style>
	.badge {
		--k-cut: 4px;

		display: inline-block;
		padding: 0.15rem var(--k-space-2);
		font-size: var(--k-text-xs);
		font-weight: 600;
		letter-spacing: var(--k-tracking-wide);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.badge[data-tone='neutral'] {
		background-color: var(--k-surface-sunken);
		color: var(--k-text-muted);
	}

	.badge[data-tone='live'] {
		background-color: var(--k-primary);
		color: var(--k-on-primary);
	}

	.badge[data-tone='warning'] {
		background-color: var(--k-surface-raised);
		color: var(--k-warning);
		box-shadow: inset 0 0 0 1px var(--k-warning);
	}

	.badge[data-tone='muted'] {
		background-color: var(--k-surface-raised);
		color: var(--k-text-subtle);
	}
</style>
