<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import WalletBalance from '#lib/components/wallet/WalletBalance.svelte';
	import MeetupSetup from '#lib/components/listings/MeetupSetup.svelte';
	import type { PageProps } from './$types';

	/**
	 * Account — `/account`.
	 *
	 * Identity, commitment record, and the seller settings that every listing
	 * inherits: where this person will meet, and when they are free.
	 */
	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Account · kommitly</title>
</svelte:head>

<PageHeader title="Account" />

{#if form?.message}
	<div class="banner">
		<Alert tone={form.tone === 'success' ? 'success' : 'error'}>{form.message}</Alert>
	</div>
{/if}

{#if data.loadError}
	<Alert tone="error">{data.loadError}</Alert>
{:else}
	<div class="panels">
		{#if data.wallet}
			<WalletBalance wallet={data.wallet} showAddress />
		{:else if data.walletError}
			<Panel>
				<h2 class="panel-title">Wallet</h2>
				<p class="muted">{data.walletError}</p>
			</Panel>
		{:else}
			<Panel>
				<h2 class="panel-title">Wallet</h2>
				<p class="muted">You do not have a wallet yet.</p>
				<div class="wallet-action">
					<Button href="/wallet" variant="secondary" size="sm">Set one up</Button>
				</div>
			</Panel>
		{/if}

		<Panel>
			<h2 class="panel-title">You</h2>
			<dl class="pairs">
				<div class="pair">
					<dt>Display name</dt>
					<dd>{data.profile?.display_name ?? '—'}</dd>
				</div>
				<div class="pair">
					<dt>Email</dt>
					<!--
						Shown to the account holder only. It is never exposed to another
						user — it is not even stored on the profile row, which is
						world-readable.
					-->
					<dd>{data.user.email ?? 'None on this account'}</dd>
				</div>
			</dl>
		</Panel>

		<Panel>
			<h2 class="panel-title">Commitment record</h2>
			<dl class="pairs">
				<div class="pair">
					<dt>Reputation</dt>
					<dd>
						{#if data.profile?.reputation == null}
							<!-- Null means not yet calculated, deliberately distinguishable
							     from a genuine low score. -->
							<span class="muted">Not calculated yet</span>
						{:else}
							{data.profile.reputation}
						{/if}
					</dd>
				</div>
				<div class="pair">
					<dt>Commitments</dt>
					<dd>{data.profile?.commitments_total ?? 0}</dd>
				</div>
				<div class="pair">
					<dt>Successful</dt>
					<dd>{data.profile?.commitments_successful ?? 0}</dd>
				</div>
			</dl>
		</Panel>
	</div>

	<MeetupSetup locations={data.locations} availability={data.availability} showExamples />

	<div class="signout">
		<!--
			A POST, not a link. A GET that changes state can be triggered by
			anything that prefetches a URL, and SvelteKit's CSRF origin check only
			covers form submissions.
		-->
		<form method="POST" action="?/signout">
			<Button type="submit" variant="secondary">Sign out</Button>
		</form>
	</div>
{/if}

<style>
	.banner {
		margin-bottom: var(--k-space-4);
	}

	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
		gap: var(--k-space-4);
	}




	.panel-title {
		font-size: var(--k-text-lg);
	}

	.wallet-action {
		margin-top: var(--k-space-4);
	}

	.pairs {
		display: grid;
		gap: var(--k-space-3);
		margin-top: var(--k-space-4);
	}

	.pair {
		display: grid;
		gap: var(--k-space-1);
	}

	.pair dt {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.pair dd {
		margin: 0;
		font-size: var(--k-text-sm);
		overflow-wrap: anywhere;
	}






	.muted {
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}








	.signout {
		margin-top: var(--k-space-6);
		padding-top: var(--k-space-5);
		border-top: var(--k-line-width) solid var(--k-line);
	}
</style>
