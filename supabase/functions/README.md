# Edge Functions

Deno functions deployed to Supabase, one directory per function.

## When to use one, and when not to

kommit is a server-rendered SvelteKit app running on Vercel's Node runtime, so
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
