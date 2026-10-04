import {
	ROLE_FILTERS,
	SORTS,
	STATUS_FILTERS,
	type RoleKey,
	type SortKey,
	type StatusKey
} from '#lib/commitments/list-view';
import { requireUser } from '#lib/server/auth/guards';
import type { PageServerLoad } from './$types';

/**
 * Commitments — every commitment this user is part of, in either role.
 *
 * Sorting and filtering come from the query string, so a chosen view survives
 * a refresh and can be bookmarked. Anything unrecognised falls back to the
 * default rather than erroring.
 */

const pick = <T extends string>(value: string | null, allowed: Record<T, unknown>, fallback: T): T =>
	value !== null && value in allowed ? (value as T) : fallback;

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(await locals.getVerifiedUser(), url.pathname);

	const sort = pick<SortKey>(url.searchParams.get('sort'), SORTS, 'newest');
	const status = pick<StatusKey>(url.searchParams.get('status'), STATUS_FILTERS, 'all');
	const role = pick<RoleKey>(url.searchParams.get('role'), ROLE_FILTERS, 'all');

	let query = locals.supabase
		.from('commitments')
		.select(
			`id, status, scheduled_at, request_expires_at, buyer_id, seller_id,
			 buyer_stake_cents, seller_stake_cents, created_at,
			 listings(id, title, price_cents),
			 meetup_locations(name)`
		);

	/** Row Level Security already limits this to the user's own; this narrows by role. */
	if (role === 'buying') query = query.eq('buyer_id', user.id);
	else if (role === 'selling') query = query.eq('seller_id', user.id);
	else query = query.or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

	const statuses = STATUS_FILTERS[status].statuses;
	if (statuses) query = query.in('status', [...statuses]);

	const { column, ascending } = SORTS[sort];
	const { data, error } = await query.order(column, { ascending });

	const view = { sort, status, role };

	if (error) {
		return { user, commitments: [], view, loadError: 'Your commitments could not be loaded.' };
	}

	return { user, commitments: data, view, loadError: null };
};
