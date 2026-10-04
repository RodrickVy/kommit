import { fail, redirect } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guards';
import { AVAILABILITY_EXAMPLES, LOCATION_EXAMPLES } from '#lib/listings/examples';
import type { Actions, PageServerLoad } from './$types';

/**
 * Account.
 *
 * Also the seller's settings: meetup locations and weekly availability. Both
 * belong to the PERSON rather than to any one listing — a seller defines their
 * safe meeting spots and their free evenings once, and every listing they
 * create inherits them.
 *
 * This page also hosts the sign-out action, which the header posts to from
 * everywhere. A form action has to live on a route, and this is the one that
 * is about the signed-in user.
 */

/** Both are returned on every failure, so the page always has a full picture. */
const problem = (message: string) => ({ message, tone: 'error' as const });
const done = (message: string) => ({ message, tone: 'success' as const });

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(await locals.getVerifiedUser(), url.pathname);

	/**
	 * Three queries rather than one join. They are independent, none depends on
	 * another's result, and keeping them separate means a failure in one does
	 * not blank the whole page.
	 *
	 * Columns are listed explicitly throughout — never `select('*')`.
	 */
	const [profileResult, locationsResult, availabilityResult] = await Promise.all([
		locals.supabase
			.from('profiles')
			.select(
				'display_name, description, reputation, commitments_total, commitments_successful, email_receipts_enabled'
			)
			.eq('id', user.id)
			.single(),
		locals.supabase
			.from('meetup_locations')
			.select('id, name, latitude, longitude')
			.eq('profile_id', user.id)
			.eq('is_archived', false)
			.order('created_at', { ascending: true }),
		locals.supabase
			.from('availability_rules')
			.select('id, day_of_week, start_time, end_time, timezone')
			.eq('profile_id', user.id)
			.eq('is_archived', false)
			.order('day_of_week', { ascending: true })
	]);

	return {
		user,
		profile: profileResult.data,
		locations: locationsResult.data ?? [],
		availability: availabilityResult.data ?? [],
		/**
		 * The trigger on `auth.users` guarantees a profile exists, so this is
		 * unreachable in normal operation. Surfacing it rather than rendering a
		 * blank page means a broken trigger shows up immediately.
		 */
		loadError: profileResult.error ? 'Your profile could not be loaded.' : null
	};
};

