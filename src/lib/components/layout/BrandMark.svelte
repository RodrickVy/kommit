<script lang="ts">
	/**
	 * BrandMark — the kommitly logo followed by the wordmark.
	 *
	 * Used in the header and the footer; it is a component rather than
	 * duplicated markup so the two can never disagree.
	 *
	 * Purely presentational — it renders no link. The caller decides where it
	 * points, which is what lets the header wrap it in a link to `/` while
	 * the footer renders it as plain text.
	 */
	interface Props {
		/** `md` for the header, `sm` where the mark is a secondary detail. */
		size?: 'sm' | 'md';

		/** Whether to show the "kommitly" wordmark next to the logo. */
		showWordmark?: boolean;
	}

	let { size = 'md', showWordmark = true }: Props = $props();
</script>

<span class="brand" data-size={size}>
	<!-- Decorative when the wordmark is beside it; the name is the label. -->
	<img class="logo" src="/logo.png" alt={showWordmark ? '' : 'kommitly'} width="100" height="100" />
	{#if showWordmark}
		<span class="wordmark">kommitly</span>
	{/if}
</span>

<style>
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--k-space-2);
		color: var(--k-text);
	}

	.logo {
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
	}

	.wordmark {
		font-size: var(--k-text-lg);
		font-weight: 700;
		letter-spacing: -0.01em;
		line-height: 1;
	}

	.brand[data-size='sm'] .logo {
		width: 1.75rem;
		height: 1.75rem;
	}

	.brand[data-size='sm'] .wordmark {
		font-size: var(--k-text-base);
	}
</style>
