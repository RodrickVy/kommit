# kommitly

Kommitly is a peer-to-peer marketplace where buyers and sellers put down
refundable commitment fees to prove they’ll show up, making local transactions
more reliable and trustworthy.

---

## Status

This repository currently contains the **application shell**. What works:

- every route exists and renders, with the layout, navigation and page titles
  in place
- the design system — tokens, the cut-corner shape language, and the shared
  components everything else is built from
- the Supabase connection, including request-scoped clients and verified
  sessions
- every environment variable, declared, documented and validated at startup

What does not exist yet, deliberately:

- any database schema (`supabase/migrations/` is empty)
- authentication flows — `/signin` and `/join` are empty pages
- route guards, so no page is access-controlled yet
- all page content beyond the home page's diagnostics

Pages are intentionally blank. Each is built in its own change, together with
the services and queries it needs.

## Tech stack

| Layer      | Choice                                                     |
| ---------- | ---------------------------------------------------------- |
| Framework  | SvelteKit 3 (Svelte 5, server-side rendered)                |
| Language   | TypeScript, `strict`                                       |
| Build      | Vite 8                                                     |
| Data       | Supabase — Postgres, Auth, Storage                          |
| Styling    | Plain CSS with custom properties. No CSS framework          |
| Hosting    | Vercel, Node.js runtime                                     |
| Chain      | Solana                                                      |

**Every dependency is pinned to an exact version**, and `.npmrc` sets
`save-exact=true` so new ones are pinned too. Nothing moves unless someone
bumps it deliberately. SvelteKit 3.0.0 was released on 2026-10-01, so patch
releases are expected — we take them on purpose, after reading the changelog,
rather than silently on someone's next `npm install`. Upgrade with
`npm outdated` to see what moved, then bump one thing at a time.

## Getting started

**Requirements:** Node.js `^22.17 || >=24` — the range the toolchain actually
supports, declared in `package.json` and enforced at install time by
`engine-strict` in `.npmrc`. Node 23 is excluded; it is not an LTS line and
`vite-plugin-svelte` does not support it. Docker is needed only if you want to
run Supabase locally.

```bash
npm install
cp .env.example .env
```

Then open `.env` and fill in `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_ANON_KEY`. Every other variable ships with a working default.

- **Hosted project:** Supabase Dashboard → Project Settings → API
- **Local project:** run `npm run db:start` and use the values it prints

```bash
npm run dev
```

The app starts on <http://localhost:5173>. The home page reports whether it
can reach Supabase, so a misconfigured `.env` is visible immediately rather
than failing later as a confusing error.

## Scripts

| Script                 | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `npm run dev`          | Dev server with hot reload                                           |
| `npm run build`        | Production build                                                     |
| `npm run preview`      | Serve the production build locally                                   |
| `npm run check`        | Type-check everything, including `.svelte` files                     |
| `npm run check:watch`  | The same, in watch mode                                              |
| `npm run db:start`     | Start the local Supabase stack (needs Docker)                        |
| `npm run db:stop`      | Stop it                                                              |
| `npm run db:migration` | Scaffold a new migration — pass a name                               |
| `npm run db:reset`     | Drop the local database, replay every migration, run the seed        |
| `npm run db:push`      | Apply pending migrations to the linked remote project                |
| `npm run db:diff`      | Capture remote schema drift as a migration — pass a name             |
| `npm run db:types`     | Regenerate `src/lib/supabase/database.types.ts`                      |
| `npm run fn:serve`     | Serve Edge Functions locally                                         |
| `npm run fn:deploy`    | Deploy Edge Functions                                                |

Run `npm run check` before committing. It is the only thing that type-checks
Svelte markup, so a broken component prop will not be caught by anything else.

## Project structure

```
src/
  app.css                  Design tokens and base styles. The only global CSS
  app.html                 HTML shell
  app.d.ts                 Types for event.locals
  env.ts                   Every environment variable, declared and validated
  hooks.server.ts          Per-request setup: Supabase client, verified user

  lib/
    components/
      layout/              App shell: header, footer, brand
      ui/                  Reusable primitives: Panel, Button, PageHeader
    config/
      navigation.ts        Single source of truth for the primary navigation
    server/                Server-only. See the note below the tree
      auth/verify-user.ts  The one place a request is judged authenticated
      config/              Asserting that optional secrets are configured
      supabase/            Request-scoped client, and the privileged client
    supabase/
      database.types.ts    Generated — do not edit. `npm run db:types`
    types/                 Domain types owned by kommitly, not by Supabase

  routes/                  One directory per URL

supabase/
  config.toml              Supabase CLI configuration
  migrations/              All schema as SQL. See its README
  functions/               Edge Functions. See its README
  seed.sql                 Local development data
```

