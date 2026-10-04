<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Panel from '#lib/components/ui/Panel.svelte';
	import CheckInButton from '#lib/components/commitments/CheckInButton.svelte';
	import CheckInMap from '#lib/components/commitments/CheckInMap.svelte';
	import QrDisplay from '#lib/components/commitments/QrDisplay.svelte';
	import { formatPrice, formatSol } from '#lib/format';
	import { COMMITMENT_STATUS_LABELS, EVENT_LABELS, statusTone } from '#lib/commitments/labels';
	import type { PageProps } from './$types';
	import { explorerTxUrl } from '#lib/solana/explorer';

	/**
	 * Commitment detail — `/commitment/[commitment_id]`.
	 *
	 * One page for both parties. Which actions appear depends on role and
	 * status, decided on the server; every action re-checks before writing.
	 *
	 * The page is careful about one distinction above all others: verifying the
	 * meetup and buying the item are separate, and the second is optional. A
	 * buyer who turns up, looks at the item and leaves has fulfilled their
	 * commitment completely, and nothing here may imply otherwise.
	 */
	let { data, form }: PageProps = $props();

	const c = $derived(data.commitment);
	const TRANSFER_LABELS: Record<string, string> = {
		commitment_lock: 'Your stake put down',
		commitment_refund: 'Your stake returned',
		commitment_forfeit: 'Stake forfeited to charity'
	};

	/** Every on-chain transfer this viewer can see for this commitment. */
	const receipts = $derived([
		...data.transfers.map((t) => ({
			label: TRANSFER_LABELS[t.type] ?? 'Transfer',
			lamports: t.lamports,
			signature: t.solana_signature!
		})),
		...(data.payment?.status === 'completed' && data.payment.solana_signature
			? [
					{
						label: data.isBuyer ? 'Item payment' : 'Item payment received',
						lamports: data.payment.amount_lamports,
						signature: data.payment.solana_signature
					}
				]
			: [])
	]);

	const myStake = $derived(data.isBuyer ? c.buyer_stake_cents : c.seller_stake_cents);
	const myStakeLamports = $derived(
		data.isBuyer ? c.buyer_stake_lamports : c.seller_stake_lamports
	);

	const iCheckedIn = $derived(data.isBuyer ? c.buyer_checked_in_at : c.seller_checked_in_at);
	const theyCheckedIn = $derived(data.isBuyer ? c.seller_checked_in_at : c.buyer_checked_in_at);
	const bothCheckedIn = $derived(Boolean(iCheckedIn && theyCheckedIn));

	/** Shown in the viewer's own timezone — both parties mean the same instant. */
	function at(iso: string): string {
		return new Intl.DateTimeFormat('en-CA', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(iso));
	}

	/** The meetup's calendar day, in the marketplace's zone, as check-in uses. */
	function meetupDate(iso: string): string {
		return new Intl.DateTimeFormat('en-CA', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			timeZone: 'America/Vancouver'
		}).format(new Date(iso));
	}

	function time(iso: string): string {
		return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(
			new Date(iso)
		);
	}

	/**
	 * What has actually happened to this viewer's stake.
	 *
	 * Written per status rather than as one hopeful sentence, because every one
	 * of these is a claim about the viewer's money. "Held" when it is not, or
	 * "returned" when the transfer failed, is the kind of statement they would
	 * only disprove by checking their balance.
	 */
	const stakeNote = $derived.by(() => {
		const iAmResponsible = c.responsible_party === (data.isBuyer ? 'buyer' : 'seller');

		switch (c.status) {
			case 'pending':
				return data.isBuyer
					? 'Held since you sent the request. It comes back if the seller declines or never answers.'
					: 'Not taken yet. It is only held once you accept.';
			case 'accepted':
				return 'Held until the meetup is verified, then returned.';
			case 'completed':
				return 'Returned. Verifying the meetup released both stakes.';
			case 'declined':
			case 'expired':
				return data.isBuyer ? 'Refunded in full.' : 'Nothing was taken.';
			case 'stale':
				return 'Returned. Nobody was blamed, so neither stake was forfeited.';
			case 'cancelled':
			case 'no_show':
				return iAmResponsible
					? 'Forfeited to the selected charity.'
					: 'Refunded in full.';
			default:
				return 'Nothing is held.';
		}
	});
