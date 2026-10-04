<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * PageHeader, the heading block at the top of every route.
	 *
	 * Used by all pages so that heading level, spacing and the title/summary
	 * relationship are identical throughout. It renders the page's single
	 * `<h1>`; a page must not render another one, because a document with two
	 * `<h1>`s gives assistive technology no unambiguous page title.
	 */
	interface Props {
		/** The page's title. Rendered as the one `<h1>` on the page. */
		title: string;

		/**
		 * One sentence saying what the page is for. Optional, but worth
		 * writing: it is the only orientation a first-time visitor gets.
		 */
		description?: string | undefined;

		/**
		 * Page-level actions, such as a "New listing" button. Rendered at the
		 * end of the heading row on wide viewports and below the text on
		 * narrow ones.
		 */
		actions?: Snippet | undefined;
	}

	let { title, description, actions }: Props = $props();
</script>

<header class="page-header">
	<div class="text">
		<h1>{title}</h1>
		{#if description}
			<p class="description">{description}</p>
		{/if}
	</div>

	{#if actions}
		<div class="actions">
			{@render actions()}
		</div>
	{/if}
</header>

<style>
	.page-header {
		display: flex;
		/* Wraps rather than squashing: on a narrow viewport the actions drop
		   below the title instead of competing with it for width. */
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--k-space-4);
		margin-bottom: var(--k-space-6);
		padding-bottom: var(--k-space-5);
		border-bottom: var(--k-line-width) solid var(--k-line);
	}

	.text {
		/* A long title shrinks this column rather than pushing the actions
		   off the edge. */
		min-width: 0;
	}

	.description {
		margin-top: var(--k-space-2);
		max-width: 60ch; /* Roughly the line length at which prose stays readable. */
		color: var(--k-text-muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
	}
</style>