Imports use `#lib/...`, Node's subpath imports, declared in `package.json`.
SvelteKit 3 removed the old `$lib` alias.

Anything under `src/lib/server/` is a **server-only module**. SvelteKit refuses
to bundle it into client code, so importing it from a component fails the
build with `server_only_import` rather than shipping a secret to the browser.
The guard matches the resolved file path, so it applies to `#lib/server/...`
exactly as it did to the old `$lib/server/...`.

> It fires at **build** time, not during `npm run dev` — dev renders the
> component on the server first, where the import is legal. So a leak
> introduced while developing stays invisible until `npm run build`. This is
> one of the reasons to build before merging, not only before deploying.

> **Both halves of that mapping are required.** `package.json`'s `imports`
> field is what Vite and Rolldown resolve; the matching `paths` entry in
> `tsconfig.json` is what TypeScript resolves, because TypeScript does not
> infer file extensions through `imports`. Removing either one breaks half the
> toolchain, silently. `tsconfig.json` explains this at the point of use.

## Routes

Every route below exists and renders. All but `/` are empty stubs.

| Path                               | Shown in nav      |
| ---------------------------------- | ----------------- |
| `/`                                | Brand link        |
| `/discover`                        | Always            |
| `/impact`                          | Always            |
| `/stats`                           | Always            |
| `/commitments`                     | When signed in    |
| `/commitment/[commitment_id]`      | —                 |
| `/commitment/[commitment_id]/tap`  | —                 |
| `/commitment/[commitment_id]/pay`  | —                 |
| `/check-in/[commitment_id]`        | —                 |
| `/sell`                            | When signed in    |
| `/sell/create_listing`             | —                 |
| `/sell/[listing_id]`               | —                 |
| `/wallet`                          | When signed in    |
| `/account`                         | Account button    |
| `/signin`                          | Signed out only   |
| `/join`                            | Signed out only   |

The home page is `/` itself — there is no `/home` and no redirect, so there is
exactly one URL that can represent it.

`/sell/create_listing` is a static segment and `/sell/[listing_id]` is a
dynamic one. SvelteKit matches static before dynamic, so `create_listing` is
reachable; the only consequence is that a listing whose id were literally
`create_listing` could not be addressed.

**Showing a link is not access control.** `navigation.ts` decides what is
*displayed*; anyone can still type a URL. Guards belong in each route's
`+page.server.ts` or `+layout.server.ts`, backed by Row Level Security in the
database. Neither exists yet.

## Conventions

### Data loading

Data is loaded **hierarchically**, so a navigation does not re-fetch what the
app already has.

- **`src/routes/+layout.server.ts` loads the user, once.** Every route
  inherits it. No page resolves the user for itself.
- It reads only `locals`, and therefore touches none of the things SvelteKit
  tracks as dependencies (route params, `url` properties, `depends()`). So it
  is **not** re-run as the user moves between pages — the header keeps
  rendering the same user with no extra work. Reading `url.pathname` there
  would silently destroy that property.
- **`+page.server.ts` loads only what one page needs.** Anything path-specific
  belongs there, never in the root layout, or every route pays for one route's
  query.

When writing queries:

- **Never `select('*')`.** Name the columns. The generated types then describe
  exactly what was fetched, and a column added later does not quietly start
  travelling to the browser.
- **Paginate anything unbounded** — listings, transactions — with `.range()`.
- **Fetch non-essential data from the client** when it would otherwise delay
  the server render.
- Remember that whatever a `load` function returns is **serialised into the
  page's HTML**. It is both bandwidth and a disclosure surface.

### Authentication

`src/lib/server/auth/verify-user.ts` is the only place that may decide a
request is authenticated.

It uses `auth.getClaims()`, which verifies the access token's signature
locally against the project's JSON Web Key Set. It does **not** use
`auth.getSession()`, which decodes the token without checking it — cookies are
client-supplied, so trusting that would be an authentication bypass.

