<script lang="ts">
	/**
	 * BrandMark — the kommit logotype.
	 *
	 * A chamfered teal tile holding a lowercase "k", followed by the
	 * wordmark. Used in the header and the footer; it is a component rather
	 * than duplicated markup so the two can never disagree.
	 *
	 * Purely presentational — it renders no link. The caller decides where it
	 * points, which is what lets the header wrap it in a link to `/` while
	 * the footer renders it as plain text.
	 */
	interface Props {
		/**
		 * `md` for the header, `sm` where the mark is a secondary detail.
		 */
		size?: 'sm' | 'md';

		/**
		 * Whether to show the "kommit" wordmark next to the tile. Set to
		 * `false` for a very narrow container, where the tile alone still
		 * identifies the app.
		 */
		showWordmark?: boolean;
	}

	let { size = 'md', showWordmark = true }: Props = $props();
</script>

<span class="brand" data-size={size}>
	<!--
		`aria-hidden` on the tile: it is decorative, and the wordmark beside it
		already carries the name. Without this a screen reader would announce
		"k kommit".

		When the wordmark is hidden the name still has to be available, so a
		visually hidden copy takes its place.
	-->
	<span class="tile k-cut" aria-hidden="true">k</span>

	{#if showWordmark}
		<span class="wordmark">kommit</span>
	{:else}
		<span class="k-visually-hidden">kommit</span>
	{/if}
</span>

<style>
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--k-space-2);
		/* Overrides the global link colour when this sits inside an `<a>`. */
		color: var(--k-text);
		text-decoration: none;
	}

	.tile {
		--k-cut: 5px;

		display: grid;
		place-items: center;
		background-color: var(--k-primary);
		color: var(--k-on-primary);
		font-weight: 700;
		/* The glyph is optically centred by the grid; a line-height of 1
		   stops the tile growing taller than it is wide. */
		line-height: 1;
	}

	.wordmark {
		font-weight: 600;
		letter-spacing: var(--k-tracking-tight);
	}

	/* -- size ------------------------------------------------------------ */
	.brand[data-size='sm'] .tile {
		width: 1.5rem;
		height: 1.5rem;
		font-size: var(--k-text-sm);
	}

	.brand[data-size='sm'] .wordmark {
		font-size: var(--k-text-base);
	}

	.brand[data-size='md'] .tile {
		width: 2rem;
		height: 2rem;
		font-size: var(--k-text-lg);
	}

	.brand[data-size='md'] .wordmark {
		font-size: var(--k-text-lg);
	}
</style>
