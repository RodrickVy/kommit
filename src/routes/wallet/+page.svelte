<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import RefreshButton from '#lib/components/wallet/RefreshButton.svelte';
	import WalletBalance from '#lib/components/wallet/WalletBalance.svelte';
	import type { PageProps } from './$types';

	/**
	 * Wallet — `/wallet`.
	 */
	let { data, form }: PageProps = $props();

	/**
	 * Disables the button while a withdrawal is in flight. Not cosmetic: a
	 * second submission while the first is unconfirmed is exactly the case the
	 * function's idempotency key exists to absorb, and the honest fix is to stop
	 * it happening rather than to rely on catching it.
	 */
	let withdrawing = $state(false);
</script>

<svelte:head>
	<title>Wallet · kommitly</title>
</svelte:head>

<PageHeader title="Wallet" description="Your kommitly wallet, read live from Solana.">
	{#snippet actions()}
		{#if data.wallet}
			<Button href="/wallet/fund_wallet">Add funds</Button>
		{:else}
			<RefreshButton />
		{/if}
	{/snippet}
</PageHeader>

{#if form?.actionError}
	<div class="banner"><Alert tone="error">{form.actionError}</Alert></div>
{/if}

{#if data.loadError}
	<!--
		A failure to reach Solana is NOT a balance of zero. Saying so explicitly
		matters: telling someone their money is gone because a network call
		failed would be the worst answer available.
	-->
	<Alert tone="error">
		{data.loadError} Your funds are unaffected — this is a problem reading the
		balance, not with the wallet itself.
	</Alert>
{:else if !data.wallet}
	<Panel>
		<h2 class="title">No wallet yet</h2>
		<p class="body">
			You need a wallet before you can commit to a meetup. It takes a moment to
			create and starts empty.
		</p>
		<form method="POST" action="?/createWallet" use:enhance class="action">
			<Button type="submit">Create my wallet</Button>
		</form>
	</Panel>
{:else}
	<div class="grid">
		<WalletBalance wallet={data.wallet} />

		<Panel>
			<h2 class="title">Withdraw</h2>

			{#if form?.withdrawal}
				<div class="result">
					<Alert tone="success">
						Sent {form.withdrawal.sol.toFixed(4)} SOL.
						<a href={form.withdrawal.explorer} rel="noreferrer noopener" target="_blank">
							View on Solana Explorer
						</a>
					</Alert>
				</div>
			{/if}

			<p class="body">
				Available to send: <strong>{data.wallet.sol.toFixed(4)} SOL</strong>.
				A small network fee comes out of your balance.
			</p>

			<form
				method="POST"
				action="?/withdraw"
				use:enhance={() => {
					withdrawing = true;
					return async ({ update }) => {
						/*
						 * `update()` re-runs the load, so the balance shown is read
						 * from Solana again rather than adjusted locally. The chain is
						 * the only thing that knows what actually happened.
						 */
						await update();
						withdrawing = false;
					};
				}}
			>
				<div class="fields">
					<Field
						id="destination"
						label="Send to"
						hint="A Solana address on {data.wallet.network}. Check it carefully — a transfer cannot be reversed."
					>
						{#snippet children({ id, describedBy, invalid })}
							<input
								{id}
								name="destination"
								type="text"
								required
								spellcheck="false"
								autocomplete="off"
								aria-describedby={describedBy}
								aria-invalid={invalid}
							/>
						{/snippet}
					</Field>

					<Field id="amount" label="Amount (SOL)">
						{#snippet children({ id, describedBy, invalid })}
							<input
								{id}
								name="amount"
								type="text"
								inputmode="decimal"
								placeholder="0.1"
								aria-describedby={describedBy}
								aria-invalid={invalid}
							/>
						{/snippet}
					</Field>
				</div>

				<!--
					Emptying the wallet is a separate choice rather than something the
					user calculates. Solana will not leave an account holding a tiny
					non-zero balance, so "everything" has to mean everything minus the
					fee — arithmetic nobody should have to do by hand.
				-->
				<label class="all">
					<input type="checkbox" name="all" />
					<span>Send everything and empty the wallet</span>
				</label>

				<div class="actions">
					<Button type="submit" disabled={withdrawing}>
						{withdrawing ? 'Sending…' : 'Withdraw'}
					</Button>
				</div>
			</form>
		</Panel>
	</div>
{/if}

<style>
	.banner {
		margin-bottom: var(--k-space-4);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
		gap: var(--k-space-4);
		align-items: start;
	}

	.title {
		font-size: var(--k-text-lg);
	}

	.body {
		margin-top: var(--k-space-2);
		max-width: 52ch;
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.action {
		margin-top: var(--k-space-5);
	}

	.result {
		margin: var(--k-space-3) 0;
	}

	.fields {
		display: grid;
		gap: var(--k-space-4);
		margin-top: var(--k-space-4);
	}

	.all {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
		margin-top: var(--k-space-4);
		font-size: var(--k-text-sm);
		cursor: pointer;
	}

	.all input {
		accent-color: var(--k-primary);
	}

	.actions {
		margin-top: var(--k-space-5);
	}
</style>
