# Kommitly Wallet Service — Implementation Contract

Status: **specification.** Nothing here is built.

This document defines the complete contract for the Cloud Function that owns
wallet creation and every movement of money in Kommitly. It is written to be
implemented by someone with no other context, so it states its requirements
exactly rather than by reference.

If any requirement here is ambiguous, stop and ask. Do not resolve it by
choosing what seems reasonable — the rules below encode product decisions, not
preferences.

---

## 1. Scope

### This service owns

- Creating a custodial Solana wallet per user
- Holding and using the signing keys for those wallets
- Crediting incoming SOL deposits as fiat
- Locking, refunding and forfeiting commitment stakes
- Transferring purchase payments between users
- Paying out withdrawals to an external Solana address
- Writing every row in `wallet_transactions`
- Writing every balance in `wallets`

### This service does NOT own

- Deciding how large a stake should be (reputation service)
- Deciding whether a commitment should be refunded or forfeited (application)
- Any table other than `wallets` and `wallet_transactions`
- Any user-facing logic, UI or notification

The application tells this service **what to do**. This service decides only
**whether it is permitted and how to execute it safely.** It never infers
intent from commitment state.

---

## 2. Non-negotiable rules

These are invariants. A build that violates any of them is incorrect
regardless of whether tests pass.

### Money

1. **All amounts are integers in fiat minor units (cents).** No floating point
   anywhere — not in JSON, not in the database, not in intermediate
   arithmetic. A JSON payload containing `10.50` must be rejected, not
   rounded.
2. **`available_balance_cents` and `locked_balance_cents` are never negative.**
   Any operation that would make either negative fails and changes nothing.
3. **For every wallet, at all times:**
   `available_balance_cents + locked_balance_cents` equals the net sum of that
   wallet's `completed` ledger rows. A balance that disagrees with its history
   is a corruption, and the service must fail loudly rather than proceed.
4. **A balance is never written without a ledger row in the same database
   transaction.** Not before, not after, not in a separate call.

### Keys

5. **Private keys, seed phrases and keypairs are never written to the
   database, never logged, never returned in a response, and never included in
   an error message.** The `wallets.solana_address` column holds a public
   address and nothing else.
6. If a key must be recoverable, it is held in the service's own key
   management, encrypted at rest, outside Postgres.

### Privacy

7. **A user's `solana_address` must never be disclosed to another user.** This
   service may return an address to the account that owns it. It must never
   return a counterparty's address in any response, including purchase
   responses.

### Execution

8. **Every mutating operation is idempotent** — see section 4.
9. **Nothing is partially applied.** Either the whole operation takes effect or
   none of it does.

---

## 3. Transport and authentication

A single Supabase Edge Function named `wallet`, routed by path:

```
POST {SUPABASE_URL}/functions/v1/wallet/{operation}
```

| Requirement | Value |
| --- | --- |
| Method | `POST` only. Any other method returns `405`. |
| Content type | `application/json`. Anything else returns `415`. |
| Authentication | `Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}` |
| Caller | The Kommitly server only. Never the browser. |

**This service is never called from client-side code.** It authenticates the
caller as a trusted server, not as a user, and therefore performs no
user-level authorisation of its own. The application is responsible for
deciding that a given user is allowed to trigger an operation before calling.

Any request without a valid service role key returns `401` and must not be
logged with its body.

---

## 4. Idempotency

Every mutating operation requires an `idempotency_key` in the request body.

This is the single most important mechanic in the contract. Network calls time
out and get retried; without this, a retry moves money twice.

### Required behaviour

1. `idempotency_key` is a caller-supplied string, 16–128 characters. The
   application generates it, typically as a UUID, and **reuses the same key
   when retrying the same logical operation.**
2. It is stored on the resulting `wallet_transactions` row and is **unique
   across the whole table.**
3. On receiving a key that already exists:
   - If the request body is **identical** to the original, return the original
     result with HTTP `200` and `"replayed": true`. Do not execute anything.
   - If the request body **differs**, return `409` with error code
     `IDEMPOTENCY_KEY_REUSED`. Do not execute anything.
4. Uniqueness is enforced by a database constraint, not by a read-then-write
   check. Two concurrent requests with the same key must not both succeed, and
   only a unique index reliably prevents that.

An operation that fails with a business error (insufficient funds, say) still
consumes its key only if it wrote a ledger row. Validation failures that write
nothing do not consume the key, so the caller may correct and retry.

---

## 5. Error model

