<script lang="ts">
	import { faCircleInfo, faXmark } from '@fortawesome/free-solid-svg-icons';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { formatPrice } from '#lib/format';

	/**
	 * The reputation score, with its whole derivation available on request.
	 *
	 * WHY THE NUMBERS COME FROM THE DATABASE AND ARE NOT RECOMPUTED HERE
	 * ------------------------------------------------------------------
	 * Every figure below -- each rate, each weighted contribution, the total,
	 * the resulting stake -- is read from `my_reputation_breakdown()`, which
	 * computes them from the same row and the same weights the stored score was
	 * computed from.
	 *
	 * Recalculating the arithmetic in TypeScript to "show the working" would
	 * create a second implementation of the formula. The moment the two
	 * disagreed, the one the user was shown would be the wrong one -- and the
	 * entire point of this panel is that the number can be trusted. So this
	 * component formats and lays out; it does no arithmetic of its own beyond
	 * deciding whether the floor or the ceiling actually bound the fee.
	 *
	 * A DISCLOSURE, NOT A HOVER TOOLTIP. There is far too much here for a
	 * tooltip, and a hover target is unreachable on a touchscreen and hostile
	 * to anyone using a keyboard. This is a button that opens a panel, closes
	 * on Escape, and returns focus where it came from.
	 */

	interface Props {
		/** One row from `my_reputation_breakdown()`, or null if it could not be read. */
		breakdown: {
			successful: number;
			cancelled: number;
			checkins: number;
			total: number;
			success_rate: number | null;
			cancel_rate: number | null;
			checkin_rate: number | null;
			outcome_weight: number;
			checkin_weight: number;
			success_points: number | null;
			cancel_points: number | null;
			checkin_points: number | null;
			reputation: number;
			reputation_updated_at: string | null;
			market_reputation: number;
			market_reputation_weight: number;
			market_adjustment: number;
			base_fee_cents: number;
			adjusted_base_fee_cents: number;
			fee_cents: number;
			min_fee_cents: number;
			max_fee_cents: number;
		} | null;

		/** Fallback when the breakdown is unavailable but the score is known. */
		reputation?: number | null;
	}

	let { breakdown, reputation = null }: Props = $props();

	let open = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);

	const score = $derived(breakdown?.reputation ?? reputation);

	/** Three decimals, matching how the database rounds and stores it. */
	const show = (value: number | null | undefined, places = 4) =>
		value === null || value === undefined ? '—' : Number(value).toFixed(places);

	/**
	 * What the fee would be before the floor and the ceiling are applied.
	 *
	 * The ONE calculation this component does, and only so it can tell whether
	 * a bound actually bit. Saying "bounded to $1.00–$50.00" on a fee sitting
	 * comfortably between them is noise; saying nothing when the ceiling has
	 * just changed someone's stake would be hiding the reason.
	 */
	const unbounded = $derived(
		breakdown
			? Math.round(breakdown.adjusted_base_fee_cents / Math.max(breakdown.reputation, 0.001))
			: null
	);

	/**
	 * What this person's reputation is worth, in money, per commitment.
	 *
	 * Measured against the market-adjusted base, which is what a member of
	 * exactly average reliability puts down. That is the only comparison that
	 * means anything: the raw base fee is a number nobody actually pays, and
	 * comparing against it would credit someone for the market's behaviour as
	 * well as their own.
	 *
	 * Positive means their record saves them money.
	 */
	const impactCents = $derived(
		breakdown ? breakdown.adjusted_base_fee_cents - breakdown.fee_cents : 0
	);

	const clamped = $derived(unbounded !== null && breakdown !== null && unbounded !== breakdown.fee_cents);

	function close() {
		open = false;
		/** Focus goes back to the control that opened the panel, not to the page top. */
		trigger?.focus();
	}
</script>

<svelte:window onkeydown={(event) => { if (open && event.key === 'Escape') close(); }} />

