# Edge Functions

Deno functions deployed to Supabase, one directory per function.

## When to use one, and when not to

kommitly is a server-rendered SvelteKit app running on Vercel's Node runtime, so
most server-side work has a simpler home: a `+page.server.ts` load function, a
form action, or a `+server.ts` endpoint. Those share the app's types, its
Supabase client and its environment, and they deploy with the rest of the app
in one step.

Reach for an Edge Function when the work genuinely does not belong to a page
request:

- **Inbound webhooks** from a third party, where the caller is another system
  and there is no user session to act as.
- **Scheduled work**, triggered by `pg_cron` or an external scheduler.
- **Database triggers** that need to call out to a network service, which
  Postgres itself should not be doing inside a transaction.
- **Logic that must be callable from outside the app**, for example by a
  mobile client that does not go through the web frontend.

If a feature could be either, prefer the SvelteKit route. Fewer deployment
targets is worth more than theoretical separation.

## Creating one

```bash
npx supabase functions new handle_stripe_webhook
```

This creates `supabase/functions/handle_stripe_webhook/index.ts`.

Name directories in `snake_case`, after the event or job they handle.

## Running and deploying

```bash
npm run fn:serve                          # serve every function locally
npm run fn:deploy                         # deploy every function
npx supabase functions deploy <name>      # deploy just one
```

## Secrets

Functions do not read the app's `.env`. They have their own secret store:

```bash
npx supabase secrets set SOME_KEY=value
npx supabase secrets list
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically — do not set those yourself.

## Authorisation

A function invoked with the `service_role` key bypasses Row Level Security
entirely, exactly as described in `src/lib/server/supabase/admin-client.ts`. A
function that acts on behalf of a user should forward that user's
`Authorization` header into its Supabase client instead, so the user's RLS
policies still apply.

## Scheduling `process_commitments`

`process_commitments` is the only function meant to run on a timer. Nothing in
the app invokes it, and an ordinary user's token is refused: it resolves other
people's commitments and moves their stakes.

Run it by hand while testing:

```bash
npm run run:process-commitments
```

For production, schedule it in the Supabase dashboard under **Integrations ->
Cron**, invoking the Edge Function with the service role key. **Every fifteen
minutes** is a sensible starting point — the shortest deadline it enforces is
`check_in_window_minutes` (60), so a quarter-hour keeps the worst-case delay
between a deadline passing and the money moving under a quarter of that window.

It is safe to run as often as you like. Every status change is a
compare-and-set and every settlement is idempotent, so a run that overlaps the
previous one finds nothing left to claim.

Watch the `settlements_outstanding` count in its response. A run that resolved
ten commitments and could not pay three of them is not a success, and a
scheduler checking only the status code would never know.

## Operator functions

Two functions have no UI and never will:

```bash
npm run setup:platform-wallet     # creates the Main Wallet. Run once.
npm run setup:charity-wallets     # gives each charity a wallet. Idempotent.
```

Both require the service role. `setup_platform_wallet` proves that with a
**capability probe** rather than a string comparison against
`SUPABASE_SERVICE_ROLE_KEY`: it tries to read `platform_wallet`, which has RLS
enabled and no policies at all, so only the service role can. Supabase issues
service credentials in more than one format, and comparing tokens fails for
reasons that have nothing to do with authorisation. The shared helper is
`_shared/privileged.ts`.

## Verifying the commitment flow

```bash
npm run verify:commitments
```

Seeds three accounts and a commitment, walks `check_in`, both QR functions,
`complete_commitment`, `pay_commitment` and `process_commitments`, asserts 59
behaviours, and deletes everything it created.

**It writes to the project in `.env`** — development projects only.

It cannot prove that SOL moves, because the devnet wallets hold none. It turns
that into an assertion instead: with an empty treasury every settlement must
fail, so the script checks that the functions SAY SO — that a completed meetup
reports `buyer_refunded: false` rather than claiming the stake is back.
