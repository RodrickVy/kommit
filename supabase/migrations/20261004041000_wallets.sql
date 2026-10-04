-- ============================================================================
-- wallets, platform_wallet, wallet_transactions
-- ============================================================================
-- Custodial Solana wallets. The server holds the keys and signs on the user's
-- behalf, so nobody needs a browser extension to take part.
--
-- BALANCES ARE NOT STORED.
-- Every balance shown in the app is read live from Solana. A stored copy is a
-- second source of truth that drifts the moment any transfer happens outside
-- the app, and reconciling money after the fact is the one failure that is
-- genuinely painful. The chain is the ledger; this table holds identity and
-- keys, nothing more.
--
-- SECRET KEYS LIVE HERE, ENCRYPTED. READ THIS BEFORE CHANGING ANYTHING.
-- This reverses what docs/wallet-service-contract.md originally required. It
-- is a deliberate trade-off for a devnet hackathon, and it means:
--
--   * the encryption key is NOT in this database. It lives only in the Edge
--     Function's secret store. Someone with a database dump still has nothing.
--   * no role reachable from the browser can read the secret column at all --
--     enforced by column-level grants below, not merely by policy.
--   * before real money, this should move to a KMS or Supabase Vault, where
--     the application never sees raw key material.
-- ============================================================================

create table public.wallets (
	id uuid primary key default gen_random_uuid(),

	-- Exactly one owner. Two nullable foreign keys with a check, rather than a
	-- polymorphic owner_type/owner_id pair, so the database can still guarantee
	-- the owner actually exists.
	profile_id uuid unique references public.profiles (id) on delete cascade,
	charity_id uuid unique,

	-- Base58. The public half, safe to show the owner and to print in a QR for
	-- deposits.
	solana_address text not null unique,

	-- AES-GCM ciphertext of the 64-byte keypair, base64. The key that decrypts
	-- it is an Edge Function secret and appears nowhere in Postgres.
	secret_key_encrypted text not null,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint wallet_has_exactly_one_owner check (
		(profile_id is not null)::int + (charity_id is not null)::int = 1
	)
);

comment on column public.wallets.secret_key_encrypted is
	'Encrypted keypair. Never selectable by anon or authenticated — see grants.';

create trigger wallets_set_updated_at
	before update on public.wallets
	for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- platform_wallet — the "main wallet"
-- ----------------------------------------------------------------------------
-- Where commitment stakes are held between being taken and being returned.
-- Its own table rather than a row in `wallets` because it has no owner, and a
-- nullable-owner row would weaken the constraint above for every other wallet.
create table public.platform_wallet (
	id smallint primary key default 1 check (id = 1),
	solana_address text not null unique,
	secret_key_encrypted text not null,
	created_at timestamptz not null default now()
);

comment on table public.platform_wallet is
	'Single-row treasury holding commitment stakes. Never readable from the browser.';

-- ----------------------------------------------------------------------------
-- wallet_transactions — the record of what moved and why
-- ----------------------------------------------------------------------------
-- Not a balance ledger: the chain is authoritative for balances. This is the
-- record of WHY each transfer happened, which the chain cannot express -- a
-- signature says five lamports moved, not that it was a refund for a specific
-- commitment.
create type public.wallet_transaction_type as enum (
	'deposit',
	'withdrawal',
	'commitment_lock',
	'commitment_refund',
	'commitment_forfeit',
	'purchase',
	'sale'
);

create type public.wallet_transaction_status as enum ('pending', 'completed', 'failed');

create table public.wallet_transactions (
	id uuid primary key default gen_random_uuid(),

	-- Null for the platform wallet, which has no row in `wallets`.
	wallet_id uuid references public.wallets (id) on delete set null,

	type public.wallet_transaction_type not null,
	status public.wallet_transaction_status not null default 'pending',

	-- Always positive. Direction is implied by `type`, so one movement has one
	-- representation rather than two.
	lamports bigint not null check (lamports > 0),

	from_address text not null,
	to_address text not null,

	commitment_id uuid references public.commitments (id) on delete set null,
	charity_id uuid,

	-- Unique, and the whole reason a retried request cannot move money twice.
	idempotency_key text not null unique,

	solana_signature text,
	failure_reason text,

	created_at timestamptz not null default now(),
	completed_at timestamptz
);

create index wallet_transactions_wallet_idx
	on public.wallet_transactions (wallet_id, created_at desc);

create index wallet_transactions_commitment_idx
	on public.wallet_transactions (commitment_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.wallets enable row level security;
alter table public.platform_wallet enable row level security;
alter table public.wallet_transactions enable row level security;

-- A user may see that their own wallet exists and what its address is. That is
-- all. Another user's address is never disclosed: the product's privacy rule is
-- that buyers and sellers transact without learning each other's payment
-- details, and a Solana address is exactly such a detail.
create policy "A user can see their own wallet"
	on public.wallets for select
	using (profile_id = (select auth.uid()));

-- No insert, update or delete policy. Wallets are created and modified only by
-- the Edge Functions, which use the service role and bypass RLS. There is no
-- path from a browser that writes this table.

-- The platform wallet has NO policy at all, deliberately. With RLS enabled and
-- no policy, every ordinary role is denied everything. Only the service role
-- can see it, which is correct: it holds everyone's stakes.

create policy "A user can see transactions for their own wallet"
	on public.wallet_transactions for select
	using (
		exists (
			select 1 from public.wallets w
			where w.id = wallet_id and w.profile_id = (select auth.uid())
		)
	);

-- ----------------------------------------------------------------------------
-- Grants — the part that actually protects the keys
-- ----------------------------------------------------------------------------
-- RLS decides which ROWS a role may read; it cannot decide which COLUMNS. The
-- policy above lets a user read their own wallet row, and without the grant
-- below that row would include the encrypted secret key.
--
-- Encrypted is not the same as safe to publish: handing out ciphertext invites
-- offline attack, and the encryption key is a single Edge Function secret away.
-- So the column is simply not selectable by any role the browser can reach.
revoke all on public.wallets from anon, authenticated;
grant select (id, profile_id, charity_id, solana_address, created_at, updated_at)
	on public.wallets to authenticated;

-- Nothing at all for the platform wallet.
revoke all on public.platform_wallet from anon, authenticated;

revoke all on public.wallet_transactions from anon, authenticated;
grant select (
	id, wallet_id, type, status, lamports, from_address, to_address,
	commitment_id, charity_id, solana_signature, created_at, completed_at
) on public.wallet_transactions to authenticated;
