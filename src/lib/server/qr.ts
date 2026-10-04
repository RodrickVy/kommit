import QRCode from 'qrcode';

/**
 * Rendering a QR code as inline SVG, on the server.
 *
 * SVG rather than a PNG data URI: it is smaller, it scales to any screen
 * without blurring, and it needs no canvas, so the whole code is produced
 * during server rendering and the browser receives markup it can simply
 * display. No client-side JavaScript is involved in showing a QR at all.
 *
 * BLACK ON WHITE, FIXED, regardless of the theme.
 *
 * This is the one place in kommitly that ignores the design tokens, and it has
 * to. A scanner needs high contrast between the modules and the background; a
 * code tinted teal, or inverted for a dark theme, becomes slow or impossible
 * to read on a cheap phone camera in a shop doorway. The surrounding tile is
 * styled by the page, but the code itself is not negotiable.
 */

/**
 * Error correction level.
 *
 * `M` recovers from about 15% damage, which is the usual recommendation for a
 * code displayed on a screen. `H` would survive a cracked phone display but
 * makes the code denser for the same payload, and a denser code is harder to
 * scan in poor light, the more likely problem at a meetup.
 */
const ERROR_CORRECTION = 'M' as const;

/**
 * Renders a QR code for a URL.
 *
 * @param text The value to encode, normally an absolute kommitly URL.
 * @returns An `<svg>` element as a string, or null if encoding failed.
 *
 * Returning null rather than throwing: the caller is a page that has already
 * created a real token, and a failure to draw the picture must not read as a
 * failure to issue the code. The page falls back to showing the link.
 */
export async function renderQrSvg(text: string): Promise<string | null> {
	try {
		return await QRCode.toString(text, {
			type: 'svg',
			errorCorrectionLevel: ERROR_CORRECTION,

			/**
			 * The quiet zone, in modules. The specification asks for 4; 2 is
			 * enough in practice when the code sits on its own white tile, and it
			 * leaves more of the available width for the code itself.
			 */
			margin: 2,

			color: { dark: '#000000', light: '#ffffff' }
		});
	} catch (cause) {
		console.error('[qr] could not render', cause);
		return null;
	}
}