Every error response has this exact shape and HTTP status:

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Human-readable explanation, safe to log.",
    "details": {}
  }
}
```

`code` is stable and machine-readable. Callers branch on `code`, never on
`message`. `message` must never contain a key, address or token.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Missing or invalid service role key. |
| `INVALID_REQUEST` | 400 | Malformed body, missing field, or a non-integer amount. |
| `INVALID_AMOUNT` | 400 | Amount is zero, negative, or not an integer. |
| `WALLET_NOT_FOUND` | 404 | No wallet for the given `profile_id`. |
| `WALLET_ALREADY_EXISTS` | 409 | A wallet already exists for that profile. |
| `INSUFFICIENT_FUNDS` | 422 | Available balance is lower than the requested amount. |
| `STAKE_NOT_LOCKED` | 422 | No matching active lock to refund or forfeit. |
| `STAKE_ALREADY_RESOLVED` | 409 | That stake was already refunded or forfeited. |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Key seen before with a different body. |
| `CHAIN_UNAVAILABLE` | 503 | Solana RPC unreachable or failing. Caller may retry with the same key. |
| `RATE_UNAVAILABLE` | 503 | SOL/fiat rate could not be obtained. Retryable. |
| `BALANCE_INTEGRITY_ERROR` | 500 | A balance disagreed with its ledger. See rule 3. Alert, do not retry. |

`CHAIN_UNAVAILABLE` and `RATE_UNAVAILABLE` are the only codes a caller should
retry automatically. Everything else needs a decision.

---

## 6. Operations

Amounts are always integer cents. `profile_id` is always a uuid.

### 6.1 `POST /wallet/create`

Creates a custodial wallet and its Solana address for a **user or a charity**.

Exactly one of `profile_id` and `charity_id` must be supplied. A charity holds
a wallet on the same terms as any user, so forfeited stakes arrive through the
ordinary ledger rather than a separate payout path.

```json
{ "profile_id": "uuid", "idempotency_key": "string" }
```

```json
{ "charity_id": "uuid", "idempotency_key": "string" }
```

```json
{
  "wallet_id": "uuid",
  "solana_address": "base58",
  "available_balance_cents": 0,
  "locked_balance_cents": 0,
  "replayed": false
}
```

- Generates a keypair, stores the **public address only** in `wallets`, and
  places the private key in key management.
- Writes no ledger row — nothing has moved.
- Supplying both `profile_id` and `charity_id`, or neither, is
  `INVALID_REQUEST`.
- Errors: `WALLET_ALREADY_EXISTS`, `INVALID_REQUEST`.

### 6.2 `GET /wallet/balance?profile_id={uuid}`

Read-only. The one `GET` in the contract, and the only operation without an
idempotency key.

```json
{
  "wallet_id": "uuid",
  "available_balance_cents": 12500,
  "locked_balance_cents": 1000,
  "solana_address": "base58"
}
```

Before returning, verify rule 3 — that the balances match the ledger. If they
do not, return `BALANCE_INTEGRITY_ERROR` rather than a plausible-looking wrong
number.

### 6.3 `POST /wallet/deposit`

Credits a **confirmed** on-chain deposit as fiat. Called when SOL has already
landed and been confirmed; this operation records it, it does not wait for it.

```json
{
  "profile_id": "uuid",
  "lamports": 250000000,
  "solana_transaction_signature": "base58",
  "idempotency_key": "string"
}
```

```json
{
  "wallet_transaction_id": "uuid",
  "amount_cents": 4375,
  "lamports": 250000000,
  "sol_price_cents": 1750,
  "available_balance_cents": 16875,
  "replayed": false
}
```

- Obtains the SOL/fiat rate, converts, and credits `available_balance_cents`.
- **Records `lamports` and `sol_price_cents` on the ledger row.** The rate used
  must be reconstructable later; without it a deposit cannot be audited or
  explained to a user.
- Rounding: **round down to the nearest cent.** Never round up — crediting a
  cent that was not received breaks rule 3.
- Ledger row: `type: deposit`, `status: completed`.
- Errors: `WALLET_NOT_FOUND`, `RATE_UNAVAILABLE`, `INVALID_AMOUNT`.

### 6.4 `POST /wallet/lock-stake`

Moves money from available to locked when a seller accepts a commitment.

```json
{
  "profile_id": "uuid",
  "commitment_id": "uuid",
  "amount_cents": 1000,
  "idempotency_key": "string"
}
```

```json
{
  "wallet_transaction_id": "uuid",
  "available_balance_cents": 15875,
  "locked_balance_cents": 1000,
  "replayed": false
}
```

- Decrements available by `amount_cents`, increments locked by the same.
- **Touches no blockchain.** This is an internal ledger movement; the SOL never
  leaves the treasury.
- Fails with `INSUFFICIENT_FUNDS` if available is lower than the amount. The
  application must handle this — a seller accepting a commitment the buyer can
  no longer fund is a real case, not an edge case.
- At most **one active lock per (commitment_id, profile_id).** A second attempt
  with a different idempotency key returns `STAKE_ALREADY_RESOLVED`.
- Ledger row: `type: commitment_lock`, `status: completed`.

### 6.5 `POST /wallet/refund-stake`

Returns a locked stake to available. Used whenever a commitment resolves in the
user's favour: meetup verified, stale, or the other party was responsible.

```json
{
  "profile_id": "uuid",
  "commitment_id": "uuid",
  "idempotency_key": "string"
}
```

```json
{
  "wallet_transaction_id": "uuid",
  "amount_cents": 1000,
  "available_balance_cents": 16875,
  "locked_balance_cents": 0,
  "replayed": false
}
```

- **No amount is supplied.** The service refunds exactly what was locked for
  that commitment and profile, found from the ledger. A caller-supplied amount
  would allow refunding more than was staked.
- Errors: `STAKE_NOT_LOCKED`, `STAKE_ALREADY_RESOLVED`.
- Ledger row: `type: commitment_refund`, `status: completed`.

### 6.6 `POST /wallet/forfeit-stake`

Takes a locked stake and sends it to the charity. Used for cancellation after
acceptance, and for a no-show.

```json
{
  "profile_id": "uuid",
  "commitment_id": "uuid",
  "charity_id": "uuid",
  "idempotency_key": "string"
}
```

```json
{
  "wallet_transaction_id": "uuid",
  "charity_wallet_transaction_id": "uuid",
  "amount_cents": 1000,
  "available_balance_cents": 15875,
  "locked_balance_cents": 0,
  "replayed": false
}
```

- As with refund, **the amount is derived from the lock, never supplied.**
- **This is a transfer between two wallets, not a deduction.** It writes two
  ledger rows in one database transaction: the forfeit against the user's
  wallet, and a matching credit to the charity's wallet. Both, or neither.
- As in 6.7, derive the two stored idempotency keys deterministically from the
  caller's single key so each row stays individually unique.
- The charity's wallet is located by `charity_id`. If that charity has no
  wallet, the operation fails with `WALLET_NOT_FOUND` — **do not create one
  implicitly.** A forfeit silently inventing a wallet would make a
  misconfigured charity id look successful while the money went nowhere
  identifiable.
- The money must **not** touch any Kommitly-owned balance at any point. §12 of
  the product spec is explicit that forfeited funds are not platform revenue,
  and routing them through a platform account first would make that
  indistinguishable in the ledger.
- Touches no blockchain. Both wallets are custodial, so this is an internal
  movement.
- Errors: `STAKE_NOT_LOCKED`, `STAKE_ALREADY_RESOLVED`, `WALLET_NOT_FOUND`.

### 6.7 `POST /wallet/transfer-purchase`

Moves the item price from buyer to seller after QR #2.

```json
{
  "buyer_profile_id": "uuid",
  "seller_profile_id": "uuid",
  "commitment_id": "uuid",
  "payment_id": "uuid",
  "amount_cents": 45000,
  "idempotency_key": "string"
}
```

```json
{
  "buyer_wallet_transaction_id": "uuid",
  "seller_wallet_transaction_id": "uuid",
  "amount_cents": 45000,
  "replayed": false
}
```

- Writes **two** ledger rows in **one** database transaction: `purchase` on the
  buyer's wallet, `sale` on the seller's. Both, or neither.
- Because one idempotency key must cover two rows, derive the stored keys
  deterministically — for example `{key}:purchase` and `{key}:sale` — so both
  remain individually unique while one caller key controls the pair.
- **Returns no address for either party.** See rule 7.
- Errors: `INSUFFICIENT_FUNDS` (buyer), `WALLET_NOT_FOUND`.

### 6.8 `POST /wallet/withdraw`

The only operation that sends SOL out. Two-phase — see section 7.

```json
{
  "profile_id": "uuid",
  "amount_cents": 5000,
  "destination_address": "base58",
  "idempotency_key": "string"
}
```

```json
{
  "wallet_transaction_id": "uuid",
  "status": "pending",
  "amount_cents": 5000,
  "lamports": 285714285,
  "sol_price_cents": 1750,
  "replayed": false
}
```

- Validates `destination_address` as a well-formed Solana address **before**
  touching any balance. A malformed address that reaches the chain burns the
  transfer.
- Rounding: **round down** when converting cents to lamports, so the service
  never sends more than was withdrawn.
- Returns while the row is still `pending`. Completion is reported separately.
- Errors: `INSUFFICIENT_FUNDS`, `INVALID_REQUEST` (bad address),
  `CHAIN_UNAVAILABLE`, `RATE_UNAVAILABLE`.

---

## 7. On-chain operations are two-phase

`withdraw` is the only operation that submits a Solana transaction. It must
never be implemented as a single step, because the chain can succeed while the
response is lost, or fail after the balance is already gone.

### Required sequence

**Phase 1 — reserve, in one database transaction:**

1. Verify available balance covers the amount.
2. Decrement `available_balance_cents`.
3. Insert the ledger row with `status: pending`.
4. Commit.

Only then return the `pending` response to the caller.

**Phase 2 — settle, after submitting to Solana:**

- **Confirmed:** set `status: completed`, store
  `solana_transaction_signature`, set `completed_at`. The balance already
  reflects it; do not decrement again.
- **Failed:** set `status: failed`, store `failure_reason`, and **restore**
  `available_balance_cents` by the same amount, in one database transaction.
- **Unknown** (submitted, no confirmation): leave the row `pending`. **Do not
  guess.** A reconciliation job resolves it by querying the chain for the
  signature. Never restore a balance for a transaction that might have
  succeeded — that is how money is created from nothing.

### Reconciliation

A scheduled job must find `pending` rows older than a threshold and resolve
them against the chain. Any row left `pending` indefinitely is money in limbo
and must raise an alert.

---

## 8. Concurrency

Two requests touching the same wallet can arrive at once. Without protection,
both read a balance of 100, both lock 100, and the wallet ends at -100.

### Required

1. **Lock the wallet row** with `SELECT ... FOR UPDATE` before reading a
   balance that will be written. Read-modify-write without the lock is a
   defect.
2. **Keep the transaction short.** Never hold a row lock across a network call
   to Solana or a rate provider. Fetch rates before opening the transaction.
3. **Always lock multiple wallets in a consistent order** — ascending
   `wallet_id` — in `transfer-purchase`. Two simultaneous transfers between the
   same two users in opposite directions will deadlock otherwise.
4. The unique constraint on `idempotency_key` is the final defence. If a
   concurrent insert violates it, treat that as a replay, not an error.

---

## 9. Explicitly forbidden

A build doing any of the following is wrong, regardless of behaviour:

1. Writing a private key, seed phrase or keypair to any database column.
2. Logging a private key, a service role key, or a full request body
   containing either.
3. Returning any user's `solana_address` to a different user.
4. Using a floating point type for any monetary value, at any point.
5. Writing a balance without a ledger row in the same database transaction.
6. Allowing either balance to go negative.
7. Rounding a conversion **up**, in any direction of flow.
8. Restoring a balance for an on-chain transaction whose outcome is unknown.
9. Inferring intent from commitment state — for example, deciding to forfeit
   rather than refund because the commitment "looks" cancelled. The caller
   decides; this service executes.
10. Crediting forfeited funds to any Kommitly-owned account, or routing them
    through one on the way to a charity.
11. Accepting calls from anything other than the Kommitly server.

---

## 10. Required environment

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Injected automatically. |
| `SUPABASE_SERVICE_ROLE_KEY` | Injected automatically. Used for database access. |
| `SOLANA_RPC_URL` | Chain endpoint. |
| `SOLANA_TREASURY_PUBLIC_KEY` | Treasury address. |
| `SOLANA_TREASURY_PRIVATE_KEY` | Treasury signing key. Set via `supabase secrets set`, never in a file. |
| Rate provider credentials | **Open question 2** — provider not yet chosen. |

Edge Function secrets are separate from the application's `.env`. Set them
with `npx supabase secrets set`.

---

## 11. Settled

| Question | Answer |
| --- | --- |
| Custody | **Custodial.** This service holds the keys; users never manage their own. |
| Unit of account | **Fiat cents.** SOL is a deposit and withdrawal rail only. |
| How charities are paid | **They hold a wallet.** A forfeit is an ordinary two-wallet transfer. |

## 12. Open questions blocking implementation

1. **Fiat currency** — USD or CAD? Determines the rate pair to quote against.
2. **Rate provider** — which source for SOL/fiat, and how often is it
   refreshed? A stale rate silently mis-credits every deposit, and the error is
   invisible until someone reconciles.
3. **Is a rate quoted to the user before they deposit?** If a figure is shown
   in advance, the tolerated drift between quote and credit must be defined.
4. **Withdrawal minimum, and who pays the network fee** — taken from the
   withdrawal amount, or absorbed by the treasury? This changes what a user
   receives, so it cannot be decided during implementation.
5. **Key management.** Where do the custodial private keys live, how are they
   encrypted, and who can reach them? **This is the largest unanswered
   security question in the contract and should be settled before a single key
   is generated** — retrofitting key storage means migrating live funds.
6. **Reconciliation interval** for withdrawals left `pending`.
7. **Deposit detection.** Operation 6.3 assumes it is *told* that SOL has
   arrived. Nothing in this contract watches the chain. Does a job poll, or
   does a provider webhook call in? Whoever builds that owns the
   at-least-once delivery problem, which is why 6.3 is idempotent.
8. **Wallet creation timing** — at sign-up for every user, or lazily on first
   deposit?
