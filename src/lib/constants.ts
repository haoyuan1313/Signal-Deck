// ─── Shared Bot Constants ─────────────────────────────────────────────────────
// Single source of truth for values used by both botEngine.ts and the frontend.

/** Supabase row ID for the singleton bot_settings record. */
export const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

/** Maximum number of concurrently open positions. New signals are skipped when
 *  this limit is reached, regardless of how good the setup looks. */
export const MAX_OPEN_POSITIONS = 3;

/** Daily loss circuit-breaker threshold as a percentage of account equity.
 *  When today's realised losses exceed this value the bot pauses itself and
 *  sends a Telegram alert.  e.g. 3.0 → halt at −3 % daily drawdown. */
export const DAILY_LOSS_HALT_PCT = 3.0;

// ─── Mantle Network Constants ──────────────────────────────────────────────────

export const MANTLE_CHAIN_ID = 5000;
export const MANTLE_RPC = 'https://rpc.mantle.xyz';
export const MANTLE_EXPLORER = 'https://explorer.mantle.xyz';

/** ERC-8004 agent identity NFT contract — TBD, fill in official address */
export const ERC8004_ADDRESS = 'TBD';
