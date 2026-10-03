<script lang="ts">
	import BrandMark from '#lib/components/layout/BrandMark.svelte';
	import { PUBLIC_SOLANA_NETWORK } from '$app/env/public';

	/**
	 * AppFooter — the page footer.
	 *
	 * Deliberately sparse. Its one functional job is to state which Solana
	 * cluster the app is pointed at.
	 *
	 * That indicator is not decoration: kommitly shows balances and signatures,
	 * and the same interface looks identical whether it is moving test tokens
	 * on devnet or real value on mainnet. Someone looking at a screenshot, a
	 * bug report or a support ticket needs to be able to tell which. It is
	 * read from the environment, so it reflects actual configuration rather
	 * than a hardcoded label that could go stale.
	 */

	/**
	 * Mainnet is the only cluster where value is real. Everything else is a
	 * test network and is labelled as such.
	 */
	const isLiveNetwork = PUBLIC_SOLANA_NETWORK === 'mainnet-beta';
</script>

<footer class="footer">
	<div class="inner">
		<BrandMark size="sm" />

		<p class="network" data-live={isLiveNetwork}>
			<!--
				The dot is decorative; the text beside it carries the meaning,
				so colour is never the only signal.
			-->
			<span class="dot" aria-hidden="true"></span>
			Solana
			<span class="cluster">{PUBLIC_SOLANA_NETWORK}</span>
			{#if !isLiveNetwork}
				<span class="qualifier">— test network, no real value</span>
			{/if}
		</p>
	</div>
</footer>

<style>
	.footer {
		margin-top: var(--k-space-8);
		border-top: var(--k-line-width) solid var(--k-line);
	}

	.inner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--k-space-4);
		/* Matches the header and the page container. */
		max-width: var(--k-container);
		margin-inline: auto;
		padding: var(--k-space-5) var(--k-space-4);
	}

	.network {
		display: flex;
		align-items: center;
		gap: var(--k-space-2);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.cluster {
		/* Monospace so the exact cluster string is unambiguous — this value
		   gets read aloud and copied into bug reports. */
		font-family: var(--k-font-mono);
		color: var(--k-text-muted);
	}

	.qualifier {
		color: var(--k-text-subtle);
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		/* Square, like everything else in kommitly. */
		background-color: var(--k-warning);
	}

	/* Teal only on mainnet, so the warning colour is the resting state and
	   "live" is the exception that has to be earned. */
	.network[data-live='true'] .dot {
		background-color: var(--k-success);
	}
</style>
