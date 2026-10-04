<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import FundingPanel from '#lib/components/wallet/FundingPanel.svelte';
	import { formatSol } from '#lib/format';
	import type { PageProps } from './$types';

	/**
	 * Admin — `/admin`.
	 *
	 * Reachable only by a profile carrying `is_admin`; the load answers 404 to
	 * everyone else, so nothing here is hidden by CSS or by the navigation.
	 */
	let { data, form }: PageProps = $props();

	let refreshing = $state(false);
	let editing = $state<string | null>(null);

	async function refresh() {
		refreshing = true;
		/** Re-runs the load, which re-reads every balance from Solana. */
		await invalidateAll();
		refreshing = false;
	}

	const activeCharity = $derived(
		data.charities.find((charity) => charity.id === data.settings?.active_charity_id) ?? null
	);
</script>

<svelte:head>
	<title>Admin · kommitly</title>
</svelte:head>

<PageHeader
	title="Admin"
	description="Fund the Main Wallet and decide where forfeited stakes go."
>
	{#snippet actions()}
		<Badge tone={data.network === 'mainnet-beta' ? 'warning' : 'muted'}>{data.network}</Badge>
		<Button type="button" variant="quiet" size="sm" onclick={refresh} disabled={refreshing}>
			{refreshing ? 'Checking…' : 'Refresh balances'}
		</Button>
	{/snippet}
</PageHeader>

{#if form?.actionError}
	<div class="banner"><Alert tone="error">{form.actionError}</Alert></div>
{:else if form?.message}
	<div class="banner"><Alert tone="success">{form.message}</Alert></div>
{/if}

<div class="stack">
	<section>
		<h2 class="section-title">Main Wallet</h2>

		{#if !data.treasury}
			<!--
				Stated as a blocking problem rather than an empty state. Without the
				treasury, every refund and every forfeit fails — there is nowhere for
				a held stake to come back from.
			-->
			<Alert tone="error">
				The Main Wallet has not been created. Run <code>npm run setup:platform-wallet</code>
				before any commitment is made: stakes are held here, and refunds are paid
				out of it.
			</Alert>
		{:else}
			<div class="stack">
				<Panel tone="raised">
					<div class="balance-row">
						<div>
							<p class="label">Treasury balance</p>
							<p class="balance">{formatSol(data.treasury.lamports)}</p>
						</div>
						<p class="balance-note">
							{#if data.treasury.lamports === null}
								Solana could not be reached, so this balance is unknown — not zero.
								Try Refresh balances.
							{:else if data.treasury.lamports === 0}
								Empty. Every refund and every forfeit is paid from here, so
								settlements will fail until it holds SOL.
							{:else}
								Holds staked funds between locking and settlement, and pays every
								refund.
							{/if}
						</p>
					</div>
				</Panel>

				<FundingPanel
					address={data.treasury.address}
					network={data.network}
					qr={data.treasury.qr}
					title="Fund the Main Wallet"
					hint="Send devnet SOL from your own Solflare wallet to this address. Keep enough in it to cover the stakes currently held."
				/>
			</div>
		{/if}
	</section>

	<section>
		<h2 class="section-title">Forfeited stakes</h2>

		<Panel>
			{#if activeCharity}
				<p class="active">
					Going to <strong>{activeCharity.short_name ?? activeCharity.name}</strong>
				</p>
				<p class="muted">
					Changing this affects future forfeits only. Each past one recorded the
					charity it actually went to.
				</p>
			{:else}
				<!--
					settle_stake refuses a forfeit with no charity selected, so this is
					not cosmetic: every cancellation would error.
				-->
				<Alert tone="error">
					No charity is selected, so any forfeited stake will fail to settle.
					Choose one below.
				</Alert>
			{/if}
		</Panel>
	</section>

	<section>
		<h2 class="section-title">Charities</h2>

		<div class="stack">
			{#each data.charities as charity (charity.id)}
				<Panel tone={charity.id === data.settings?.active_charity_id ? 'raised' : 'surface'}>
					<div class="charity-head">
						<div class="charity-name">
							<h3>{charity.short_name ?? charity.name}</h3>
							{#if charity.short_name && charity.short_name !== charity.name}
								<p class="legal">{charity.name}</p>
							{/if}
						</div>
						<div class="tags">
							{#if charity.id === data.settings?.active_charity_id}
								<Badge tone="live">Receiving</Badge>
							{/if}
							{#if !charity.is_active}
								<Badge tone="muted">Archived</Badge>
							{/if}
						</div>
					</div>

					{#if charity.description}
						<p class="description">{charity.description}</p>
					{/if}

					{#if charity.website_url}
						<p class="website">
							<a href={charity.website_url} rel="noreferrer noopener" target="_blank">
								{charity.website_url}
							</a>
						</p>
					{/if}

					<dl class="wallet">
						<div>
							<dt>Wallet</dt>
							<dd>
								{#if charity.address}
									<span class="mono">{charity.address}</span>
								{:else}
									<!--
										Said plainly. A charity without a wallet cannot be
										selected, and a forfeit pointed at it would refuse.
									-->
									<span class="missing">None — cannot receive forfeited stakes</span>
								{/if}
							</dd>
						</div>
						<div>
							<dt>Received</dt>
							<dd>{charity.address ? formatSol(charity.lamports) : '—'}</dd>
						</div>
					</dl>

					<div class="charity-actions">
						{#if charity.address && charity.is_active && charity.id !== data.settings?.active_charity_id}
							<form method="POST" action="?/activateCharity" use:enhance>
								<input type="hidden" name="charity_id" value={charity.id} />
								<Button type="submit" size="sm">Send forfeits here</Button>
							</form>
						{/if}

						{#if !charity.address}
							<form method="POST" action="?/createCharityWallet" use:enhance>
								<input type="hidden" name="charity_id" value={charity.id} />
								<Button type="submit" variant="secondary" size="sm">Create wallet</Button>
							</form>
						{/if}

						<Button
							type="button"
							variant="quiet"
							size="sm"
							onclick={() => (editing = editing === charity.id ? null : charity.id)}
						>
							{editing === charity.id ? 'Cancel' : 'Edit details'}
						</Button>
					</div>

					{#if editing === charity.id}
						<!--
							The wallet is deliberately not editable. Its address is recorded
							on every forfeit that has gone to this charity, so replacing it
							would leave those donations pointing at an address nothing uses.
						-->
						<form
							method="POST"
							action="?/updateCharity"
							class="edit"
							use:enhance={() =>
								({ update }) => {
									editing = null;
									return update();
								}}
						>
							<input type="hidden" name="charity_id" value={charity.id} />

							<Field id="name-{charity.id}" label="Legal name">
								{#snippet children({ id })}
									<input {id} name="name" type="text" value={charity.name} required />
								{/snippet}
							</Field>

							<Field
								id="short-{charity.id}"
								label="Short name"
								hint="What people actually say, if it differs."
							>
								{#snippet children({ id })}
									<input {id} name="short_name" type="text" value={charity.short_name ?? ''} />
								{/snippet}
							</Field>

							<Field id="site-{charity.id}" label="Website" hint="Must start with https://">
								{#snippet children({ id })}
									<input {id} name="website_url" type="url" value={charity.website_url ?? ''} />
								{/snippet}
							</Field>

							<Field id="desc-{charity.id}" label="Description">
								{#snippet children({ id })}
									<textarea {id} name="description" rows="3">{charity.description ?? ''}</textarea>
								{/snippet}
							</Field>

							<label class="checkbox">
								<input type="checkbox" name="is_active" checked={charity.is_active} />
								<span>Listed and selectable</span>
							</label>

							<div class="charity-actions">
								<Button type="submit" size="sm">Save changes</Button>
							</div>
						</form>
					{/if}
				</Panel>
			{/each}
		</div>
	</section>

	<section>
		<h2 class="section-title">Add a charity</h2>

		<Panel>
			<p class="muted">
				A wallet is created at the same time. Without one the charity cannot be
				selected, so adding the two separately would only produce a record that
				looks complete and refuses to work.
			</p>

			<form method="POST" action="?/addCharity" class="edit" use:enhance>
				<Field id="new-name" label="Legal name" hint="As the organisation registers itself.">
					{#snippet children({ id })}
						<input {id} name="name" type="text" required />
					{/snippet}
				</Field>

				<Field id="new-short" label="Short name" hint="What people actually say. Optional.">
					{#snippet children({ id })}
						<input {id} name="short_name" type="text" />
					{/snippet}
				</Field>

				<Field id="new-site" label="Website" hint="Must start with https://">
					{#snippet children({ id })}
						<input {id} name="website_url" type="url" />
					{/snippet}
				</Field>

				<Field id="new-desc" label="Description" hint="One or two sentences on what they do.">
					{#snippet children({ id })}
						<textarea {id} name="description" rows="3"></textarea>
					{/snippet}
				</Field>

				<div class="charity-actions">
					<Button type="submit">Add charity</Button>
				</div>
			</form>
		</Panel>
	</section>

	<section>
		<h2 class="section-title">Scheduled resolver</h2>

		<Panel>
			<p class="muted">
				Expires unanswered requests, resolves no-shows, marks unverifiable
				meetups stale, and retries any settlement that failed earlier. Normally
				run on a schedule; this is the same function by hand. Safe to run
				repeatedly — nothing settles twice.
			</p>

			<div class="charity-actions">
				<form method="POST" action="?/runResolver" use:enhance>
					<Button type="submit" variant="secondary">Run now</Button>
				</form>
			</div>
		</Panel>
	</section>

	<section>
		<h2 class="section-title">Market configuration</h2>

		<Panel tone="sunken">
			{#if data.settings}
				<!--
					Read-only. These values govern stakes and deadlines for everyone, and
					an edit here changes commitments that are already in flight — so it
					belongs in a deliberate change with history, not in a text box beside
					the charity list. market_settings_history records every change.
				-->
				<dl class="config">
					<div><dt>Base stake</dt><dd>{(data.settings.base_commitment_fee_cents / 100).toFixed(2)} {data.settings.currency_code}</dd></div>
					<div><dt>Check-in radius</dt><dd>{data.settings.check_in_radius_metres} m</dd></div>
					<div><dt>Check-in window</dt><dd>{data.settings.check_in_window_minutes} min</dd></div>
					<div><dt>QR lifetime</dt><dd>{data.settings.qr_token_expiry_minutes} min</dd></div>
					<div><dt>Configured SOL price</dt><dd>{(data.settings.sol_price_cents / 100).toFixed(2)} {data.settings.currency_code}</dd></div>
				</dl>
				<p class="config-note">
					Changed through the database, not here. The configured SOL price is a
					display fallback — a purchase converts at a live quote.
				</p>
			{:else}
				<Alert tone="error">Market settings are missing. Nothing will work until they exist.</Alert>
			{/if}
		</Panel>
	</section>
</div>

<style>
	.banner {
		margin-bottom: var(--k-space-4);
	}

	.stack {
		display: grid;
		gap: var(--k-space-4);
	}

	section {
		display: grid;
		gap: var(--k-space-3);
	}

	.section-title {
		font-size: var(--k-text-sm);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
		color: var(--k-text-subtle);
	}

	.balance-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--k-space-3);
	}

	.label {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.balance {
		margin-top: var(--k-space-1);
		font-size: var(--k-text-2xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.balance-note {
		flex: 1 1 16rem;
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.active {
		font-size: var(--k-text-lg);
	}

	.muted {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.active + .muted {
		margin-top: var(--k-space-2);
	}

	.charity-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--k-space-3);
	}

	.charity-name h3 {
		font-size: var(--k-text-lg);
	}

	.legal {
		margin-top: var(--k-space-1);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
	}

	.description {
		margin-top: var(--k-space-3);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.website {
		margin-top: var(--k-space-2);
		font-size: var(--k-text-sm);
		overflow-wrap: anywhere;
	}

	.wallet {
		display: grid;
		gap: var(--k-space-3);
		margin-top: var(--k-space-4);
		padding-top: var(--k-space-3);
		border-top: var(--k-line-width) solid var(--k-line);
	}

	.wallet dt {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.wallet dd {
		margin: 0;
		margin-top: var(--k-space-1);
		font-size: var(--k-text-sm);
	}

	.mono {
		font-family: var(--k-font-mono);
		overflow-wrap: anywhere;
		user-select: all;
	}

	.missing {
		color: var(--k-warning);
	}

	.charity-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
		margin-top: var(--k-space-4);
	}

	.edit {
		display: grid;
		gap: var(--k-space-4);
		margin-top: var(--k-space-4);
		padding-top: var(--k-space-4);
		border-top: var(--k-line-width) solid var(--k-line);
	}

	.checkbox {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
		font-size: var(--k-text-sm);
	}

	.checkbox input {
		width: auto;
	}

	.config {
		display: grid;
		gap: var(--k-space-3);
	}

	@media (min-width: 40rem) {
		.config {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.config dt {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
	}

	.config dd {
		margin: 0;
		margin-top: var(--k-space-1);
		font-size: var(--k-text-sm);
		font-variant-numeric: tabular-nums;
	}

	.config-note {
		margin-top: var(--k-space-4);
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
	}
</style>
