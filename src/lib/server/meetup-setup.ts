import { fail } from '@sveltejs/kit';

/**
 * A seller's meetup locations and availability, as form actions.
 *
 * Both belong to the PERSON, not to one listing, and every listing inherits
 * them. They can be edited from the account page and from the seller's own
 * listing page; both routes delegate here so the two cannot drift apart.
 */

const problem = (message: string) => ({ message, tone: 'error' as const });
const done = (message: string) => ({ message, tone: 'success' as const });

export async function addLocation(locals: App.Locals, userId: string, form: FormData) {
	const name = String(form.get('name') ?? '').trim();
	const latitude = Number(form.get('latitude'));
	const longitude = Number(form.get('longitude'));

	if (name.length === 0) {
		return fail(400, problem('Give the place a name a stranger would recognise.'));
	}

	/**
	 * Range-checked here as well as by the database constraint. A transposed
	 * pair is a plausible typo that would otherwise surface as an opaque
	 * constraint violation.
	 */
	if (form.get('latitude') === '' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
		return fail(400, problem('Latitude must be between -90 and 90. Try "Use my current location".'));
	}

	if (form.get('longitude') === '' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
		return fail(400, problem('Longitude must be between -180 and 180.'));
	}

	const { error } = await locals.supabase
		.from('meetup_locations')
		.insert({ profile_id: userId, name, latitude, longitude });

	if (error) return fail(500, problem('That location could not be saved.'));

	return done('Meetup location added.');
}

/**
 * Archived, not deleted. A past commitment points at where it was meant to
 * happen, and deleting the row would break that reference.
 */
export async function removeLocation(locals: App.Locals, userId: string, form: FormData) {
	const { error } = await locals.supabase
		.from('meetup_locations')
		.update({ is_archived: true })
		.eq('id', String(form.get('locationId') ?? ''))
		.eq('profile_id', userId);

	if (error) return fail(500, problem('That location could not be removed.'));

	return done('Location removed.');
}

/**
 * Either a weekly rule ("every Tuesday") or one specific date. A dated rule
 * also stores its weekday, which the database checks matches the date.
 */
export async function addAvailability(locals: App.Locals, userId: string, form: FormData) {
	const repeat = String(form.get('repeat') ?? 'weekly');
	const startTime = String(form.get('startTime') ?? '');
	const endTime = String(form.get('endTime') ?? '');

	let dayOfWeek: number;
	let specificDate: string | null = null;

	if (repeat === 'date') {
		specificDate = String(form.get('date') ?? '');

		if (!/^\d{4}-\d{2}-\d{2}$/.test(specificDate)) {
			return fail(400, problem('Choose a date.'));
		}

		/** Parsed as UTC midnight so the weekday is the calendar date's own. */
		const parsed = new Date(`${specificDate}T00:00:00Z`);
		if (Number.isNaN(parsed.getTime())) return fail(400, problem('Choose a valid date.'));

		const today = new Date().toISOString().slice(0, 10);
		if (specificDate < today) return fail(400, problem('That date has already passed.'));

		dayOfWeek = parsed.getUTCDay();
	} else {
		dayOfWeek = Number(form.get('dayOfWeek'));

		if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
			return fail(400, problem('Choose a day of the week.'));
		}
	}

	if (startTime === '' || endTime === '') {
		return fail(400, problem('Set both a start and an end time.'));
	}

	/** String comparison is correct for `HH:MM`, and matches the database check. */
	if (endTime <= startTime) {
		return fail(400, problem('The end time has to be after the start time.'));
	}

	const { error } = await locals.supabase.from('availability_rules').insert({
		profile_id: userId,
		day_of_week: dayOfWeek,
		specific_date: specificDate,
		start_time: startTime,
		end_time: endTime
	});

	if (error) return fail(500, problem('That time could not be saved.'));

	return done(specificDate ? 'Date added.' : 'Weekly time added.');
}

export async function removeAvailability(locals: App.Locals, userId: string, form: FormData) {
	const { error } = await locals.supabase
		.from('availability_rules')
		.update({ is_archived: true })
		.eq('id', String(form.get('availabilityId') ?? ''))
		.eq('profile_id', userId);

	if (error) return fail(500, problem('That time could not be removed.'));

	return done('Time removed.');
}
