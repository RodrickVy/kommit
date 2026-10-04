<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '#lib/components/ui/Button.svelte';
	import BrandMark from '#lib/components/layout/BrandMark.svelte';
	import { PRIMARY_NAV, isNavItemActive, visibleNavItems } from '#lib/config/navigation';
	import type { SessionUser } from '#lib/types/auth';

	/**
	 * AppHeader, the application's primary navigation bar.
	 *
	 * Rendered once by the root layout, so it is present on every page and is
	 * not re-created on navigation.
	 *
	 * Link labels and destinations come from `#lib/config/navigation`; nothing
	 * is hardcoded here. This component's job is presentation only.
	 */
	interface Props {
		/**
		 * The verified user for this request, or `null` when nobody is signed
		 * in. Supplied by the root layout, which is the only place the user is
		 * loaded, see `src/routes/+layout.server.ts`.
		 */
		user: SessionUser | null;

		/**
		 * Whether this user administers the marketplace, which reveals the
		 * Admin link. PRESENTATION ONLY, /admin guards itself, and hiding a
		 * link protects nothing. See the warning on `NavVisibility`.
		 */
		isAdmin?: boolean;

		/**
		 * The name other people see. Shown in place of the email, which is
		 * private; the email is only a fallback for an account with no name.
		 */
		displayName?: string | null;
	}

	let { user, isAdmin = false, displayName = null }: Props = $props();

	const identity = $derived(displayName?.trim() || user?.email || 'Signed in');

	/**
	 * Which links this visitor sees. Recomputed when `user` changes, which
	 * happens on sign-in and sign-out.
	 *
	 * This is visibility, not access control: the routes themselves are
	 * guarded server-side. See the warning on `NavVisibility`.
	 */
	const items = $derived(visibleNavItems(PRIMARY_NAV, user !== null, isAdmin));

	/** Mobile drawer state. Desktop never shows the toggle. */
	let menuOpen = $state(false);

	afterNavigate(() => {
		menuOpen = false;
	});
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') menuOpen = false;
	}}
/>

<!--
	The skip link is the first focusable thing in the document, so a keyboard
	or screen-reader user can jump past the navigation on every page instead of
	tabbing through six links to reach the content. It is positioned off-screen
	until focused.
-->
<a href="#main" class="skip-link k-cut">Skip to content</a>