export const actions: Actions = {
	signout: async ({ locals }) => {
		/**
		 * Any error is ignored on purpose. If the token was already invalid then
		 * sign-out has effectively succeeded, and refusing to let someone log out
		 * because their session was broken is the wrong failure mode.
		 */
		await locals.supabase.auth.signOut();
		redirect(303, '/');
	},

	addLocation: async ({ request, locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const latitude = Number(form.get('latitude'));
		const longitude = Number(form.get('longitude'));

		if (name.length === 0) {
			return fail(400, problem('Give the place a name a stranger would recognise.'));
		}

		/**
		 * Range-checked here as well as by the database constraint. A transposed
		 * pair — latitude 123, longitude 49 — is a plausible typo that would
		 * otherwise surface as an opaque constraint violation.
		 */
		if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
			return fail(400, problem('Latitude must be between -90 and 90.'));
		}

		if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
			return fail(400, problem('Longitude must be between -180 and 180.'));
		}

		const { error } = await locals.supabase
			.from('meetup_locations')
			.insert({ profile_id: user.id, name, latitude, longitude });

		if (error) return fail(500, problem('That location could not be saved.'));

		return done('Meetup location added.');
	},

	/**
	 * Adds the example locations, skipping any the seller already has.
	 *
	 * Offered instead of seeding at sign-up. Writing rows into someone's account
	 * before they have seen what a meetup location is leaves them guessing which
	 * are theirs; asking for them here means nothing appears unrequested.
	 */
	addExampleLocations: async ({ locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);

		const { data: existing } = await locals.supabase
			.from('meetup_locations')
			.select('name')
			.eq('profile_id', user.id);

		const alreadyHave = new Set((existing ?? []).map((row) => row.name));
		const toAdd = LOCATION_EXAMPLES.filter((example) => !alreadyHave.has(example.name));

		if (toAdd.length === 0) {
			return done('You already have all of the example locations.');
		}

		const { error } = await locals.supabase
			.from('meetup_locations')
			.insert(toAdd.map((example) => ({ ...example, profile_id: user.id })));

		if (error) return fail(500, problem('The example locations could not be added.'));

		return done(`Added ${toAdd.length} example location${toAdd.length === 1 ? '' : 's'}.`);
	},

	removeLocation: async ({ request, locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);
		const form = await request.formData();

		/**
		 * Archived, not deleted. A past commitment points at where it was meant
		 * to happen, and deleting the row would either break that reference or
		 * erase the record of where someone agreed to meet.
		 */
		const { error } = await locals.supabase
			.from('meetup_locations')
			.update({ is_archived: true })
			.eq('id', String(form.get('locationId') ?? ''))
			.eq('profile_id', user.id);

		if (error) return fail(500, problem('That location could not be removed.'));

		return done('Location removed.');
	},

	addAvailability: async ({ request, locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);

		const form = await request.formData();
		const dayOfWeek = Number(form.get('dayOfWeek'));
		const startTime = String(form.get('startTime') ?? '');
		const endTime = String(form.get('endTime') ?? '');

		if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
			return fail(400, problem('Choose a day of the week.'));
		}

		if (startTime === '' || endTime === '') {
			return fail(400, problem('Set both a start and an end time.'));
		}

		/**
		 * String comparison is correct for `HH:MM` and avoids parsing into dates
		 * only to throw them away. It is also what the database constraint
		 * checks, so the two cannot disagree.
		 */
		if (endTime <= startTime) {
			return fail(400, problem('The end time has to be after the start time.'));
		}

		const { error } = await locals.supabase.from('availability_rules').insert({
			profile_id: user.id,
			day_of_week: dayOfWeek,
			start_time: startTime,
			end_time: endTime
		});

		if (error) return fail(500, problem('That availability could not be saved.'));

		return done('Availability added.');
	},

	addExampleAvailability: async ({ locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);

		const { data: existing } = await locals.supabase
			.from('availability_rules')
			.select('day_of_week, start_time')
			.eq('profile_id', user.id)
			.eq('is_archived', false);

		/**
		 * Matched on day plus start time. Postgres returns a `time` as
		 * `17:00:00` while the examples hold `17:00`, so the stored value is
		 * trimmed to the same shape before comparing — otherwise every example
		 * would look new and duplicate on each click.
		 */
		const alreadyHave = new Set(
			(existing ?? []).map((row) => `${row.day_of_week}@${row.start_time.slice(0, 5)}`)
		);

		const toAdd = AVAILABILITY_EXAMPLES.filter(
			(example) => !alreadyHave.has(`${example.day_of_week}@${example.start_time}`)
		);

		if (toAdd.length === 0) {
			return done('You already have all of the example availability.');
		}

		const { error } = await locals.supabase
			.from('availability_rules')
			.insert(toAdd.map((example) => ({ ...example, profile_id: user.id })));

		if (error) return fail(500, problem('The example availability could not be added.'));

		return done(`Added ${toAdd.length} example time${toAdd.length === 1 ? '' : 's'}.`);
	},

	removeAvailability: async ({ request, locals, url }) => {
		const user = requireUser(await locals.getVerifiedUser(), url.pathname);
		const form = await request.formData();

		const { error } = await locals.supabase
			.from('availability_rules')
			.update({ is_archived: true })
			.eq('id', String(form.get('availabilityId') ?? ''))
			.eq('profile_id', user.id);

		if (error) return fail(500, problem('That availability could not be removed.'));

		return done('Availability removed.');
	}
};
