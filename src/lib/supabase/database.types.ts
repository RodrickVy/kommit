/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate after every migration:
 *
 *     npm run db:types
 *
 * which runs `supabase gen types typescript --local --schema public` against
 * the local database and overwrites this file wholesale.
 *
 * WHY THIS FILE MATTERS
 * ---------------------
 * `SupabaseClient<Database>` uses these types to infer the result of every
 * query. With them in place, `.from('listings').select('id, title')` returns
 * `{ id: string; title: string }[]`, a misspelled column is a compile error,
 * and a column removed by a migration breaks the build rather than returning
 * `undefined` at runtime. That is the whole reason we query tables through
 * PostgREST with generated types instead of hand-writing result interfaces.
 *
 * CURRENT STATE
 * -------------
 * There are no migrations yet, so the `public` schema is empty and this is a
 * hand-written stub matching exactly what the generator emits for an empty
 * schema. The first `npm run db:types` replaces it. Until then any
 * `.from(...)` call is correctly a type error — there are no tables to query.
 */

/** Any value Postgres can round-trip through JSON. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
	public: {
		Tables: { [_ in never]: never };
		Views: { [_ in never]: never };
		Functions: { [_ in never]: never };
		Enums: { [_ in never]: never };
		CompositeTypes: { [_ in never]: never };
	};
};