<div class="wrap">
	<span class="score">{score === null ? 'Not calculated yet' : Number(score).toFixed(3)}</span>

	{#if breakdown}
		<button
			bind:this={trigger}
			type="button"
			class="info"
			aria-expanded={open}
			aria-controls="reputation-breakdown"
			onclick={() => (open = !open)}
		>
			<Icon icon={faCircleInfo} label={open ? 'Hide how this is worked out' : 'How this is worked out'} />
		</button>
	{/if}
</div>

{#if open && breakdown}
	<div class="panel k-cut k-outline" id="reputation-breakdown">
		<div class="panel-head">
			<h3>How this is worked out</h3>
			<button type="button" class="close" onclick={close}>
				<Icon icon={faXmark} label="Close" />
			</button>
		</div>

		{#if breakdown.total === 0}
			<!--
				No history is not a low score, and must not be shown as one. The
				formula's own answer for an empty record is exactly 1.000.
			-->
			<p class="empty">
				You have not taken part in any commitments yet, so there is nothing to
				score. Everyone starts at <strong>1.000</strong> — the formula's own
				value for an empty record — which is also why a new account is neither
				rewarded nor penalised on its first stake.
			</p>
		{:else}
			<section>
				<h4>Your record</h4>
				<table>
					<tbody>
						<tr><th scope="row">Successful meetups</th><td>{breakdown.successful}</td></tr>
						<tr><th scope="row">Cancelled or missed</th><td>{breakdown.cancelled}</td></tr>
						<tr><th scope="row">Check-ins</th><td>{breakdown.checkins}</td></tr>
						<tr class="sum">
							<th scope="row">
								Total commitments
								<span class="aside">every commitment you took part in</span>
							</th>
							<td>{breakdown.total}</td>
						</tr>
					</tbody>
				</table>
			</section>

			<section>
				<h4>Your rates</h4>
				<table>
					<tbody>
						<tr>
							<th scope="row">Success rate</th>
							<td class="work">{breakdown.successful} ÷ {breakdown.total}</td>
							<td>{show(breakdown.success_rate)}</td>
						</tr>
						<tr>
							<th scope="row">Cancel / miss rate</th>
							<td class="work">{breakdown.cancelled} ÷ {breakdown.total}</td>
							<td>{show(breakdown.cancel_rate)}</td>
						</tr>
						<tr>
							<th scope="row">Check-in rate</th>
							<td class="work">{breakdown.checkins} ÷ {breakdown.total}</td>
							<td>{show(breakdown.checkin_rate)}</td>
						</tr>
					</tbody>
				</table>
			</section>

			<section>
				<h4>Your score</h4>
				<table>
					<tbody>
						<tr><th scope="row">Starting point</th><td class="work"></td><td>1.0000</td></tr>
						<tr>
							<th scope="row">Success</th>
							<td class="work">{show(breakdown.success_rate)} × {breakdown.outcome_weight}</td>
							<td class="add">+{show(breakdown.success_points)}</td>
						</tr>
						<tr>
							<th scope="row">Cancelled or missed</th>
							<td class="work">{show(breakdown.cancel_rate)} × {breakdown.outcome_weight}</td>
							<td class="sub">−{show(breakdown.cancel_points)}</td>
						</tr>
						<tr>
							<th scope="row">Check-ins</th>
							<td class="work">{show(breakdown.checkin_rate)} × {breakdown.checkin_weight}</td>
							<td class="add">+{show(breakdown.checkin_points)}</td>
						</tr>
						<tr class="sum">
							<th scope="row">Your reputation</th>
							<td class="work"></td>
							<td>{Number(breakdown.reputation).toFixed(3)}</td>
						</tr>
					</tbody>
				</table>
			</section>
		{/if}

		<section>
			<h4>What it costs you</h4>
			<table>
				<tbody>
					<tr>
						<th scope="row">Base stake</th>
						<td class="work">set for the whole market</td>
						<td>{formatPrice(breakdown.base_fee_cents)}</td>
					</tr>
					<tr>
						<th scope="row">Market reputation</th>
						<td class="work">
							({(1).toFixed(3)} − {Number(breakdown.market_reputation).toFixed(3)})
							× {breakdown.market_reputation_weight}
						</td>
						<td class={Number(breakdown.market_adjustment) > 0 ? 'sub' : 'add'}>
							{Number(breakdown.market_adjustment) > 0 ? '+' : '−'}{Math.abs(
								Number(breakdown.market_adjustment) * 100
							).toFixed(2)}%
						</td>
					</tr>
					<tr class="sum">
						<th scope="row">
							Average member pays
							<span class="aside">the base after the market</span>
						</th>
						<td class="work"></td>
						<td>{formatPrice(breakdown.adjusted_base_fee_cents)}</td>
					</tr>
					<tr>
						<th scope="row">÷ your reputation</th>
						<td class="work"></td>
						<td>{Number(breakdown.reputation).toFixed(3)}</td>
					</tr>
					<tr class="sum">
						<th scope="row">You put down</th>
						<td class="work"></td>
						<td>{formatPrice(breakdown.fee_cents)}</td>
					</tr>
				</tbody>
			</table>

			{#if clamped && unbounded !== null}
				<!--
					Only shown when a bound actually changed the number. A note about
					limits on a fee sitting comfortably between them is noise, but
					silently clamping someone's stake and not saying so would hide the
					reason it is not what the arithmetic above implies.
				-->
				<p class="note">
					The formula gives {formatPrice(unbounded)}, held at
					{formatPrice(breakdown.fee_cents)} by the
					{unbounded > breakdown.fee_cents ? 'ceiling' : 'floor'} of
					{formatPrice(breakdown.min_fee_cents)}–{formatPrice(breakdown.max_fee_cents)}.
				</p>
			{:else}
				<p class="note">
					Every stake is held between {formatPrice(breakdown.min_fee_cents)} and
					{formatPrice(breakdown.max_fee_cents)}, whatever the formula gives.
				</p>
			{/if}

			<!--
				THE POINT OF THE WHOLE PANEL. A score of 1.175 means nothing to
				anybody until it is money, so the comparison is made explicitly and
				against the figure an average member actually pays.
			-->
			<p class="impact" data-direction={impactCents >= 0 ? 'saving' : 'costing'}>
				{#if impactCents > 0}
					Your record <strong>saves you {formatPrice(impactCents)}</strong> on every
					commitment, against the {formatPrice(breakdown.adjusted_base_fee_cents)} an
					average member puts down.
				{:else if impactCents < 0}
					Your record <strong>costs you {formatPrice(-impactCents)} extra</strong> on
					every commitment, against the
					{formatPrice(breakdown.adjusted_base_fee_cents)} an average member puts
					down. Completing meetups brings it back down.
				{:else}
					Your record puts you exactly at the market average, so you put down the
					same as everyone else.
				{/if}
			</p>

			<p class="note">
				Both adjustments pull the same way: being more reliable than average
				makes your stake smaller, and a market where people generally turn up
				charges everyone less.
			</p>
		</section>

		<!--
			Said explicitly, because the account page shows counters that do NOT
			appear anywhere above. Someone looking at a no-show on their record and
			an unchanged score deserves to know that is deliberate rather than
			wonder whether the page is broken.
		-->
		<p class="scope">
			Only successful meetups, commitments you cancelled or failed to attend,
			and your check-ins affect this score. Ignored requests, expired requests
			and unresolved commitments are recorded on your account but are not
			scored.
		</p>

		{#if breakdown.reputation_updated_at}
			<p class="scope">
				Last recalculated {new Intl.DateTimeFormat('en-CA', {
					dateStyle: 'medium',
					timeStyle: 'short'
				}).format(new Date(breakdown.reputation_updated_at))}.
			</p>
		{/if}
	</div>
{/if}

<style>
	.wrap {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
	}

	.score {
		font-variant-numeric: tabular-nums;
	}

	.info,
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		background: none;
		border: 0;
		color: var(--k-text-subtle);
		cursor: pointer;
	}

	.info:hover,
	.close:hover {
		color: var(--k-primary);
	}

	.panel {
		--k-cut: var(--k-cut-sm);

		margin-top: var(--k-space-3);
		padding: var(--k-space-4);
		background-color: var(--k-surface-sunken);
	}

	.panel-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--k-space-3);
	}

	.panel-head h3 {
		font-size: var(--k-text-sm);
		text-transform: uppercase;
		letter-spacing: var(--k-tracking-wide);
		color: var(--k-text-subtle);
	}

	section {
		margin-top: var(--k-space-4);
	}

	h4 {
		margin-bottom: var(--k-space-2);
		font-size: var(--k-text-sm);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--k-text-sm);
	}

	th,
	td {
		padding: var(--k-space-1) 0;
		text-align: left;
		font-weight: 400;
	}

	th {
		color: var(--k-text-muted);
	}

	/* The numbers column, right-aligned and tabular so the decimal points line
	   up down the page -- which is most of what makes a calculation readable. */
	td:last-child {
		width: 7rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/* The middle column shows the arithmetic rather than a result, so it is
	   quieter than both the label and the answer. */
	.work {
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		text-align: right;
		padding-right: var(--k-space-3);
		font-variant-numeric: tabular-nums;
	}

	.aside {
		display: block;
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
	}

	.sum th,
	.sum td {
		padding-top: var(--k-space-2);
		border-top: var(--k-line-width) solid var(--k-line-strong);
		font-weight: 600;
	}

	.sum th {
		color: var(--k-text);
	}

	/* Direction is carried by the sign in the text as well as the colour, so
	   the distinction survives for anyone who cannot see the difference. */
	.add {
		color: var(--k-primary);
	}

	.sub {
		color: var(--k-danger);
	}

	/* Louder than the notes around it, because this is the sentence someone
	   actually came to read. */
	.impact {
		margin-top: var(--k-space-4);
		padding: var(--k-space-3);
		background-color: var(--k-bg);
		font-size: var(--k-text-sm);
	}

	.impact[data-direction='saving'] {
		box-shadow: inset 3px 0 0 var(--k-primary);
	}

	.impact[data-direction='costing'] {
		box-shadow: inset 3px 0 0 var(--k-warning);
	}

	.empty,
	.note,
	.scope {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.note {
		margin-top: var(--k-space-3);
	}

	.scope {
		margin-top: var(--k-space-4);
		padding-top: var(--k-space-3);
		border-top: var(--k-line-width) solid var(--k-line);
		font-size: var(--k-text-xs);
	}
</style>
