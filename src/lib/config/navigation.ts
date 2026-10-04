/**
 * The application's navigation map.
 *
 * This is the single source of truth for kommitly's primary navigation. The
 * header renders from this array; nothing hardcodes a link label or path.
 * Adding a destination means adding one entry here.
 *
 * A route still has to exist under `src/routes` — this file describes how to
 * present the navigation, it does not create routes.
 */

/**
 * Who a navigation link is shown to.
 *
 * THIS IS PRESENTATION ONLY AND ENFORCES NOTHING.
 *
 * Hiding a link does not protect the route behind it: anyone can type the URL.
 * Access control belongs in two places and nowhere else —
 *
 *   1. a guard in the route's own `+layout.server.ts` or `+page.server.ts`,
 *      which redirects an anonymous visitor to `/signin`
 *   2. Row Level Security policies in the database, which are what actually
 *      stop one user reading another's rows
 *
 * The field is named for visibility rather than permission precisely so that
 * it cannot be mistaken for a security boundary.
 */
export type NavVisibility =
	/** Shown to everyone, signed in or not. */
	| 'public'
	/** Shown only once a verified user is present. */
	| 'authenticated'
	/** Shown only to a user whose profile carries `is_admin`. */
	| 'admin';

/** One entry in the primary navigation. */
export interface NavItem {
	/** Text shown to the user. Sentence case, no trailing punctuation. */
	readonly label: string;

	/** Absolute path within the app, with no trailing slash. */
	readonly href: string;

	/** Who sees this link. See the warning on {@link NavVisibility}. */
	readonly visibility: NavVisibility;

	/**
	 * Extra path prefixes that should also mark this link as the current
	 * location.
	 *
	 * Needed where a list page and its detail pages do not share a path
	 * prefix. `/commitments` lists commitments while a single one lives at
	 * `/commitment/:id`, so without this the nav would show nothing as
	 * active while the user is looking at a commitment.
	 */
	readonly activeFor?: readonly string[];
}

/**
 * Primary navigation, in the order it is rendered.
 *
 * Kept flat deliberately. Once this outgrows a single row it should become
 * grouped sections rather than a longer list — that decision belongs with
 * the header component, not here.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
	{ label: 'Discover', href: '/discover', visibility: 'public' },
	{ label: 'Commitments', href: '/commitments', visibility: 'authenticated', activeFor: ['/commitment', '/check-in'] },
	{ label: 'Sell', href: '/sell', visibility: 'authenticated' },
	{ label: 'Wallet', href: '/wallet', visibility: 'authenticated' },
	{ label: 'Impact', href: '/impact', visibility: 'public' },
	{ label: 'Stats', href: '/stats', visibility: 'public' },
	{ label: 'Admin', href: '/admin', visibility: 'admin' }
] as const;

/**
 * Whether a navigation entry represents the page currently being viewed.
 *
 * @param pathname The current path, from `page.url.pathname`.
 * @param item     The entry being rendered.
 * @returns `true` if this entry should be marked as current.
 */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
	/**
	 * The home route is matched exactly. Every path begins with `/`, so a
	 * prefix test would mark it active everywhere.
	 */
	if (item.href === '/') {
		return pathname === '/';
	}

	for (const prefix of [item.href, ...(item.activeFor ?? [])]) {
		/**
		 * Either the exact page, or something nested below it. The trailing
		 * slash in the prefix test is what stops `/sell` matching `/selling`.
		 */
		if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
			return true;
		}
	}

	return false;
}

/**
 * Filters the navigation down to what the current visitor should see.
 *
 * @param items         The entries to filter, normally {@link PRIMARY_NAV}.
 * @param isSignedIn    Whether a verified user is present on this request.
 * @param isAdmin       Whether that user administers the marketplace.
 * @returns The visible subset, in the original order.
 */
export function visibleNavItems(
	items: readonly NavItem[],
	isSignedIn: boolean,
	isAdmin = false
): readonly NavItem[] {
	return items.filter((item) => {
		if (item.visibility === 'public') return true;
		if (item.visibility === 'admin') return isAdmin;

		return isSignedIn;
	});
}
