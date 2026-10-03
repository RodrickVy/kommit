<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	/**
	 * Home — `/`.
	 *
	 * This is the application's root route. There is no `/home`: the home
	 * page IS `/`, so there is no redirect to pay for and only one URL that
	 * can ever represent it.
	 *
	 * SCAFFOLDING — the two panels below report the state of the shell so the
	 * setup can be verified in a browser. They should be replaced wholesale
	 * when the real home page is designed; the diagnostic belongs in the
	 * shell's first commit, not in the product.
	 */

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>kommitly</title>
	<meta name="description" content="kommitly" />
</svelte:head>

<PageHeader
	title="kommitly"
	description="Application shell. Routing, the design system and the Supabase connection are in place; features are built from here."
/>

<!--
	A local snippet, because the same label/value row is rendered several
	times below. Defining it once here is the right scope for a pattern used
	only on this page — a shared component would be premature until a second
	page needs it.
-->
{#snippet field(label: string, value: string, mono = false)}
	<div class="field">
		<dt>{label}</dt>
		<dd class:mono>{value}</dd>
	</div>
{/snippet}

<div class="panels">
	<Panel>
		<h2 class="panel-title">Connection</h2>

		<!--
			`data-ok` drives the colour, while the text states the outcome in
			words. Colour is never the only carrier of meaning.
		-->
		<p class="status" data-ok={data.supabaseHealth.reachable}>
			<span class="dot" aria-hidden="true"></span>
			{data.supabaseHealth.reachable ? 'Supabase reachable' : 'Supabase unreachable'}
		</p>

		<p class="detail">{data.supabaseHealth.detail}</p>

		<dl class="fields">
			{@render field('Project', data.supabaseUrl, true)}
			{@render field('Solana cluster', data.solanaNetwork, true)}
		</dl>
	</Panel>

	<Panel>
		<h2 class="panel-title">Session</h2>

		{#if data.user}
			<p class="detail">This request carries a verified session.</p>

			<dl class="fields">
				{@render field('Email', data.user.email ?? 'None on this account')}
				{@render field('User ID', data.user.id, true)}
				{@render field('Postgres role', data.user.role, true)}
			</dl>

			<div class="actions">
				<Button href="/account" variant="secondary">Account</Button>
			</div>
		{:else}
			<p class="detail">
				No session on this request. Pages that need an account will be guarded
				server-side once authentication is built.
			</p>

			<div class="actions">
				<Button href="/join">Join</Button>
				<Button href="/signin" variant="secondary">Sign in</Button>
			</div>
		{/if}
	</Panel>
</div>

<style>
	.panels {
		display: grid;
		/* `auto-fit` plus `minmax` gives two columns where there is room and
		   one where there is not, with no media query. 20rem is the narrowest
		   a panel should be before its label/value rows start wrapping badly.

		   The `min(20rem, 100%)` rather than a bare `20rem` matters: a plain
		   fixed minimum is a floor the track cannot go below, so on a viewport
		   narrower than 20rem the grid overflows instead of fitting. Wrapping
		   it in `min()` caps that floor at the container's own width, so the
		   track shrinks the rest of the way on a small phone. */
		grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
		gap: var(--k-space-4);
	}

	.panel-title {
		margin-bottom: var(--k-space-3);
		font-size: var(--k-text-lg);
	}

	.status {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
		font-weight: 550;
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		background-color: var(--k-danger);
	}

	.status[data-ok='true'] .dot {
		background-color: var(--k-success);
	}

	.detail {
		margin-top: var(--k-space-2);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.fields {
		display: grid;
		gap: var(--k-space-3);
		margin-top: var(--k-space-4);
	}

	.field {
		display: grid;
		gap: var(--k-space-1);
	}

	.field dt {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		/* Small-caps label treatment; the wide tracking is what keeps
		   uppercase text legible at this size. */
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.field dd {
		margin: 0;
		font-size: var(--k-text-sm);
		/* Identifiers and URLs are long and must not force the panel wider
		   than its grid column. */
		overflow-wrap: anywhere;
	}

	.mono {
		font-family: var(--k-font-mono);
		color: var(--k-text-muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
		margin-top: var(--k-space-5);
	}
</style>
