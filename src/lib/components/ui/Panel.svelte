<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Panel — the standard content surface.
	 *
	 * Every boxed region in kommitly is a Panel: cards, form wrappers, summary
	 * blocks, empty states. Using it rather than a bare `<div>` is what keeps
	 * the chamfer, the hairline and the padding rhythm identical everywhere.
	 *
	 * The cut corners and the hairline come from the global `.k-cut` and
	 * `.k-outline` classes in `app.css`, not from this file. This component
	 * deliberately does not set `box-shadow`, so that `.k-outline` stays in
	 * charge of the border — see the note on inset shadows in `app.css`.
	 */
	interface Props {
		/**
		 * Which surface step to fill with. Depth in kommitly is expressed by
		 * lightness rather than drop shadows, because `clip-path` makes outer
		 * shadows invisible.
		 *
		 * - `surface` sits on the page background. The default.
		 * - `raised` reads as closer to the viewer; use for a panel nested
		 *   inside another, or for the item under the cursor.
		 * - `sunken` reads as recessed; use for inputs and wells.
		 */
		tone?: 'surface' | 'raised' | 'sunken';

		/**
		 * Size of the corner chamfer. `md` suits most panels; `lg` is for
		 * full-width hero blocks where a small cut would look like a mistake,
		 * and `sm` for anything compact.
		 */
		cut?: 'sm' | 'md' | 'lg';

		/** Internal spacing. `none` lets the panel wrap edge-to-edge content such as a table. */
		padding?: 'none' | 'sm' | 'md' | 'lg';

		/** Panel contents. */
		children: Snippet;
	}

	let { tone = 'surface', cut = 'md', padding = 'md', children }: Props = $props();
</script>

<!--
	Variants are selected with `data-` attributes and resolved in CSS, rather
	than by assembling a class string in script. The markup then states what
	the panel IS, and the stylesheet decides what that looks like.
-->
<div class="panel k-cut k-outline" data-tone={tone} data-cut={cut} data-padding={padding}>
	{@render children()}
</div>

<style>
	.panel {
		/* Fallback for the two custom properties the variants below set, so a
		   Panel is still well-formed if a new variant forgets one. */
		background-color: var(--k-surface);
	}

	/* -- tone ------------------------------------------------------------ */
	.panel[data-tone='surface'] {
		background-color: var(--k-surface);
	}

	.panel[data-tone='raised'] {
		background-color: var(--k-surface-raised);
	}

	.panel[data-tone='sunken'] {
		background-color: var(--k-surface-sunken);
	}

	/* -- cut --------------------------------------------------------------
	   Each variant rebinds `--k-cut`, which the global `.k-cut` clip-path
	   reads. The clip geometry itself lives in one place in `app.css`. */
	.panel[data-cut='sm'] {
		--k-cut: var(--k-cut-sm);
	}

	.panel[data-cut='lg'] {
		--k-cut: var(--k-cut-lg);
	}

	/* -- padding --------------------------------------------------------- */
	.panel[data-padding='none'] {
		padding: 0;
	}

	.panel[data-padding='sm'] {
		padding: var(--k-space-3);
	}

	.panel[data-padding='md'] {
		padding: var(--k-space-5);
	}

	.panel[data-padding='lg'] {
		padding: var(--k-space-6);
	}
</style>
