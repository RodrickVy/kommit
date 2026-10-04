import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Impact, `/impact`.
 *
 * The charities a no-show's stake can go to, this month's votes, and which one
 * currently receives forfeits. Voting decides that: the charity with the most
 * votes this month becomes the one that receives them.
 */

export const load: PageServerLoad = async ({ locals }) => {
	const user = await locals.getVerifiedUser();

	const [charitiesResult, tallyResult, settingsResult] = await Promise.all([
		locals.supabase
			.from('charities')
			.select('id, name, short_name, description, website_url, logo_path')
			.eq('is_active', true)
			.order('name', { ascending: true }),
		locals.supabase.rpc('charity_vote_tally'),
		locals.supabase.from('market_settings').select('active_charity_id').eq('id', 1).maybeSingle()
	]);

	const tally = new Map((tallyResult.data ?? []).map((row) => [row.charity_id, row]));

	const charities = (charitiesResult.data ?? []).map((charity) => ({
		...charity,
		votes: tally.get(charity.id)?.votes ?? 0,
		isMyVote: tally.get(charity.id)?.is_my_vote ?? false
	}));

	return {
		charities,
		activeCharityId: settingsResult.data?.active_charity_id ?? null,
		totalVotes: charities.reduce((sum, charity) => sum + charity.votes, 0),
		signedIn: user !== null,
		loadError: charitiesResult.error ? 'The charities could not be loaded.' : null
	};
};

export const actions: Actions = {
	/**
	 * One vote per person per month. Voting again moves the vote. The database
	 * function enforces both and updates which charity receives forfeits.
	 */
	vote: async ({ request, locals, url }) => {
		const user = await locals.getVerifiedUser();
		if (!user) redirect(303, `/signin?redirectTo=${encodeURIComponent(url.pathname)}`);

		const form = await request.formData();
		const charityId = String(form.get('charityId') ?? '');

		if (!charityId) return fail(400, { voteError: 'Choose a charity to vote for.' });

		const { error } = await locals.supabase.rpc('cast_charity_vote', { target: charityId });

		if (error) return fail(400, { voteError: error.message || 'Your vote could not be counted.' });

		return { voteError: null };
	}
};