</script>

<svelte:head>
	<title>Commitment · kommitly</title>
</svelte:head>

<PageHeader title={c.listings?.title ?? 'Commitment'}>
	{#snippet actions()}
		<Badge tone="muted">{data.isBuyer ? 'Buying' : 'Selling'}</Badge>
		<Badge tone={statusTone(c.status)}>
			{data.expired ? 'Expired' : COMMITMENT_STATUS_LABELS[c.status]}
		</Badge>
	{/snippet}
</PageHeader>

{#if form?.actionError}
	<div class="banner">
		<Alert tone="error">{form.actionError}</Alert>
		{#if form.needsFunds}
			<!--
				The seller could not cover their stake, so acceptance did not
				happen. Worth saying plainly: the buyer's stake is untouched and the
				request is still open, so topping up and accepting again costs
				nothing.
			-->
			<div class="fund">
				<Button href="/wallet/fund_wallet" variant="secondary" size="sm">Add funds</Button>
				<p class="fund-note">
					Nothing was taken. The request is still open — add funds and accept
					again.
				</p>
			</div>
		{/if}
	</div>
{:else if form?.message}
	<div class="banner"><Alert tone="success">{form.message}</Alert></div>
{/if}

<div class="layout">
	<div class="main">
		<Panel>
			<h2 class="panel-title">The meetup</h2>
			<dl class="pairs">
				<div class="pair">
					<dt>When</dt>
					<dd>{at(c.scheduled_at)}</dd>
				</div>
				<div class="pair">
					<dt>Where</dt>
					<dd>{c.meetup_locations?.name ?? 'Location removed'}</dd>
				</div>
				<div class="pair">
					<dt>Item</dt>
					<dd>
						{#if c.listings}
							<a href="/sell/{c.listings.id}">{c.listings.title}</a>
							· {formatPrice(c.listings.price_cents)}
						{:else}
							Listing removed
						{/if}
					</dd>
				</div>
			</dl>

			<!--
				Said prominently because it is the most misunderstood thing about the
				product: the stake is not a deposit on the item.
			-->
			<div class="note">
				<Alert tone="info">
					A commitment to <strong>meet</strong>, not to buy. Show up, verify the
					meetup, and your stake comes back — whether or not anything is bought.
				</Alert>
			</div>
		</Panel>

		{#if c.status === 'accepted' && !data.expired}
			<Panel>
				<h2 class="panel-title">Arriving</h2>

				<!--
					Both sides' state, always. Each person's next move depends on
					whether the other is there yet, and the alternative is two people
					standing in the same car park refreshing a page that tells them
					nothing.
				-->
				<ul class="arrivals" role="list">
					<li class:in={Boolean(iCheckedIn)}>
						<span class="who">You</span>
						<span class="state">
							{iCheckedIn ? `Checked in at ${time(iCheckedIn)}` : 'Not checked in'}
						</span>
					</li>
					<li class:in={Boolean(theyCheckedIn)}>
						<span class="who">{data.isBuyer ? 'Seller' : 'Buyer'}</span>
						<span class="state">
							{theyCheckedIn ? `Arrived at ${time(theyCheckedIn)}` : 'Not here yet'}
						</span>
					</li>
				</ul>

				{#if !bothCheckedIn}
					<!--
						Check-in, verification and payment are all open for the whole
						meetup day. Not arriving by the end of that day is a no-show.
					-->
					<p class="deadline">
						{#if iCheckedIn}
							They have until the end of {meetupDate(c.scheduled_at)} to check in. If
							they do not, it is recorded as their no-show and your stake comes back.
						{:else}
							Check in any time on {meetupDate(c.scheduled_at)}, at the agreed place.
							Not checking in that day is recorded as your no-show, which forfeits
							your stake.
						{/if}
					</p>
				{/if}

				{#if !iCheckedIn}
					{#if c.meetup_locations && data.settings}
						<CheckInMap
							latitude={c.meetup_locations.latitude}
							longitude={c.meetup_locations.longitude}
							radiusMetres={data.settings.check_in_radius_metres}
							name={c.meetup_locations.name}
						/>
					{/if}
					<div class="actions">
						<CheckInButton action="?/checkIn" />
					</div>
					{#if data.settings}
						<p class="muted">
							You need to be within {data.settings.check_in_radius_metres}m of
							{c.meetup_locations?.name ?? 'the agreed location'}. Your browser will
							ask for permission to read your location.
						</p>
					{/if}
				{:else if !bothCheckedIn}
					<p class="muted">You are checked in. Waiting for the other person to arrive.</p>
				{/if}

				{#if bothCheckedIn}
					<!--
						THE SECOND STEP, and deliberately not automatic. Both being
						checked in means both devices report the right place; scanning
						the code is what proves the two people are actually together.
					-->
					<div class="verify">
						<h3 class="sub-title">Verify the meetup</h3>

						{#if data.isBuyer}
							<p class="muted">
								Ask the seller to show their verification code, then scan it with
								your phone's camera. Scanning it completes the commitment and
								returns both stakes — it does not buy anything.
							</p>
						{:else}
							{#if form?.qr?.purpose === 'meetup_verification'}
								<QrDisplay
									qr={form.qr}
									refreshAction="?/showMeetupQr"
									instructions="The buyer scans this with their phone. It verifies the meetup and returns both stakes — it does not take payment."
								/>
							{:else}
								<p class="muted">
									Show this code to the buyer. Scanning it verifies the meetup and
									returns both stakes. It does not take payment.
								</p>
								<div class="actions">
									<form method="POST" action="?/showMeetupQr" use:enhance>
										<Button type="submit">Show verification code</Button>
									</form>
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			</Panel>
		{/if}

		{#if c.status === 'completed'}
			<Panel tone="raised">
				<h2 class="panel-title">Commitment complete</h2>

				<p class="complete">
					You met, and the meetup is verified. Your commitment stake has been
					returned.
				</p>

				{#if data.payment?.status === 'completed'}
					<!--
						Rendered before the purchase prompt, so a completed sale never
						sits underneath an invitation to buy.
					-->
					<div class="paid">
						<Alert tone="success">
							Paid {formatPrice(data.payment.amount_cents)}
							({formatSol(data.payment.amount_lamports)}) for this item.
						</Alert>
						{#if data.payment.solana_signature}
							<p class="muted">
								<a href={explorerTxUrl(data.payment.solana_signature)} target="_blank" rel="noopener noreferrer">
									View payment receipt on Solana Explorer ↗
								</a>
							</p>
						{/if}
					</div>
				{:else if c.listings?.status === 'sold'}
					<p class="muted">This item has been sold.</p>
				{:else}
					<!--
						THE INSPECTION STAGE. The commitment is already fulfilled, so the
						wording has to make walking away the equal option rather than the
						one you decline into.
					-->
					<div class="inspect">
						<h3 class="sub-title">Buying is optional</h3>

						{#if data.isBuyer}
							<p class="muted">
								Take your time with the item. You can walk away now with no
								penalty — your stake is already back. If you do want it, ask the
								seller to show their purchase code.
							</p>
							{#if c.listings}
								<p class="price">
									{c.listings.title} · <strong>{formatPrice(c.listings.price_cents)}</strong>
								</p>
							{/if}
						{:else if form?.qr?.purpose === 'purchase'}
							<QrDisplay
								qr={form.qr}
								refreshAction="?/showPaymentQr"
								instructions="The buyer scans this to open a payment page. Scanning alone charges nothing — they still have to confirm the amount."
							/>
						{:else}
							<p class="muted">
								If the buyer wants the item, show them this code. It opens a
								payment page for them; scanning it does not take money on its
								own.
							</p>
							<div class="actions">
								<form method="POST" action="?/showPaymentQr" use:enhance>
									<Button type="submit">Show purchase code</Button>
								</form>
							</div>
						{/if}
					</div>
				{/if}
			</Panel>
		{/if}

		{#if c.status === 'stale'}
			<Panel>
				<h2 class="panel-title">Closed without blame</h2>
				<p class="muted">
					This commitment could not be resolved from the evidence available, so
					it was marked unresolved and <strong>both stakes were returned</strong>.
					Nobody was penalised and nothing was recorded against either of you.
				</p>
			</Panel>
		{:else if c.status === 'no_show'}
			<Panel>
				<h2 class="panel-title">
					{c.responsible_party === (data.isBuyer ? 'buyer' : 'seller')
						? 'Recorded as your no-show'
						: 'The other person did not arrive'}
				</h2>
				<p class="muted">
					{#if c.responsible_party === (data.isBuyer ? 'buyer' : 'seller')}
						You did not check in at the agreed location on the meetup day, so
						your stake was forfeited to the selected charity and the other
						person was refunded.
					{:else}
						They never checked in, so your stake was returned in full and theirs
						was forfeited to the selected charity.
					{/if}
				</p>
			</Panel>
		{:else if c.status === 'expired'}
			<Panel>
				<h2 class="panel-title">The seller never responded</h2>
				<p class="muted">
					{data.isBuyer
						? 'This request expired without an answer, so your stake was refunded in full. You can send a new request.'
						: 'This request expired without your answer. The buyer was refunded and nothing was taken from you — but declining promptly is free, and ignoring requests is recorded.'}
				</p>
			</Panel>
		{/if}

		<Panel>
			<h2 class="panel-title">History</h2>
			{#if data.events.length === 0}
				<p class="muted">Nothing recorded yet.</p>
			{:else}
				<ol class="timeline" role="list">
					{#each data.events as event (event.id)}
						<li>
							<span>{EVENT_LABELS[event.event_type]}</span>
							<span class="when">{at(event.occurred_at)}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</Panel>
	</div>

	<aside class="side">
		<Panel>
			<h2 class="panel-title">Your stake</h2>
			<p class="stake">{formatPrice(myStake)}</p>

			<!--
				The lamport figure is the amount that actually moved, and it is what
				a refund returns — not a reconversion of the dollar amount. Shown
				where it exists so the two numbers never appear to disagree.
			-->
			{#if myStakeLamports}
				<p class="stake-sol">{formatSol(myStakeLamports)}</p>
			{/if}

			<p class="muted">{stakeNote}</p>
		</Panel>

		{#if receipts.length > 0}
			<!-- Public, verifiable proof of every transfer this viewer was part of. -->
			<Panel>
				<h2 class="panel-title" id="receipts">Solana receipts</h2>
				<ul class="receipts" role="list">
					{#each receipts as receipt (receipt.signature)}
						<li>
							<span class="receipt-label">{receipt.label}</span>
							<span class="receipt-amount">{formatSol(receipt.lamports)}</span>
							<a href={explorerTxUrl(receipt.signature)} target="_blank" rel="noopener noreferrer">
								View on Solana Explorer ↗
							</a>
						</li>
					{/each}
				</ul>
			</Panel>
		{/if}

		<Panel>
			<h2 class="panel-title">What you can do</h2>

			{#if data.expired}
				<p class="muted">
					This request expired without a response. The buyer can send a new one.
				</p>
			{:else if c.status === 'pending' && !data.isBuyer}
				<p class="muted">
					Accepting commits you both and takes your stake. Declining is free and
					is not held against you.
				</p>
				<div class="actions">
					<form method="POST" action="?/accept" use:enhance>
						<Button type="submit">Accept</Button>
					</form>
					<form method="POST" action="?/decline" use:enhance>
						<Button type="submit" variant="secondary">Decline</Button>
					</form>
				</div>
			{:else if c.status === 'pending'}
				<p class="muted">Waiting for the seller. They have until {at(c.request_expires_at)}.</p>
				<div class="actions">
					<form method="POST" action="?/withdraw" use:enhance>
						<Button type="submit" variant="secondary">Withdraw request</Button>
					</form>
				</div>
			{:else if c.status === 'accepted'}
				<p class="muted">
					You are both committed. Cancelling now forfeits your stake and refunds
					the other person.
				</p>
				<div class="actions">
					<form
						method="POST"
						action="?/cancel"
						onsubmit={(event) => {
							if (!confirm('Cancel this commitment? You would forfeit your stake.')) {
								event.preventDefault();
							}
						}}
					>
						<Button type="submit" variant="quiet">Cancel commitment</Button>
					</form>
				</div>
			{:else}
				<p class="muted">
					This commitment is closed.
					{#if c.responsible_party}
						Recorded against the {c.responsible_party}.
					{/if}
				</p>
			{/if}
		</Panel>
	</aside>
</div>

<style>
	.banner {
		margin-bottom: var(--k-space-4);
	}

	.fund {
		margin-top: var(--k-space-3);
	}

	.fund-note {
		margin-top: var(--k-space-2);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--k-space-4);
		align-items: start;
	}

	@media (min-width: 60rem) {
		.layout {
			grid-template-columns: minmax(0, 1fr) 20rem;
		}
	}

	.main,
	.side {
		display: grid;
		gap: var(--k-space-4);
		min-width: 0;
	}

	.panel-title {
		margin-bottom: var(--k-space-3);
		font-size: var(--k-text-lg);
	}

	.sub-title {
		margin-bottom: var(--k-space-2);
		font-size: var(--k-text-sm);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
		color: var(--k-text-subtle);
	}

	.pairs {
		display: grid;
		gap: var(--k-space-3);
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

	.note {
		margin-top: var(--k-space-5);
	}

	.arrivals {
		display: grid;
		gap: var(--k-space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.arrivals li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--k-space-3);
		padding: var(--k-space-3);
		background-color: var(--k-surface-sunken);
		font-size: var(--k-text-sm);
	}

	/* Arrival is marked with a left edge as well as colour, so the state is not
	   carried by hue alone. */
	.arrivals li.in {
		box-shadow: inset 3px 0 0 var(--k-primary);
	}

	.who {
		font-weight: 600;
	}

	.state {
		color: var(--k-text-muted);
	}

	.deadline {
		margin-top: var(--k-space-3);
		color: var(--k-warning);
		font-size: var(--k-text-sm);
	}

	.verify,
	.inspect {
		margin-top: var(--k-space-5);
		padding-top: var(--k-space-4);
		border-top: var(--k-line-width) solid var(--k-line);
	}

	.complete {
		font-size: var(--k-text-sm);
	}

	.paid {
		margin-top: var(--k-space-4);
	}

	.price {
		margin-top: var(--k-space-3);
		font-size: var(--k-text-sm);
	}

	.timeline {
		display: grid;
		gap: var(--k-space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.timeline li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--k-space-3);
		padding-bottom: var(--k-space-2);
		border-bottom: var(--k-line-width) solid var(--k-line);
		font-size: var(--k-text-sm);
	}

	.when {
		color: var(--k-text-subtle);
	}


	.stake {
		font-size: var(--k-text-2xl);
		font-weight: 600;
	}

	.stake-sol {
		margin-top: var(--k-space-1);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
		font-variant-numeric: tabular-nums;
	}

	.muted {
		margin-top: var(--k-space-2);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-2);
		margin-top: var(--k-space-4);
	}

	.receipts {
		display: grid;
		gap: var(--k-space-3);
		margin: 0;
		font-size: var(--k-text-sm);
	}

	.receipts li {
		display: grid;
		gap: var(--k-space-1);
		padding-bottom: var(--k-space-3);
		border-bottom: var(--k-line-width) solid var(--k-line);
	}

	.receipts li:last-child {
		padding-bottom: 0;
		border-bottom: 0;
	}

	.receipt-label {
		font-weight: 600;
	}

	.receipt-amount {
		color: var(--k-text-subtle);
		font-family: var(--k-font-mono);
	}
</style>
