import { requireUser } from '#lib/server/auth/guards';
import type { PageServerLoad } from './$types';

/**
 * Commitments — everything this person is party to, in either role.
 *
 * One list rather than two. A commitment is a single agreement between two
 * people, and splitting the page into "buying" and "selling" would make the
 * common question — what do I have coming up — require reading both.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(await locals.getVerifiedUser(), url.pathname);

	/**
	 * One query for both roles. Row Level Security already restricts this to
	 * commitments the user is party to, so the `or` here is about intent rather
	 * than access — but it is stated anyway, because a query that relies on RLS
	 * to be correct is a query that breaks silently if a policy changes.
	 *
	 * Explicit columns, and the embedded selects pull only what the row shows.
	 */
	const { data, error } = await locals.supabase
		.from('commitments')
		.select(
			`id, status, scheduled_at, request_expires_at, buyer_id, seller_id,
			 buyer_stake_cents, seller_stake_cents, created_at,
			 listings(id, title, price_cents),
			 meetup_locations(name)`
		)
		.or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
		.order('scheduled_at', { ascending: true });

	if (error) {
		return { user, commitments: [], loadError: 'Your commitments could not be loaded.' };
	}

	return { user, commitments: data, loadError: null };
};