The result is memoised per request in `hooks.server.ts`, so the check runs at
most once per request however many times it is asked for.

> **This project currently signs JWTs with HS256 — a symmetric secret.** With
> symmetric signing, `getClaims()` cannot verify locally and falls back to an
> HTTP round trip to the Auth server on every request, exactly like
> `getUser()`. Switching the project to asymmetric signing keys (Supabase
> dashboard → Project Settings → JWT Keys) lets verification happen locally
> against a cached JWKS, with no network call after the first. The code does
> not change — it is purely a project setting, and it is the difference
> between one network round trip per page view and none.

Supabase is **server-only** in this codebase. There is no browser client and
no `onAuthStateChange` listener: auth happens through server form actions,
which keeps the client bundle smaller and avoids two clients disagreeing about
who is signed in. Add a browser client when something genuinely needs one —
realtime subscriptions, say — as a deliberate change.

### The two Supabase clients

| Client                     | Identity       | RLS            | Use for                                  |
| -------------------------- | -------------- | -------------- | ---------------------------------------- |
| `event.locals.supabase`    | The user       | **Enforced**   | Everything that serves a request         |
| `adminClient()`            | `service_role` | **Bypassed**   | Webhooks, scheduled jobs, data repair    |

Authorisation lives in the database. A forgotten `.eq('user_id', …)` filter
cannot expose another user's rows, because RLS already prevented it.

If a query "returns nothing" and reaching for `adminClient()` would fix it, an
RLS policy is wrong. Fix the policy.

### Environment variables

All of them are declared in **`src/env.ts`**, which is the authoritative list.
SvelteKit validates them at startup and generates typed modules:

```ts
import { PUBLIC_SUPABASE_URL } from '$app/env/public';        // anywhere
import { SUPABASE_SERVICE_ROLE_KEY } from '$app/env/private'; // server only
```

Nothing reads `process.env`. A variable added to `.env` but not to `src/env.ts`
is not readable.

- **Public variables are required at startup.** A misconfigured deployment
  fails immediately, naming the variable, rather than failing later as a 401
  or a malformed URL.
- **Secrets are optional at startup, required at the point of use**, via
  `requireSecret()`. Each is needed by one feature, so a missing treasury key
  should break the treasury, not the home page.
- `public: true` means the value is **shipped to the browser**. Importing a
  private variable from client code is a build error, not a leak.

### Styling

`src/app.css` holds the whole design system. Components use only **semantic**
tokens (`--k-surface`, `--k-primary`, `--k-text-muted`), never the raw palette
(`--k-teal-500`) and never a literal colour. That indirection is what makes
retheming a one-file change.

**kommitly has no rounded corners.** Corners are chamfered — cut at 45° — via
the global `.k-cut` class, sized by `--k-cut`.

The consequence worth knowing: `clip-path` clips an element's `outline` and
any outer `box-shadow`, so on a cut element a border is sliced at the corners,
a drop shadow is invisible, and the browser's default focus ring **disappears
entirely**. kommitly therefore draws borders and focus rings as **inset**
shadows, which paint inside the clip and trace the chamfer exactly, and
expresses depth with surface lightness instead of shadows. Section 6 of
`app.css` explains it in full. This is the one technique the visual language
rests on — changing it changes everything.

Build pages from `Panel`, `Button` and `PageHeader` rather than fresh markup.
That is what keeps spacing, shape and focus behaviour identical everywhere.

### Database

All schema lives in `supabase/migrations/` as SQL, never in the dashboard. See
[`supabase/migrations/README.md`](supabase/migrations/README.md) for the
workflow and rules — in particular that **every table must enable Row Level
Security in the migration that creates it**, since the app reaches Postgres
through PostgREST with the `anon` key.

Edge Functions live in `supabase/functions/`. See
[its README](supabase/functions/README.md) for when a function is the right
home for something and when a SvelteKit route is.

After any migration, run `npm run db:types` so
`src/lib/supabase/database.types.ts` matches the schema. Queries are typed from
that file, so a stale copy means a misspelled column compiles.

## Deployment

Vercel, via `@sveltejs/adapter-vercel`, pinned to the Node.js runtime rather
than Edge — the Solana libraries need Node built-ins (`crypto`, `buffer`) that
the Edge runtime does not provide.

### Vercel project settings

