# Migrations

Every change to the database lives here as a `.sql` file. The schema is
defined by this directory and nowhere else — not in the Supabase dashboard,
and not in TypeScript.

## Why SQL files and not a dashboard

A migration in this folder is reviewable in a pull request, applied
identically to every environment, and replayable from scratch onto an empty
database. A change made by clicking around the dashboard is none of those
things: it exists only in that one project, and the next environment silently
diverges.

If something was changed in the dashboard by accident, capture it as a
migration rather than leaving it only in the remote database:

```bash
npx supabase db diff -f describe_what_changed
```

## Creating one

```bash
npx supabase migration new add_listings_table
```

This creates `supabase/migrations/<utc-timestamp>_add_listings_table.sql`. The
timestamp prefix is what orders them, so never rename a file or hand-write the
prefix.

Name the file after what the migration does, in `snake_case`:
`add_listings_table`, `add_commitment_status_enum`,
`tighten_listing_select_policy`.

## Applying one

```bash
npm run db:reset    # drops the local database, replays every migration, runs seed.sql
npm run db:types    # regenerates src/lib/supabase/database.types.ts
```

`db:reset` is the real test of a migration: it proves the file works on an
empty database, in order, rather than only against whatever state your local
copy happens to be in.

Then, once it is reviewed:

```bash
npm run db:push     # applies pending migrations to the linked remote project
```

## Rules

**A migration that has been pushed is immutable.** Other environments have
already run it. Correcting it means writing a new migration, not editing the
old file.

**Every migration must be runnable on an empty database.** No dependency on
data that happens to exist, and no dependency on a migration that has not
been written yet.

**Enable Row Level Security on every table, in the same migration that
creates it.** The application talks to Postgres through PostgREST using the
`anon` key, so RLS is not a hardening measure here — it is the only thing
standing between a request and every row in the table. A table created
without it is readable by anyone on the internet.

```sql
alter table public.listings enable row level security;
```

A table with RLS enabled and no policies denies everything, which is the
correct state to start from: add policies deliberately, one per operation.

**Write policies per operation.** A single `for all` policy is almost always
wrong, because the condition for reading a row is rarely the condition for
deleting it.

## What belongs in a migration

Everything that defines the database: tables, columns, constraints, indexes,
enums, views, functions, triggers, RLS policies, grants, and storage buckets
with their policies.

## What does not

Business logic that belongs to the application, and seed or test data — that
goes in `../seed.sql`.
