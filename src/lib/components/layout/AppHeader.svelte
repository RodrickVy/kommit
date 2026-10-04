<script lang="ts">
	import { page } from '$app/state';
	import Button from '#lib/components/ui/Button.svelte';
	import BrandMark from '#lib/components/layout/BrandMark.svelte';
	import { PRIMARY_NAV, isNavItemActive, visibleNavItems } from '#lib/config/navigation';
	import type { SessionUser } from '#lib/types/auth';

	/**
	 * AppHeader — the application's primary navigation bar.
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
		 * loaded — see `src/routes/+layout.server.ts`.
		 */
		user: SessionUser | null;
	}

	let { user }: Props = $props();

	/**
	 * Which links this visitor sees. Recomputed when `user` changes, which
	 * happens on sign-in and sign-out.
	 *
	 * This is visibility, not access control: the routes themselves are
	 * guarded server-side. See the warning on `NavVisibility`.
	 */
	const items = $derived(visibleNavItems(PRIMARY_NAV, user !== null));
</script>

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
						<!--
							`aria-current="page"` is what actually tells a
							screen reader which link is the current location.
							The colour change alone conveys nothing to someone
							who cannot see it.
						-->
						<a href={item.href} class="nav-link" aria-current={active ? 'page' : undefined}>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		<div class="account">
			{#if user}
				<!--
					The email is the clearest confirmation of WHICH account is
					signed in, which matters for an app holding a wallet. It is
					hidden on narrow viewports, where the Account link alone
					has to do.
				-->
				<span class="identity">{user.email ?? 'Signed in'}</span>
				<Button href="/account" variant="secondary" size="sm">Account</Button>

				<!--
					A POST, not a link. A GET that changes state can be triggered by
					anything that prefetches a URL — the browser's own preloading
					included — and SvelteKit's CSRF origin check only covers form
					submissions.

					`action` is absolute so this works from any page, not only from
					/account where the handler lives.
				-->
				<form method="POST" action="/account?/signout">
					<Button type="submit" variant="quiet" size="sm">Sign out</Button>
				</form>
			{:else}
				<Button href="/signin" variant="quiet" size="sm">Sign in</Button>
				<Button href="/join" variant="primary" size="sm">Join</Button>
			{/if}
		</div>
	</div>
</header>

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

	/* -- navigation -------------------------------------------------------
	   NARROW VIEWPORTS: the list scrolls horizontally rather than collapsing
	   into a menu button. This is a deliberate interim choice — it needs no
	   JavaScript and nothing becomes unreachable. A proper disclosure menu is
	   a design decision to make once the navigation stops growing. */
	.nav {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		/* Hide the horizontal scrollbar on platforms that draw a persistent
		   one; the overflow is still scrollable by touch, wheel and keyboard. */
		scrollbar-width: none;
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
	   the accessible state and the visible state cannot diverge — one cannot
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

	@media (max-width: 40rem) {
		.identity {
			display: none;
		}
	}
</style>
