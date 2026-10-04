/**
 * Sort and filter options for the commitments list. Shared by the page's load
 * function, which applies them, and its template, which offers them.
 */

export const SORTS = {
	newest: { label: 'Newest first', column: 'created_at', ascending: false },
	oldest: { label: 'Oldest first', column: 'created_at', ascending: true },
	meetup_soonest: { label: 'Meetup date, soonest first', column: 'scheduled_at', ascending: true },
	meetup_latest: { label: 'Meetup date, latest first', column: 'scheduled_at', ascending: false }
} as const;

/** Status groups, matching how people think about them rather than the raw enum. */
export const STATUS_FILTERS = {
	all: { label: 'All statuses', statuses: null },
	open: { label: 'Open (awaiting or confirmed)', statuses: ['pending', 'accepted'] },
	completed: { label: 'Completed', statuses: ['completed'] },
	closed: {
		label: 'Did not happen',
		statuses: ['declined', 'expired', 'cancelled', 'no_show', 'stale']
	}
} as const;

export const ROLE_FILTERS = {
	all: 'Buying and selling',
	buying: 'Buying',
	selling: 'Selling'
} as const;

export type SortKey = keyof typeof SORTS;
export type StatusKey = keyof typeof STATUS_FILTERS;
export type RoleKey = keyof typeof ROLE_FILTERS;
