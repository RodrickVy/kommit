/**
 * Asserts that an optional secret has actually been configured.
 *
 * Secrets are declared in `src/env.ts` with a schema that permits absence, so
 * their type is `string | undefined` and the app starts without them. That is
 * deliberate: each secret is needed by exactly one feature, and a developer
 * should be able to run the app without a treasury private key on their
 * machine.
 *
 * The consequence is that whichever feature needs a secret has to demand it.
 * This function is that demand — it turns "possibly absent" into "present, or
 * a clear error naming exactly what is missing".
 *
 * @param name  The variable name, exactly as it appears in `.env.example`.
 *              Passed explicitly because a value carries no name of its own.
 * @param value The value imported from `$app/env/private`.
 * @returns The value, guaranteed present.
 * @throws If the secret is not configured.
 */
export function requireSecret(name: string, value: string | undefined): string {
	if (value === undefined) {
		throw new Error(
			`${name} is not configured, and this feature cannot run without it.\n` +
				`Add it to your .env file (see .env.example), or to the environment ` +
				`variables of your deployment.`
		);
	}

	return value;
}
