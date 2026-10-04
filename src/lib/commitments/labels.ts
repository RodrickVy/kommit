import type { Database } from '#lib/supabase/database.types';

export type CommitmentStatus = Database['public']['Enums']['commitment_status'];
export type CommitmentParty = Database['public']['Enums']['commitment_party'];

/**
 * Status labels written from the READER's point of view where it matters.
 *
 * "Declined" and "Cancelled" mean different things to the person who did it
 * and the person it happened to, so the detail page says who — these are the
 * neutral short forms used in lists and badges.
 */
export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
	pending: 'Awaiting seller',
	accepted: 'Confirmed',
	declined: 'Declined',
	expired: 'Expired',
	cancelled: 'Cancelled',
	no_show: 'No-show',
	stale: 'Unresolved',
	completed: 'Completed'
};

/**
 * Which statuses are still live — the commitment is going somewhere.
 * Mirrors what the database's partial unique indexes treat as holding a slot.
 */
export const LIVE_STATUSES: readonly CommitmentStatus[] = ['pending', 'accepted'];

export function statusTone(status: CommitmentStatus): 'live' | 'warning' | 'neutral' | 'muted' {
	if (status === 'accepted' || status === 'completed') return 'live';
	if (status === 'pending') return 'warning';
	if (status === 'no_show' || status === 'cancelled') return 'neutral';
	return 'muted';
}

export type CommitmentEventType = Database['public']['Enums']['commitment_event_type'];

/**
 * What each recorded event says, in plain words.
 *
 * Phrased from nobody's point of view in particular — the timeline shows the
 * actor's role beside each entry, so "Seller accepted" would be redundant and
 * would read oddly to the seller themselves.
 */
export const EVENT_LABELS: Record<CommitmentEventType, string> = {
	request_created: 'Meetup requested',
	seller_accepted: 'Request accepted',
	seller_declined: 'Request declined',
	buyer_withdrew: 'Request withdrawn',
	request_expired: 'Request expired without a response',
	buyer_cancelled: 'Cancelled by the buyer',
	seller_cancelled: 'Cancelled by the seller',
	buyer_checked_in: 'Buyer checked in',
	seller_checked_in: 'Seller checked in',
	buyer_no_show: 'Buyer did not arrive',
	seller_no_show: 'Seller did not arrive',
	meetup_verified: 'Meetup verified',
	commitment_stale: 'Closed without blame',
	commitment_completed: 'Commitment completed',
	purchase_completed: 'Purchase completed'
};
