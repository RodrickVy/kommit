<script lang="ts">
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	/**
	 * Listing — `/sell/[listing_id]`.
	 *
	 * Intentionally empty apart from echoing the route parameter, which
	 * confirms the dynamic segment resolves.
	 *
	 * `params` comes from `PageProps`, so `listing_id` is typed as a string for
	 * this route specifically. Reading `page.params` from `$app/state` instead
	 * would widen it to the union of every route's parameters.
	 *
	 * Once this page loads data, the parameter should be read in a
	 * `+page.server.ts` and used to scope the query there — not fetched from
	 * the component.
	 */

	let { params }: PageProps = $props();
</script>

<svelte:head>
	<title>Listing · kommit</title>
</svelte:head>

<PageHeader title="Listing" />

<!-- SCAFFOLDING: delete once this page renders real content. -->
<p class="param">
	<code>listing_id</code> = <code>{params.listing_id}</code>
</p>

<style>
	.param {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}
</style>
