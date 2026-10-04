<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Button from '#lib/components/ui/Button.svelte';

	/**
	 * RefreshButton, re-runs the page's load, which re-reads balances from
	 * Solana. Balances change outside the app (a deposit landing, a scheduled
	 * settlement), so any page showing one offers this.
	 */
	interface Props {
		label?: string;
	}

	let { label = 'Refresh' }: Props = $props();

	let refreshing = $state(false);

	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}
</script>

<Button type="button" variant="quiet" size="sm" onclick={refresh} disabled={refreshing}>
	{refreshing ? 'Checking…' : label}
</Button>
