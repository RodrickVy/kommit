-- ============================================================================
-- market_settings.sol_price_cents
-- ============================================================================
-- How many cents of `currency_code` one SOL is worth, for DISPLAY ONLY.
--
-- A configured number rather than a live price feed, which is what the
-- specification asks for. The consequence is worth stating plainly: it goes
-- stale, and the dollar figure shown beside a balance is an approximation an
-- admin last agreed to, not a quote anyone can transact at.
--
-- That is acceptable because nothing is PRICED from this. Balances are held
-- and moved in lamports, and every transfer is denominated on-chain. This
-- value only answers "roughly how much is that in dollars" for a human
-- reading a screen. If it is ever used to decide an amount to move, it must
-- become a real rate with a recorded timestamp first.
alter table public.market_settings
	add column sol_price_cents bigint not null default 25000
		check (sol_price_cents > 0);

comment on column public.market_settings.sol_price_cents is
	'Cents per 1 SOL, in currency_code. Display only — never used to decide a transfer amount.';

-- Readable by the browser so the UI can show the conversion without a round
-- trip to an Edge Function. It is not sensitive.
grant select (sol_price_cents) on public.market_settings to anon, authenticated;
