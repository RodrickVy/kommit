/**
 * `validate_check_in` from the function contracts, internal function #17.
 *
 * A PURE function. It compares two coordinates against a radius and returns
 * the verdict. It does not ask the browser for a location, write to the
 * database, start the no-show clock or decide anything about the commitment,
 * all of that belongs to `check_in`, which calls this.
 *
 * Kept separate precisely because it is the only part of check-in that is
 * worth testing in isolation: everything else is authorisation and
 * bookkeeping, but this is arithmetic that is easy to get subtly wrong.
 */

export interface Coordinates {
	readonly latitude: number;
	readonly longitude: number;
}

/**
 * Mean Earth radius in metres, per the IUGG.
 *
 * Haversine treats the Earth as a sphere, so distances carry up to roughly
 * 0.5% error against the true ellipsoid. Over the few hundred metres this is
 * used for, that is about a metre, far below the accuracy of any phone GPS,
 * so the extra complexity of a Vincenty solution would buy nothing.
 */
const EARTH_RADIUS_METRES = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in metres.
 *
 * Haversine rather than the law of cosines: the latter loses precision
 * catastrophically at short distances, which is the only distance that matters
 * here.
 */
export function distanceMetres(from: Coordinates, to: Coordinates): number {
	const deltaLat = toRadians(to.latitude - from.latitude);
	const deltaLon = toRadians(to.longitude - from.longitude);

	const fromLat = toRadians(from.latitude);
	const toLat = toRadians(to.latitude);

	const a =
		Math.sin(deltaLat / 2) ** 2 +
		Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLon / 2) ** 2;

	/**
	 * `atan2` with the two-argument form, not `asin(sqrt(a))`. They agree
	 * mathematically, but `asin` is numerically unstable as `a` approaches 1,
	 * i.e. for antipodal points. Not a case this product produces, but the
	 * stable form costs nothing.
	 */
	return 2 * EARTH_RADIUS_METRES * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Whether a coordinate pair is usable at all.
 *
 * Browsers hand back `null` island (0, 0) when a device has no fix, and
 * JavaScript will happily carry `NaN` through every calculation below to
 * produce a distance of `NaN`, which compares false against any radius and so
 * would silently read as "too far away" rather than "no location". Rejected
 * here so the user is told the real problem.
 */
export function isUsableCoordinate(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function parseCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
	if (!isUsableCoordinate(latitude) || !isUsableCoordinate(longitude)) return null;
	if (latitude < -90 || latitude > 90) return null;
	if (longitude < -180 || longitude > 180) return null;

	return { latitude, longitude };
}

export interface CheckInValidation {
	readonly withinRadius: boolean;

	/** Rounded to whole metres. Sub-metre precision would imply accuracy that no phone GPS has. */
	readonly distanceMetres: number;

	/** Echoed back so the caller can say "you are 340m away, you need to be within 200m". */
	readonly radiusMetres: number;
}

/**
 * Compares a submitted position against the agreed meetup location.
 *
 * @param submitted The position reported by the participant's device.
 * @param agreed    The stored coordinates of the commitment's meetup location.
 * @param radiusMetres The permitted radius, from `market_settings`.
 */
export function validateCheckIn(
	submitted: Coordinates,
	agreed: Coordinates,
	radiusMetres: number
): CheckInValidation {
	const distance = Math.round(distanceMetres(submitted, agreed));

	return {
		withinRadius: distance <= radiusMetres,
		distanceMetres: distance,
		radiusMetres
	};
}