Selecting the SvelteKit preset fills Build Command, Output Directory and
Install Command with greyed-out **placeholders**. Those are defaults, not
values — nothing is set until the override toggle is switched on. Only one
field is worth overriding.

| Setting          | What to do                              | Preset shows   |
| ---------------- | --------------------------------------- | -------------- |
| Framework Preset | Select `SvelteKit`                      | —              |
| Build Command    | Leave alone                             | `vite build`   |
| Output Directory | **Leave alone — do not type anything**  | `public`       |
| Install Command  | Override with `npm ci` (optional)       | auto-detected  |
| Node.js Version  | Set to 22.x                             | —              |

`vite build` is exactly what `npm run build` runs, so the default is correct.

**The preset must be `SvelteKit`, not `Svelte`.** Vercel offers both. `Svelte`
is for a plain Svelte SPA built with Vite: it expects a static `dist/` folder
and creates no serverless functions, so server-side rendering, every
`+page.server.ts` and every form action would silently disappear. The build
still reports success and then serves a broken static site. Vercel normally
detects the right one from `@sveltejs/kit` in `package.json` — having it in
`devDependencies` is correct and does not affect detection.

**Ignore the `public` placeholder under Output Directory.** It is a legacy
default in Vercel's preset and no modern SvelteKit deploy uses it: once the
build writes `.vercel/output/config.json`, Vercel switches to the Build Output
API and ignores `outputDirectory` entirely. Leaving the field untouched is
correct. Typing a real value is what breaks the deployment, because an explicit
output directory overrides that detection and Vercel then serves a folder that
does not exist.

`npm ci` rather than `npm install` is the one override worth making.
`npm install` respects the lockfile and works fine; `npm ci` additionally fails
loudly if `package-lock.json` and `package.json` ever drift apart, which is the
guarantee being paid for by pinning every version.

Node 22.x matches the `runtime: 'nodejs22.x'` the adapter is configured with in
`vite.config.ts`. Note that `.npmrc` sets `engine-strict=true`, so a Node
version outside `^22.17 || >=24` fails the install outright rather than
warning — that is deliberate, but it is the first thing to check if a build
suddenly fails on an engine error.

### Environment variables

Set every variable from `.env.example` in the Vercel project's environment
settings. Values are read at runtime, not inlined at build time, so one build
can be promoted from preview to production without rebuilding.

Vercel can import a `.env` file directly, but **do not import the local one
unchanged**:

- `PUBLIC_APP_URL` is `http://localhost:5173` locally. In production it must be
  the real domain, or auth redirects and share links will point at localhost.
  Preview deployments each get their own URL, so this cannot be one fixed value
  across environments — when auth redirects are built, deriving the origin from
  the request is likely better than a fixed variable.
- The empty variables (`SENDGRID_*`, `SOLANA_TREASURY_*`) can simply be
  omitted. They are declared optional, so absent and empty mean the same thing.
- Set the rest for **Production and Preview** both. A variable set only for
  Production makes every preview deployment fail at startup.

> **Building on Windows:** `npm run build` compiles correctly but the Vercel
> adapter then fails with `EPERM: operation not permitted, symlink` while
> writing `.vercel/output`. Creating symlinks on Windows needs Developer Mode
> or an elevated shell. It does not affect `npm run dev`, and Vercel's own
> builds run on Linux, so deployment is unaffected.

## Decisions to revisit

Recorded here so they are chosen deliberately rather than inherited by
accident:

- **No Content Security Policy yet.** One belongs in `vite.config.ts`, but it
  can only be written once every origin the app talks to is known — Supabase
  REST and Auth, Storage for listing images, the Solana RPC endpoint. A
  guessed policy fails silently in production, so it is its own reviewed
  change.
- **No route guards.** Nothing is access-controlled. Add guards alongside the
  first authenticated feature, and RLS policies alongside the first table.
- **No linter or formatter.** Worth adding before more than one person is
  committing.
- **`/commitments` is plural but `/commitment/[id]` is singular.** This is
  what was specified, and it works, but it means the list and detail pages do
  not share a path prefix — which is why `navigation.ts` needs an `activeFor`
  entry to highlight the nav correctly. Worth settling before more links are
  written against these paths.
- **Home page content is scaffolding.** The two diagnostic panels on `/` exist
  to prove the setup works and should be replaced when the real home page is
  designed.
