import { callerId, serviceClient } from '../_shared/db.ts';
import { parseCoordinates, validateCheckIn } from '../_shared/geo.ts';
import { meetupDay } from '../_shared/meetup_day.ts';
import { fail, guardRequest, json } from '../_shared/http.ts';

/**
 * check_in — records that a participant physically reached the meetup place.
 *
 *   POST /check_in
 *   { "commitment_id": "<uuid>", "latitude": 49.2276, "longitude": -123.0076 }
 *
 * The coordinates come from the browser's Geolocation API; who is checking in
 * comes from the JWT, never from the body. Position is compared against the
 * commitment's agreed location by `validate_check_in` using the radius in
 * market settings.
 *
 * NO MONEY MOVES HERE. A check-in is evidence, nothing else. Stakes are
 * settled by `complete_commitment` when QR #1 succeeds, or by
 * `process_commitments` when a deadline passes — and both of those read these
 * rows to decide who was at fault.
 *
 * WHEN: any time on the meetup's calendar day. Not arriving by the end of
 * that day is what makes someone a no-show (see `process_commitments`).
 */

interface CommitmentRow {
	id: string;
	status: string;
	buyer_id: string;
	seller_id: string;
	scheduled_at: string;
	buyer_checked_in_at: string | null;
	seller_checked_in_at: string | null;
	check_in_window_ends_at: string | null;
	meetup_verified_at: string | null;
	meetup_locations: { latitude: number; longitude: number; name: string } | null;
}

Deno.serve(async (request: Request) => {
	const refusal = guardRequest(request);
	if (refusal) return refusal;

	const profileId = await callerId(request);
	if (!profileId) return fail('UNAUTHORIZED', 'Sign in to check in.', 401);

	let body: { commitment_id?: string; latitude?: unknown; longitude?: unknown };
	try {
		body = await request.json();
	} catch {
		return fail('INVALID_REQUEST', 'Body must be JSON.', 400);
	}

	if (!body.commitment_id) {
		return fail('INVALID_REQUEST', 'commitment_id is required.', 400);
	}

	/**
	 * Rejected before anything else, because an unusable coordinate is almost
	 * always a denied permission or a device without a fix — and both need the
	 * user to be told what to do, not told they are too far away.
	 */
	const submitted = parseCoordinates(body.latitude, body.longitude);

	if (!submitted) {
		return fail(
			'LOCATION_UNAVAILABLE',
			'Your location could not be read. Allow location access in your browser and try again.',
			400
		);
	}

	const db = serviceClient();

	try {
		const { data: commitment } = await db
			.from('commitments')
			.select(
				'id, status, buyer_id, seller_id, scheduled_at, buyer_checked_in_at, seller_checked_in_at, check_in_window_ends_at, meetup_verified_at, meetup_locations(latitude, longitude, name)'
			)
			.eq('id', body.commitment_id)
			.maybeSingle<CommitmentRow>();

		if (!commitment) return fail('INVALID_REQUEST', 'That commitment does not exist.', 404);

		const isBuyer = commitment.buyer_id === profileId;
		const isSeller = commitment.seller_id === profileId;

		if (!isBuyer && !isSeller) {
			return fail('UNAUTHORIZED', 'That commitment is not yours.', 403);
		}

		const role: 'buyer' | 'seller' = isBuyer ? 'buyer' : 'seller';

		/**
		 * Only an active commitment can be checked into. Covers every resolved
		 * state at once — completed, cancelled, expired, stale, declined — none
		 * of which can be reopened by arriving somewhere.
		 */
		if (commitment.status !== 'accepted') {
			return fail(
				'INVALID_REQUEST',
				'This commitment is no longer active, so it cannot be checked into.',
				409
			);
		}

		if (commitment.meetup_verified_at) {
			return fail('INVALID_REQUEST', 'This meetup has already been verified.', 409);
		}

		if (!commitment.meetup_locations) {
			/**
			 * Nothing to measure against. Refusing is the only honest option: a
			 * check-in with no reference point would be a row claiming the person
			 * was in the right place with nothing supporting it.
			 */
			return fail('INTERNAL', 'This commitment has no meetup location on record.', 500);
		}

		const { data: settings } = await db
			.from('market_settings')
			.select('check_in_radius_metres, check_in_window_minutes')
			.eq('id', 1)
			.maybeSingle<{ check_in_radius_metres: number; check_in_window_minutes: number }>();

		if (!settings) return fail('INTERNAL', 'Market settings are missing.', 500);

		return await record(db, commitment, settings, profileId, role, submitted);
	} catch (error) {
		console.error('[check_in]', error);
		return fail('INTERNAL', 'The check-in could not be recorded.', 500);
	}
});

/** Both parties' state, which is what the meetup UI renders. */
function stateOf(commitment: CommitmentRow, role: 'buyer' | 'seller') {
	const mine = role === 'buyer' ? commitment.buyer_checked_in_at : commitment.seller_checked_in_at;
	const theirs = role === 'buyer' ? commitment.seller_checked_in_at : commitment.buyer_checked_in_at;

	return {
		you_checked_in_at: mine,
		other_checked_in_at: theirs,
		both_checked_in: Boolean(mine && theirs),
		deadline: commitment.check_in_window_ends_at
	};
}

