/**
 * The calendar day a meetup belongs to.
 *
 * Check-in, verification and the no-show / stale verdicts are all bounded by
 * the meetup's DATE rather than a window of minutes around its time: both
 * people may arrive whenever suits them on the agreed day, as long as they are
 * at the agreed place.
 *
 * The day is decided in the marketplace's zone. Availability rules default to
 * the same zone, so the date a seller offered is the date enforced here.
 */

export const MEETUP_TIME_ZONE = 'America/Vancouver';

/** Offset of `timeZone`'s wall clock from UTC at `instant`, in milliseconds. */
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
	const asIfUtc = Date.UTC(
		read('year'),
		read('month') - 1,
		read('day'),
		read('hour') % 24,
		read('minute'),
		read('second')
	);

	return asIfUtc - instant.getTime();
}

/** Local midnight of the given calendar date, as a real instant. */
function localMidnight(year: number, month: number, day: number, timeZone: string): number {
	const naive = Date.UTC(year, month - 1, day);
	const guess = naive - offsetMs(new Date(naive), timeZone);
	return naive - offsetMs(new Date(guess), timeZone);
}

/**
 * Start (inclusive) and end (exclusive) of the meetup's calendar day.
 * Daylight-saving days are 23 or 25 hours long, which is why the end is the
 * next local midnight rather than start + 24h.
 */
export function meetupDay(scheduledAt: string | Date, timeZone = MEETUP_TIME_ZONE) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date(scheduledAt));

	const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
	const year = read('year');
	const month = read('month');
	const day = read('day');

	/** Date.UTC normalises day + 1 across month and year ends. */
	const next = new Date(Date.UTC(year, month - 1, day + 1));

	return {
		start: new Date(localMidnight(year, month, day, timeZone)),
		end: new Date(
			localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone)
		)
	};
}
