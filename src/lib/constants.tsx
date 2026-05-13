// ─── Shared Bot Constants ─────────────────────────────────────────────────────
// Single source of truth for values used by botEngine.ts, server.ts, and the
// frontend store.  All must agree on the same UUID.

/**
 * Supabase row ID for the singleton bot_settings / bot_heartbeat records.
 * This value is also hardcoded in supabase.sql seed statements — if you change
 * it here you must update the SQL as well.
 */
export const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Maximum number of concurrently open positions per user.
 * New signals are skipped when this limit is reached.
 */
export const MAX_OPEN_POSITIONS = 3;

/**
 * Daily loss circuit-breaker threshold as a percentage of account equity.
 * When today's realised losses exceed this value the bot halts new entries
 * and sends a Telegram alert.  e.g. 3.0 → halt at −3% daily drawdown.
 */
export const DAILY_LOSS_HALT_PCT = 3.0;