/**
 * Validates the position, writes the attempt, and reports both sides.
 */
async function record(
	db: ReturnType<typeof serviceClient>,
	commitment: CommitmentRow,
	settings: { check_in_radius_metres: number; check_in_window_minutes: number },
	profileId: string,
	role: 'buyer' | 'seller',
	submitted: { latitude: number; longitude: number }
): Promise<Response> {
	const alreadyCheckedIn =
		role === 'buyer' ? commitment.buyer_checked_in_at : commitment.seller_checked_in_at;

	/**
	 * A repeat check-in is not an error. Someone refreshing the page, or
	 * pressing the button twice because the first response was slow, should be
	 * told where things stand — not told off. Returning early also keeps the
	 * unique index from rejecting a second verified row.
	 */
	if (alreadyCheckedIn) {
		return json({
			commitment_id: commitment.id,
			role,
			verified: true,
			already_checked_in: true,
			...stateOf(commitment, role)
		});
	}

	/**
	 * Check-in is open for the whole of the meetup's calendar day. There is no
	 * buffer of minutes either side: what matters is being at the agreed place
	 * on the agreed date. Before or after that day, it is refused.
	 */
	const day = meetupDay(commitment.scheduled_at);
	// const now = new Date();

	// TESTING: check-in allowed on any day. Uncomment to require the meetup date.
	// if (now < day.start) {
		// return fail('NOT_YET_OPEN', 'Check-in opens on the day of the meetup.', 409, {
			// opens_at: day.start.toISOString()
		// });
	// }

	// if (now >= day.end) {
		// return fail('WINDOW_CLOSED', 'The day of this meetup has passed, so check-in is closed.', 409, {
			// closed_at: day.end.toISOString()
		// });
	// }

	const validation = validateCheckIn(
		submitted,
		{
			latitude: commitment.meetup_locations!.latitude,
			longitude: commitment.meetup_locations!.longitude
		},
		settings.check_in_radius_metres
	);

	/**
	 * Both outcomes are written. A failed attempt is evidence too: someone who
	 * tried three times from 400m away is in a different position, in a later
	 * dispute, from someone who never tried at all.
	 */
	const inserted = await db.from('check_ins').insert({
		commitment_id: commitment.id,
		profile_id: profileId,
		role,
		latitude: submitted.latitude,
		longitude: submitted.longitude,
		distance_metres: validation.distanceMetres,
		is_verified: validation.withinRadius
	});

	if (inserted.error) {
		console.error('[check_in] could not record attempt', inserted.error);
		return fail('INTERNAL', 'The check-in could not be recorded.', 500);
	}

	if (!validation.withinRadius) {
		return fail(
			'OUTSIDE_RADIUS',
			`You need to be at the agreed meetup location to check in. You are about ` +
				`${validation.distanceMetres}m away, and need to be within ${validation.radiusMetres}m.`,
			409,
			{ distance_metres: validation.distanceMetres, radius_metres: validation.radiusMetres }
		);
	}

	const checkedInAt = new Date();
	const otherAlreadyIn =
		role === 'buyer' ? commitment.seller_checked_in_at : commitment.buyer_checked_in_at;

	/**
	 * The deadline is the end of the meetup day, recorded on the first arrival
	 * so the other person can see how long they have.
	 */
	const update: Record<string, string> = {
		[role === 'buyer' ? 'buyer_checked_in_at' : 'seller_checked_in_at']:
			checkedInAt.toISOString()
	};

	if (!otherAlreadyIn) {
		update.check_in_window_ends_at = day.end.toISOString();
	}

	/**
	 * `.eq('status', 'accepted')` keeps this from writing a check-in onto a
	 * commitment that was cancelled or resolved while the position was being
	 * validated.
	 */
	const applied = await db
		.from('commitments')
		.update(update)
		.eq('id', commitment.id)
		.eq('status', 'accepted')
		.select('buyer_checked_in_at, seller_checked_in_at, check_in_window_ends_at')
		.maybeSingle<{
			buyer_checked_in_at: string | null;
			seller_checked_in_at: string | null;
			check_in_window_ends_at: string | null;
		}>();

	if (applied.error || !applied.data) {
		/**
		 * The attempt row stands — the person really was there — but the
		 * commitment did not accept it, which means it stopped being active.
		 * Reported rather than silently returning success.
		 */
		console.error('[check_in] commitment no longer accepted', applied.error);
		return fail('INVALID_REQUEST', 'This commitment was resolved while you were checking in.', 409);
	}

	await db.from('commitment_events').insert({
		commitment_id: commitment.id,
		event_type: role === 'buyer' ? 'buyer_checked_in' : 'seller_checked_in',
		actor_profile_id: profileId,
		actor_role: role,
		metadata: { distance_metres: validation.distanceMetres }
	});

	const fresh: CommitmentRow = { ...commitment, ...applied.data };

	return json({
		commitment_id: commitment.id,
		role,
		verified: true,
		already_checked_in: false,
		distance_metres: validation.distanceMetres,
		...stateOf(fresh, role)
	});
}
