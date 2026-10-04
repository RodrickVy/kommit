<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	/**
	 * A freshly issued QR code, with the time it has left.
	 *
	 * Used for both codes, meetup verification and purchase, because the
	 * display problem is identical: show the code, say when it dies, offer to
	 * replace it. What each code MEANS is the caller's job to explain, and the
	 * two meanings must never be allowed to blur, so this component carries no
	 * wording of its own about stakes or payment.
	 *
	 * THE COUNTDOWN IS NOT DECORATION. The code is deliberately short-lived, so
	 * without a visible timer a seller holds out a phone, the buyer scans, and
	 * the result is a failure neither of them can explain. Showing the clock
	 * makes "ask them to refresh it" the obvious next move.
	 */

	interface Props {
		qr: {
			purpose: 'meetup_verification' | 'purchase';
			url: string;
			/** Pre-rendered SVG, or null when it could not be drawn. */
			svg: string | null;
			expiresAt: string;
		};

		/** Form action that issues a replacement, e.g. `?/showMeetupQr`. */
		refreshAction: string;

		/** What the other person should do with it. */
		instructions: string;
	}

	let { qr, refreshAction, instructions }: Props = $props();

	/**
	 * Ticks once a second so the countdown is live.
	 *
	 * `$effect` rather than a module-level interval: it is created when the
	 * component mounts and torn down when it unmounts, so a seller who
	 * navigates away does not leave a timer running.
	 */
	let now = $state(Date.now());

	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);

		return () => clearInterval(timer);
	});

	const secondsLeft = $derived(
		Math.max(0, Math.floor((new Date(qr.expiresAt).getTime() - now) / 1000))
	);

	const expired = $derived(secondsLeft === 0);

	const countdown = $derived(
		`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
	);

	let refreshing = $state(false);
</script>

<div class="qr-block">
	{#if expired}
		<!--
			Said before they try, not after it fails. An expired code still
			renders, and a seller holding out a dead one has no way to know.
		-->
		<Alert tone="error">
			This code has expired. Refresh it before showing it again.
		</Alert>
	{/if}

	<div class="layout" class:dim={expired}>
		{#if qr.svg}
			<!--
				Fixed white tile regardless of theme, a scanner needs the contrast.
				Marked decorative because the link below is the accessible
				equivalent of the same value.
			-->
			<div class="code" aria-hidden="true">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html qr.svg}
			</div>
		{:else}
			<!--
				The token is real even when the picture could not be drawn, so the
				link is offered rather than reporting a failure for something that
				worked.
			-->
			<div class="code-missing">
				<p>The code could not be drawn. Send this link instead.</p>
			</div>
		{/if}

		<div class="side">
			<p class="instructions">{instructions}</p>

			<p class="expiry">
				{#if expired}
					Expired
				{:else}
					Expires in <strong>{countdown}</strong>
				{/if}
			</p>

			<!--
				Shown so the code can be sent when scanning is impractical, two
				people on a video call, or a camera that will not focus. Opening it
				still requires the buyer's own session, so the link is no weaker
				than the picture.
			-->
			<details class="link">
				<summary>Show as a link</summary>
				<p class="url">{qr.url}</p>
			</details>

			<form
				method="POST"
				action={refreshAction}
				use:enhance={() => {
					refreshing = true;

					return async ({ update }) => {
						await update();
						refreshing = false;
					};
				}}
			>
				<Button type="submit" variant="secondary" size="sm" disabled={refreshing}>
					{refreshing ? 'Refreshing…' : 'Refresh code'}
				</Button>
			</form>
		</div>
	</div>
</div>

<style>
	.qr-block {
		display: grid;
		gap: var(--k-space-3);
	}

	.layout {
		display: flex;
		flex-wrap: wrap;
		gap: var(--k-space-4);
		align-items: flex-start;
	}

	/* Expired is dimmed rather than hidden: the person holding the phone should
	   see that something is there but wrong, not an empty space. */
	.dim {
		opacity: 0.4;
	}

	.code {
		flex: 0 0 auto;
		width: 11rem;
		padding: var(--k-space-2);
		background-color: #ffffff;
	}

	.code :global(svg) {
		display: block;
		width: 100%;
		height: auto;
	}

	.code-missing {
		flex: 0 0 auto;
		width: 11rem;
		padding: var(--k-space-3);
		background-color: var(--k-surface-sunken);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.side {
		flex: 1 1 14rem;
		min-width: 0;
		display: grid;
		gap: var(--k-space-3);
	}

	.instructions {
		font-size: var(--k-text-sm);
	}

	.expiry {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
		font-variant-numeric: tabular-nums;
	}

	.link summary {
		cursor: pointer;
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.url {
		margin-top: var(--k-space-2);
		padding: var(--k-space-2);
		background-color: var(--k-surface-sunken);
		font-family: var(--k-font-mono);
		font-size: var(--k-text-xs);
		overflow-wrap: anywhere;
		user-select: all;
	}
</style>
