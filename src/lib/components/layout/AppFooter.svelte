<script lang="ts">
	import { page } from '$app/state';
	import { PUBLIC_SOLANA_NETWORK } from '$app/env/public';
	import BrandMark from '#lib/components/layout/BrandMark.svelte';

	/**
	 * AppFooter, brand, the site's links, and which Solana network is in use.
	 *
	 * The network notice is not decoration: the same interface looks identical
	 * whether it is moving test tokens on devnet or real value on mainnet, and a
	 * screenshot or support ticket needs to say which. It is read from the
	 * environment, so it cannot go stale.
	 */
	const isLiveNetwork = PUBLIC_SOLANA_NETWORK === 'mainnet-beta';
	const year = new Date().getFullYear();

	/** Account links depend on whether someone is signed in. */
	const signedIn = $derived(page.data.user != null);
</script>

<footer class="footer">
	<div class="inner">
		<div class="top">
			<div class="brand">
				<a href="/" class="brand-link" aria-label="kommitly home">
					<BrandMark size="sm" />
				</a>
				<p class="tagline">
					Local buying and selling, backed by a refundable commitment to show up.
				</p>
			</div>

			<nav class="links" aria-label="Footer">
				<div class="column">
					<h2 class="heading">Marketplace</h2>
					<ul role="list">
						<li><a href="/discover">Discover</a></li>
						<li><a href="/sell">Sell</a></li>
						<li><a href="/commitments">Commitments</a></li>
					</ul>
				</div>

				<div class="column">
					<h2 class="heading">Account</h2>
					<ul role="list">
						{#if signedIn}
							<li><a href="/wallet">Wallet</a></li>
							<li><a href="/account">Account</a></li>
						{:else}
							<li><a href="/join">Create an account</a></li>
							<li><a href="/signin">Sign in</a></li>
						{/if}
					</ul>
				</div>

				<div class="column">
					<h2 class="heading">Community</h2>
					<ul role="list">
						<li><a href="/impact">Impact</a></li>
						<li><a href="/stats">Stats</a></li>
					</ul>
				</div>
			</nav>
		</div>

		<div class="bottom">
			<p class="copyright">© {year} kommitly</p>

			<p class="network" data-live={isLiveNetwork}>
				<!-- The dot is decorative; the text carries the meaning. -->
				<span class="dot" aria-hidden="true"></span>
				Solana
				<span class="cluster">{PUBLIC_SOLANA_NETWORK}</span>
				{#if !isLiveNetwork}
					<span>· test network, no real value</span>
				{/if}
			</p>
		</div>
	</div>
</footer>

<style>
	.footer {
		margin-top: var(--k-space-8);
		border-top: var(--k-line-width) solid var(--k-line);
		background-color: var(--k-surface-raised);
	}

	.inner {
		display: grid;
		gap: var(--k-space-6);
		/* Matches the header and the page container. */
		max-width: var(--k-container);
		margin-inline: auto;
		padding: var(--k-space-7) var(--k-space-4) var(--k-space-5);
	}

	.top {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr);
		gap: var(--k-space-6);
	}

	.brand {
		display: grid;
		gap: var(--k-space-3);
		align-content: start;
	}

	.brand-link {
		justify-self: start;
		text-decoration: none;
	}

	.tagline {
		max-width: 32ch;
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
	}

	.links {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--k-space-4);
	}

	.heading {
		margin-bottom: var(--k-space-3);
		color: var(--k-text-subtle);
		font-size: var(--k-text-xs);
		font-weight: 600;
		letter-spacing: var(--k-tracking-wide);
		text-transform: uppercase;
	}

	.column ul {
		display: grid;
		gap: var(--k-space-2);
		margin: 0;
	}

	.column a {
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
		text-decoration: none;
	}

	.column a:hover {
		color: var(--k-text);
		text-decoration: underline;
	}

	.bottom {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--k-space-3);
		padding-top: var(--k-space-4);
		border-top: var(--k-line-width) solid var(--k-line);
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
	}

	.network {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--k-space-2);
	}

	.cluster {
		/* Monospace so the exact cluster string is unambiguous in bug reports. */
		font-family: var(--k-font-mono);
		color: var(--k-text-muted);
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		background-color: var(--k-warning);
	}

	.network[data-live='true'] .dot {
		background-color: var(--k-success);
	}

	@media (max-width: 48rem) {
		.top {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 30rem) {
		.links {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
