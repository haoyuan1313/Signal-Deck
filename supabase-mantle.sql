-- ============================================================================
-- SignalDeck — Mantle Integration Migration
-- Run in Supabase SQL Editor (https://supabase.com/dashboard)
-- ============================================================================

-- 1. Extend trades table with Mantle columns ────────────────────────────────

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS mantle_tx_hash text,
  ADD COLUMN IF NOT EXISTS is_on_chain boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS mantle_block bigint,
  ADD COLUMN IF NOT EXISTS mantle_logged_at timestamptz;

-- Index for quick tx hash lookups
CREATE INDEX IF NOT EXISTS idx_trades_mantle_tx_hash
  ON trades (mantle_tx_hash)
  WHERE mantle_tx_hash IS NOT NULL;

-- 2. Agent Identity table (ERC-8004 NFT tracking) ───────────────────────────

CREATE TABLE IF NOT EXISTS agent_identity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  text UNIQUE NOT NULL,
  token_id        text,
  nft_name        text,
  strategy        text,
  network         text,
  chain_id        integer,
  mint_tx_hash    text,
  minted_at       timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- 3. Mantle configuration table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mantle_config (
  id                uuid PRIMARY KEY,
  wallet_address    text,
  is_connected      boolean DEFAULT false,
  network           text,
  chain_id          integer,
  is_testnet        boolean DEFAULT true,
  last_connected_at timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Seed the singleton row (shared across all users — single-user system)
INSERT INTO mantle_config (id, is_connected, is_testnet)
VALUES ('00000000-0000-0000-0000-000000000002', false, true)
ON CONFLICT (id) DO NOTHING;

-- 4. RLS — permissive single-user policies ──────────────────────────────────

ALTER TABLE agent_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE mantle_config   ENABLE ROW LEVEL SECURITY;

-- Public read for all authenticated operations
CREATE POLICY "allow_all_select" ON agent_identity FOR SELECT USING (true);
CREATE POLICY "allow_all_insert" ON agent_identity FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_all_update" ON agent_identity FOR UPDATE USING (true);
CREATE POLICY "allow_all_delete" ON agent_identity FOR DELETE USING (true);

CREATE POLICY "allow_all_select" ON mantle_config FOR SELECT USING (true);
CREATE POLICY "allow_all_insert" ON mantle_config FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_all_update" ON mantle_config FOR UPDATE USING (true);
CREATE POLICY "allow_all_delete" ON mantle_config FOR DELETE USING (true);

-- 5. Notify PostgREST to reload its schema cache ────────────────────────────

NOTIFY pgrst, 'reload schema';
