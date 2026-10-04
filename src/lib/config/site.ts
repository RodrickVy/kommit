/**
 * The site's public address.
 *
 * Every link that leaves the app (a QR code someone scans, the link in a
 * sign-up email) points here, whichever deployment produced it. A link built
 * from a Vercel deployment's own address would send people to a URL that
 * changes with every deploy.
 */
export const SITE_URL = 'https://kommitly.tech';

/** Hosts that only exist on a developer's machine. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The origin to put in an outgoing link.
 *
 * Local development keeps its own origin so the flow can still be tested end
 * to end on that machine. Everywhere else (production, Vercel previews) the
 * link uses the real site.
 */
export function publicOrigin(url: URL): string {
	const local = LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith('.localhost');
	return local ? url.origin : SITE_URL;
}
