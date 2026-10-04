import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Check in — `/check-in/[commitment_id]`.
 *
 * Kept as a redirect rather than a page. Checking in now happens on the
 * commitment itself, which is the only place it makes sense: the button is
 * useless without the other person's arrival state beside it, and two people
 * standing in a car park need one screen that answers "are they here yet",
 * not two.
 *
 * The route stays because it is in the original route list and may be linked
 * from somewhere — a notification, a bookmark, a QR someone kept. A redirect
 * is the honest version of "that moved".
 *
 * 303 rather than 302: this says "go and look at the commitment", which is a
 * GET whatever method arrived here.
 */
export const load: PageServerLoad = ({ params }) => {
	redirect(303, `/commitment/${params.commitment_id}`);
};
