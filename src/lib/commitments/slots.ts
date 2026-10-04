/**
 * Turning recurring weekly availability into concrete bookable instants.
 *
 * A seller says "Tuesdays, 5pm to 8pm". A commitment needs a single moment in
 * time. This module bridges the two.
 */

/** An availability rule as stored. */
export interface AvailabilityRule {
	readonly id: string;
	/** 0 = Sunday, matching Postgres `extract(dow from ...)`. */
	readonly day_of_week: number;
	/** Wall-clock local time, `HH:MM:SS`. */
	readonly start_time: string;
	readonly end_time: string;
	/** IANA zone the wall-clock times are expressed in. */
	readonly timezone: string;
	/** `YYYY-MM-DD` when the rule is for one date only; null repeats weekly. */
	readonly specific_date?: string | null;
}

/** A specific moment a buyer can choose. */
export interface Slot {
	/** The instant, as an ISO string, what goes into `scheduled_at`. */
	readonly startsAt: string;
	/** The rule that produced it, for display. */
	readonly ruleId: string;
}

/**
 * The offset between a timezone's wall clock and UTC at a given instant.
 *
 * There is no built-in way to ask "what is the offset in Vancouver right now",
 * so this formats the instant AS that zone's wall clock, reads the result back
 * as though it were UTC, and takes the difference. The gap is the offset.
 */
function offsetMs(instant: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(instant);

	const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');

	/**
	 * `hour` can format as 24 for midnight under `hour12: false` in some
	 * engines, which would push the date forward a day. Normalised to 0.
	 */
	const hour = read('hour') % 24;

	const asIfUtc = Date.UTC(read('year'), read('month') - 1, read('day'), hour, read('minute'), read('second'));

	return asIfUtc - instant.getTime();
}

/**
 * Converts a wall-clock time in a named zone to the real instant.
 *
 * Two passes, and the second is not redundant. The offset has to be looked up
 * at *some* instant, but the instant is what we are trying to find, so the
 * first pass guesses using the offset at the naive time, and the second checks
 * whether the offset actually differs at the answer. They disagree exactly
 * across a daylight-saving boundary, which is when getting this wrong moves a
 * meetup by an hour.
 */
function wallTimeToInstant(
	year: number,
	month: number,
	day: number,
	hours: number,
	minutes: number,
	timeZone: string
): Date {
	const naive = Date.UTC(year, month - 1, day, hours, minutes);

	const firstGuess = naive - offsetMs(new Date(naive), timeZone);
	const corrected = naive - offsetMs(new Date(firstGuess), timeZone);

	return new Date(corrected);
}

/** `HH:MM:SS` or `HH:MM` to hours and minutes. */
function parseTime(value: string): { hours: number; minutes: number } {
	const [hours = '0', minutes = '0'] = value.split(':');
	return { hours: Number(hours), minutes: Number(minutes) };
}

/**
 * Generates the bookable moments a buyer can choose from.
 *
 * @param rules        The seller's weekly availability.
 * @param options.now  The current instant. Passed in rather than read, so this
 *                     is testable and so the server decides "now", not the
 *                     browser's clock.
 * @param options.minimumLeadHours
 *                     A meetup closer than this cannot be requested: the
 *                     acceptance deadline would already have passed. Mirrors
 *                     `market_settings.minimum_acceptance_lead_hours`, and the
 *                     database rejects anything that slips through anyway.
 * @param options.horizonDays  How far ahead to offer.
 * @param options.stepMinutes  Spacing of start times within a window.
 * @param options.taken        Instants already taken, as ISO strings.
 */
export function generateSlots(
	rules: readonly AvailabilityRule[],
	options: {
		now: Date;
		minimumLeadHours: number;
		horizonDays?: number;
		stepMinutes?: number;
		taken?: ReadonlySet<string>;
	}
): Slot[] {
	const { now, minimumLeadHours } = options;
	const horizonDays = options.horizonDays ?? 14;
	const stepMinutes = options.stepMinutes ?? 30;
	const taken = options.taken ?? new Set<string>();

	const earliest = now.getTime() + minimumLeadHours * 3600_000;
	const latest = now.getTime() + horizonDays * 86_400_000;

	const slots: Slot[] = [];

	for (const rule of rules) {
		const start = parseTime(rule.start_time);
		const end = parseTime(rule.end_time);

		/**
		 * Walk forward a day at a time rather than computing which dates fall
		 * on the right weekday. The weekday has to be evaluated in the SELLER's
		 * zone, "Tuesday" there can be Monday or Wednesday in UTC, and
		 * stepping through days lets the zone answer that question each time.
		 */
		for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset += 1) {
			const probe = new Date(now.getTime() + dayOffset * 86_400_000);

			const inZone = new Intl.DateTimeFormat('en-US', {
				timeZone: rule.timezone,
				weekday: 'short',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			}).formatToParts(probe);

			const field = (type: string) => inZone.find((part) => part.type === type)?.value ?? '';
			const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(field('weekday'));

			if (weekdayIndex !== rule.day_of_week) continue;

			const year = Number(field('year'));
			const month = Number(field('month'));
			const day = Number(field('day'));

			/** A dated rule produces slots on that one date only. */
			if (rule.specific_date) {
				const local = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
				if (local !== rule.specific_date) continue;
			}

			const windowStart = wallTimeToInstant(year, month, day, start.hours, start.minutes, rule.timezone);
			const windowEnd = wallTimeToInstant(year, month, day, end.hours, end.minutes, rule.timezone);

			for (
				let instant = windowStart.getTime();
				instant < windowEnd.getTime();
				instant += stepMinutes * 60_000
			) {
				if (instant < earliest || instant > latest) continue;

				const iso = new Date(instant).toISOString();
				if (taken.has(iso)) continue;

				slots.push({ startsAt: iso, ruleId: rule.id });
			}
		}
	}

	/** Chronological, and de-duplicated where two rules overlap. */
	const seen = new Set<string>();
	return slots
		.filter((slot) => (seen.has(slot.startsAt) ? false : (seen.add(slot.startsAt), true)))
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