<header class="header">
	<div class="inner">
		<a href="/" class="brand-link" aria-label="kommitly home">
			<BrandMark />
		</a>

		<!--
			`aria-label` distinguishes this landmark from any other navigation
			on the page, so assistive technology can announce "primary"
			rather than just "navigation".
		-->
		<nav class="nav" aria-label="Primary">
			<ul class="nav-list" role="list">
				{#each items as item (item.href)}
					{@const active = isNavItemActive(page.url.pathname, item)}
					<li>
						<a href={item.href} class="nav-link" aria-current={active ? 'page' : undefined}>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		<div class="account">
			{#if user}
				<span class="identity">{identity}</span>
				<Button href="/account" variant="secondary" size="sm">Account</Button>

				<!--
					A POST, not a link. A GET that changes state can be triggered by
					anything that prefetches a URL, and SvelteKit's CSRF origin check
					only covers form submissions.
				-->
				<form method="POST" action="/account?/signout">
					<Button type="submit" variant="quiet" size="sm">Sign out</Button>
				</form>
			{:else}
				<Button href="/signin" variant="quiet" size="sm">Sign in</Button>
				<Button href="/join" variant="primary" size="sm">Join</Button>
			{/if}
		</div>

		<button
			type="button"
			class="menu-toggle k-cut"
			aria-expanded={menuOpen}
			aria-controls="mobile-menu"
			onclick={() => (menuOpen = !menuOpen)}
		>
			<span class="k-visually-hidden">{menuOpen ? 'Close menu' : 'Open menu'}</span>
			<span class="bars" class:open={menuOpen} aria-hidden="true">
				<span></span><span></span><span></span>
			</span>
		</button>
	</div>
</header>

<!-- Mobile drawer. Closed on navigation, Escape, or a tap on the backdrop. -->
{#if menuOpen}
	<button
		type="button"
		class="backdrop"
		aria-label="Close menu"
		tabindex="-1"
		onclick={() => (menuOpen = false)}
	></button>
{/if}

<div id="mobile-menu" class="drawer" class:open={menuOpen} inert={!menuOpen}>
	<nav aria-label="Mobile">
		<ul class="drawer-list" role="list">
			{#each items as item (item.href)}
				{@const active = isNavItemActive(page.url.pathname, item)}
				<li>
					<a href={item.href} class="drawer-link" aria-current={active ? 'page' : undefined}>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="drawer-account">
		{#if user}
			<span class="drawer-identity">{identity}</span>
			<Button href="/account" variant="secondary">Account</Button>
			<form method="POST" action="/account?/signout">
				<Button type="submit" variant="quiet">Sign out</Button>
			</form>
		{:else}
			<Button href="/join" variant="primary">Join</Button>
			<Button href="/signin" variant="secondary">Sign in</Button>
		{/if}
	</div>
</div>

<style>
	/* -- skip link -------------------------------------------------------
	   Moved off-screen rather than hidden with `display: none`, because a
	   hidden element cannot receive focus and the link would be unreachable. */
	.skip-link {
		position: absolute;
		top: var(--k-space-2);
		left: var(--k-space-2);
		z-index: 10;
		padding: var(--k-space-2) var(--k-space-4);
		background-color: var(--k-primary);
		color: var(--k-on-primary);
		font-size: var(--k-text-sm);
		font-weight: 600;
		text-decoration: none;
		/* Pulled out of view until focused. */
		transform: translateY(-200%);
		transition: transform var(--k-duration-fast) var(--k-ease);
	}

	.skip-link:focus-visible {
		transform: translateY(0);
	}

	/* -- header shell ---------------------------------------------------- */
	.header {
		position: sticky;
		top: 0;
		z-index: 5;
		background-color: var(--k-bg);
		border-bottom: var(--k-line-width) solid var(--k-line);
	}

	.inner {
		display: flex;
		align-items: center;
		gap: var(--k-space-5);
		/* Matches the page container in `+layout.svelte`, so the brand lines
		   up with the content below it. */
		max-width: var(--k-container);
		min-height: var(--k-header-h);
		margin-inline: auto;
		padding-inline: var(--k-space-4);
	}

	.brand-link {
		flex-shrink: 0;
		text-decoration: none;
	}

	/* -- navigation ------------------------------------------------------- */
	.nav {
		flex: 1;
		min-width: 0;
	}

	.nav-list {
		display: flex;
		align-items: center;
		gap: var(--k-space-1);
		margin: 0;
	}

	.nav-link {
		display: block;
		padding: var(--k-space-2) var(--k-space-3);
		color: var(--k-text-muted);
		font-size: var(--k-text-sm);
		text-decoration: none;
		white-space: nowrap;
		transition: color var(--k-duration-fast) var(--k-ease);
	}

	.nav-link:hover {
		color: var(--k-text);
	}

	/* Styled from `aria-current` rather than a separate `.active` class, so
	   the accessible state and the visible state cannot diverge, one cannot
	   be set without the other. */
	.nav-link[aria-current='page'] {
		color: var(--k-accent);
		/* Flat underline, consistent with the app's cut-corner language. */
		box-shadow: inset 0 -2px 0 0 var(--k-primary);
	}

	/* -- account area ---------------------------------------------------- */
	.account {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: var(--k-space-2);
	}

	.identity {
		max-width: 18ch;
		overflow: hidden;
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 64rem) {
		.identity {
			display: none;
		}
	}

	/* -- mobile menu ------------------------------------------------------ */
	.menu-toggle {
		display: none;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		margin-left: auto;
		padding: 0;
		border: 0;
		background-color: var(--k-surface-raised);
		color: var(--k-text);
		cursor: pointer;
	}

	.menu-toggle:focus-visible {
		box-shadow: inset 0 0 0 2px var(--k-primary);
		outline: none;
	}

	.bars {
		display: grid;
		gap: 5px;
		width: 1.25rem;
	}

	.bars span {
		display: block;
		height: 2px;
		background-color: currentColor;
		transition: transform var(--k-duration-fast) var(--k-ease),
			opacity var(--k-duration-fast) var(--k-ease);
	}

	.bars.open span:nth-child(1) {
		transform: translateY(7px) rotate(45deg);
	}

	.bars.open span:nth-child(2) {
		opacity: 0;
	}

	.bars.open span:nth-child(3) {
		transform: translateY(-7px) rotate(-45deg);
	}

	.backdrop {
		position: fixed;
		inset: var(--k-header-h) 0 0 0;
		z-index: 6;
		padding: 0;
		border: 0;
		background-color: rgb(0 0 0 / 0.5);
	}

	.drawer {
		position: fixed;
		top: var(--k-header-h);
		right: 0;
		bottom: 0;
		z-index: 7;
		display: flex;
		flex-direction: column;
		gap: var(--k-space-5);
		width: min(20rem, 85vw);
		padding: var(--k-space-4);
		overflow-y: auto;
		background-color: var(--k-bg);
		box-shadow: inset var(--k-line-width) 0 0 0 var(--k-line);
		transform: translateX(100%);
		visibility: hidden;
		transition: transform var(--k-duration-fast) var(--k-ease),
			visibility 0s linear var(--k-duration-fast);
	}

	.drawer.open {
		transform: translateX(0);
		visibility: visible;
		transition: transform var(--k-duration-fast) var(--k-ease);
	}

	.drawer-list {
		display: grid;
		gap: var(--k-space-1);
		margin: 0;
	}

	.drawer-link {
		display: block;
		padding: var(--k-space-3);
		color: var(--k-text-muted);
		text-decoration: none;
	}

	.drawer-link:hover {
		color: var(--k-text);
		background-color: var(--k-surface-raised);
	}

	.drawer-link[aria-current='page'] {
		color: var(--k-accent);
		box-shadow: inset 3px 0 0 0 var(--k-primary);
	}

	.drawer-account {
		display: grid;
		gap: var(--k-space-2);
		padding-top: var(--k-space-4);
		border-top: var(--k-line-width) solid var(--k-line);
	}

	.drawer-account form,
	.drawer-account :global(.btn) {
		width: 100%;
	}

	.drawer-identity {
		overflow: hidden;
		color: var(--k-text-subtle);
		font-size: var(--k-text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 48rem) {
		.nav,
		.account {
			display: none;
		}

		.menu-toggle {
			display: inline-flex;
		}
	}

	/* The drawer is mobile-only even if left open while resizing wider. */
	@media (min-width: 48.01rem) {
		.drawer,
		.backdrop {
			display: none;
		}
	}
</style>
