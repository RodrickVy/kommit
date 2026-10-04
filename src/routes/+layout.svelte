<script lang="ts">
	/**
	 * Root layout — the application shell.
	 *
	 * Wraps every page. Because it is the root, the header and footer are
	 * created once and survive navigation: moving between pages swaps only
	 * the content inside `<main>`, so the header does not flicker or lose
	 * scroll position.
	 */

	/**
	 * The global stylesheet, imported here and nowhere else. Importing it in
	 * the root layout is what guarantees the design tokens exist before any
	 * component that consumes them renders.
	 */
	import '../app.css';

	import AppFooter from '#lib/components/layout/AppFooter.svelte';
	import AppHeader from '#lib/components/layout/AppHeader.svelte';
	import type { LayoutProps } from './$types';

	/**
	 * `data` is the return value of `+layout.server.ts`, so `data.user` is the
	 * verified user or `null`. `children` is the page being rendered inside
	 * this layout.
	 */
	let { data, children }: LayoutProps = $props();
</script>

<svelte:head>
	<!--
		A default title so no page can ever render as "localhost:5173" in a
		tab or a bookmark. Individual pages override it with their own
		`<svelte:head>`.
	-->
	<title>kommitly</title>
</svelte:head>

<div class="shell">
	<AppHeader user={data.user} isAdmin={data.isAdmin} />

	<!--
		`id="main"` is the destination of the header's skip link, and
		`tabindex="-1"` lets it receive programmatic focus when that link is
		followed — without it, some browsers move the scroll position but
		leave focus stranded in the navigation.
	-->
	<main id="main" class="main" tabindex="-1">
		{@render children()}
	</main>

	<AppFooter />
</div>

<style>
	.shell {
		/* Three rows: header, content, footer. The `1fr` on the middle row is
		   what pins the footer to the bottom of the viewport on a short page
		   instead of letting it float up under the content. */
		display: grid;
		grid-template-rows: auto 1fr auto;
		min-height: 100svh;
	}

	/* Grid items default to `min-width: auto`, meaning their minimum size is
	   their min-content size — and a track will grow BEYOND its container to
	   honour that. One wide descendant is therefore enough to stretch this
	   column past the viewport and drag every other row out with it.

	   That is not hypothetical: the header's navigation did exactly this,
	   forcing a 526px column inside a 410px viewport and giving the whole
	   page a horizontal scrollbar. `min-width: 0` lets each row respect the
	   viewport, which in turn lets the nav's own `overflow-x: auto` do the
	   scrolling it was written to do.

	   `:global(*)` is required, not stylistic. Svelte scopes a selector by
	   demanding the element carry THIS component's hash, compiling a bare
	   `.shell > *` into `.shell.svelte-abc > :where(.svelte-abc)`. The header
	   and footer are root elements of child components and carry their own
	   hashes, so that rule would silently skip exactly the two rows causing
	   the overflow, and apply only to <main>. */
	.shell > :global(*) {
		min-width: 0;
	}

	.main {
		width: 100%;
		/* Same container width and gutter as the header and footer, so every
		   band of the page shares one vertical alignment. */
		max-width: var(--k-container);
		margin-inline: auto;
		padding: var(--k-space-6) var(--k-space-4);
	}

	/* `tabindex="-1"` makes `<main>` focusable, and browsers then draw a
	   focus ring around the whole page when the skip link is used. The ring
	   is suppressed because `<main>` is not an interactive control — the
	   visible result of following the skip link should be the content
	   scrolling into view, not a box around everything. */
	.main:focus {
		outline: none;
	}
</style>
