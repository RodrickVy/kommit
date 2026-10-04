/**
 * HTTP plumbing shared by every wallet function.
 *
 * One response shape everywhere, so a caller can branch on `error.code`
 * without knowing which function it is talking to.
 */

export const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/** Stable, machine-readable failure codes. Callers branch on these, never on the message. */
export type ErrorCode =
	| 'UNAUTHORIZED'
	| 'INVALID_REQUEST'
	| 'WALLET_NOT_FOUND'
	| 'WALLET_ALREADY_EXISTS'
	| 'OWNER_NOT_FOUND'
	| 'INSUFFICIENT_FUNDS'
	| 'RENT_MINIMUM'
	| 'CHAIN_UNAVAILABLE'
	| 'IDEMPOTENCY_KEY_REUSED'
	| 'INTERNAL';

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
	});
}

export function fail(code: ErrorCode, message: string, status: number, details?: unknown): Response {
	return json({ error: { code, message, details: details ?? null } }, status);
}

/**
 * Rejects anything that is not an authenticated POST of JSON.
 *
 * Returns a Response when the request should be refused, or `null` to continue.
 * Returning rather than throwing keeps the happy path in the caller, where it
 * is easier to read.
 */
export function guardRequest(request: Request): Response | null {
	if (request.method === 'OPTIONS') {
		return new Response('ok', { headers: CORS_HEADERS });
	}

	if (request.method !== 'POST') {
		return fail('INVALID_REQUEST', 'Use POST.', 405);
	}

	/**
	 * Supabase verifies the JWT before the function runs, so this only catches
	 * a missing header — but a missing header here means something is calling
	 * the function wrongly, and a clear 401 is more useful than a crash on an
	 * undefined user.
	 */
	if (!request.headers.get('Authorization')) {
		return fail('UNAUTHORIZED', 'Missing Authorization header.', 401);
	}

	return null;
}
