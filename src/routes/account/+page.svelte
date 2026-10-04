<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	/**
	 * Account — `/account`.
	 *
	 * Shows who is signed in and their commitment record. Editing is not built
	 * yet; this page currently exists to confirm the session and to host the
	 * sign-out action the header posts to.
	 */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Account · kommitly</title>
</svelte:head>

<PageHeader title="Account" />

{#if data.loadError}
	<Alert tone="error">{data.loadError}</Alert>
{:else if data.profile}
	<div class="panels">
		<Panel>
			<h2 class="panel-title">You</h2>

			<dl class="fields">
				<div class="field">
					<dt>Display name</dt>
					<dd>{data.profile.display_name}</dd>
				</div>
				<div class="field">
					<dt>Email</dt>
					<!--
						Shown to the account holder only. It is never exposed to
						another user — it is not even stored on the profile row,
						which is world-readable.
					-->
					<dd>{data.user.email ?? 'None on this account'}</dd>
				</div>
				{#if data.profile.description}
					<div class="field">
						<dt>About</dt>
						<dd>{data.profile.description}</dd>
					</div>
				{/if}
			</dl>
		</Panel>

		<Panel>
			<h2 class="panel-title">Commitment record</h2>

			<dl class="fields">
				<div class="field">
					<dt>Reputation</dt>
					<dd>
						{#if data.profile.reputation === null}
							<!--
								Null means not yet calculated, which is deliberately
								distinguishable from a genuine low score.
							-->
							<span class="pending">Not calculated yet</span>
						{:else}
							{data.profile.reputation}
						{/if}
					</dd>
				</div>
				<div class="field">
					<dt>Commitments</dt>
					<dd>{data.profile.commitments_total}</dd>
				</div>
				<div class="field">
					<dt>Successful</dt>
					<dd>{data.profile.commitments_successful}</dd>
				</div>
			</dl>
		</Panel>
	</div>

	<div class="signout">
		<!--
			Sign-out is a POST, not a link. A GET that changes state can be
			triggered by anything that prefetches a URL — a browser, a chat
			client unfurling a link, a crawler — and SvelteKit's CSRF origin
			check only applies to form submissions.
		-->
		<form method="POST" action="?/signout">
			<Button type="submit" variant="secondary">Sign out</Button>
		</form>
	</div>
{/if}

<style>
	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
		gap: var(--k-space-4);
	}

	.panel-title {
		margin-bottom: var(--k-space-4);
		font-size: var(--k-text-lg);
	}

	.fields {
		display: grid;
		gap: var(--k-space-3);
	}

	.field {
		display: grid;
		gap: var(--k-space-1);
	}

	.field dt {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.field dd {
		margin: 0;
		font-size: var(--k-text-sm);
		overflow-wrap: anywhere;
	}

	.pending {
		color: var(--k-text-subtle);
	}

	.signout {
		margin-top: var(--k-space-6);
		padding-top: var(--k-space-5);
		border-top: var(--k-line-width) solid var(--k-line);
	}
</style>
