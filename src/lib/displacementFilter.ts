// ── Displacement Impulse Filter v1 — candle-based detection ────────────────────

import { type OHLCV, calcATR } from './strategy';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DisplacementFilterSettings {
  enableDisplacementFilter: boolean;
  minDisplacementBodyATR: number;   // candle body must be >= N × ATR
  minImpulseRangeATR: number;       // candle range (high-low) must be >= N × average range
  requireDirectionalClose: boolean; // close must be in trade direction (e.g. bearish close for short)
  requireHTFAlignment: boolean;     // 1H trend must align with displacement direction
  allowedDisplacementSessions: string[]; // empty = all sessions allowed
}

export const DEFAULT_DISPLACEMENT_FILTER: DisplacementFilterSettings = {
  enableDisplacementFilter: false,
  minDisplacementBodyATR: 1.2,     // body ≥ 1.2 × ATR (matches strategy FVG body check)
  minImpulseRangeATR: 1.5,         // range ≥ 1.5 × avg range
  requireDirectionalClose: true,
  requireHTFAlignment: false,       // default off — can be too restrictive
  allowedDisplacementSessions: [],  // empty = all
};

export interface DisplacementCheckResult {
  passed: boolean;
  reason: string;
  bodyATR: number;          // body / ATR
  rangeExpansion: number;   // candle range / avg range
  directionMatch: boolean;
  htfAligned: boolean;
}

// ── Detection engine ───────────────────────────────────────────────────────────

/**
 * Check whether a specific candle qualifies as a displacement impulse.
 *
 * @param candles   Recent OHLCV candles (≥50 for reliable ATR). Last candle is the signal bar.
 * @param direction The trade direction being considered
 * @param htfTrend  1H trend: 'bullish', 'bearish', or null if unknown
 * @param settings  Filter configuration
 * @param session   UTC session name for session filtering
 */
export function checkDisplacementImpulse(
  candles: OHLCV[],
  direction: 'long' | 'short',
  htfTrend: 'bullish' | 'bearish' | null,
  settings: DisplacementFilterSettings,
  session?: string,
): DisplacementCheckResult {
  if (!settings.enableDisplacementFilter) {
    return { passed: true, reason: 'filter disabled', bodyATR: 0, rangeExpansion: 0, directionMatch: true, htfAligned: true };
  }

  if (candles.length < 20) {
    return { passed: false, reason: 'insufficient candles', bodyATR: 0, rangeExpansion: 0, directionMatch: false, htfAligned: false };
  }

  // Session filter
  if (settings.allowedDisplacementSessions.length > 0 && session && !settings.allowedDisplacementSessions.includes(session)) {
    return { passed: false, reason: `session ${session} not allowed`, bodyATR: 0, rangeExpansion: 0, directionMatch: false, htfAligned: false };
  }

  const signalBar = candles[candles.length - 1]; // most recent closed candle
  const atr = calcATR(candles, 14);
  if (!atr || atr <= 0) {
    return { passed: false, reason: 'ATR unavailable', bodyATR: 0, rangeExpansion: 0, directionMatch: false, htfAligned: false };
  }

  // ── 1. Body size check ─────────────────────────────────────────────────────
  const body = Math.abs(signalBar.close - signalBar.open);
  const bodyATR = body / atr;

  if (bodyATR < settings.minDisplacementBodyATR) {
    return { passed: false, reason: `body ${bodyATR.toFixed(2)}×ATR < min ${settings.minDisplacementBodyATR}`, bodyATR: Math.round(bodyATR * 100) / 100, rangeExpansion: 0, directionMatch: false, htfAligned: false };
  }

  // ── 2. Range expansion check ────────────────────────────────────────────────
  const candleRange = signalBar.high - signalBar.low;
  // Average range over last 10 bars (excluding current)
  const recentBars = candles.slice(Math.max(0, candles.length - 11), candles.length - 1);
  const avgRange = recentBars.length > 0
    ? recentBars.reduce((s, c) => s + (c.high - c.low), 0) / recentBars.length
    : candleRange;
  const rangeExpansion = avgRange > 0 ? candleRange / avgRange : 1;

  if (rangeExpansion < settings.minImpulseRangeATR) {
    return { passed: false, reason: `range ${rangeExpansion.toFixed(2)}× < min ${settings.minImpulseRangeATR}`, bodyATR: Math.round(bodyATR * 100) / 100, rangeExpansion: Math.round(rangeExpansion * 100) / 100, directionMatch: false, htfAligned: false };
  }

  // ── 3. Directional close check ──────────────────────────────────────────────
  let directionMatch = true;
  if (settings.requireDirectionalClose) {
    if (direction === 'long') {
      directionMatch = signalBar.close > signalBar.open; // bullish close
    } else {
      directionMatch = signalBar.close < signalBar.open; // bearish close
    }
    if (!directionMatch) {
      return { passed: false, reason: `close direction mismatch: ${direction} but close ${signalBar.close > signalBar.open ? 'bullish' : 'bearish'}`, bodyATR: Math.round(bodyATR * 100) / 100, rangeExpansion: Math.round(rangeExpansion * 100) / 100, directionMatch: false, htfAligned: false };
    }
  }

  // ── 4. HTF alignment check ──────────────────────────────────────────────────
  let htfAligned = true;
  if (settings.requireHTFAlignment && htfTrend) {
    htfAligned = (direction === 'long' && htfTrend === 'bullish') || (direction === 'short' && htfTrend === 'bearish');
    if (!htfAligned) {
      return { passed: false, reason: `HTF misalignment: ${direction} vs ${htfTrend} trend`, bodyATR: Math.round(bodyATR * 100) / 100, rangeExpansion: Math.round(rangeExpansion * 100) / 100, directionMatch: true, htfAligned: false };
    }
  }

  return {
    passed: true,
    reason: 'displacement impulse confirmed',
    bodyATR: Math.round(bodyATR * 100) / 100,
    rangeExpansion: Math.round(rangeExpansion * 100) / 100,
    directionMatch,
    htfAligned,
  };
}

/**
 * Convenience: check displacement from Candle interface (used by backtester).
 */
export interface CandleLike {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
  volume?: number;
}

export function checkDisplacementFromCandles(
  candles: CandleLike[],
  direction: 'long' | 'short',
  htfTrend: 'bullish' | 'bearish' | null,
  settings: DisplacementFilterSettings,
  session?: string,
): DisplacementCheckResult {
  const ohlcv: OHLCV[] = candles.map(c => ({
    time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0,
  }));
  return checkDisplacementImpulse(ohlcv, direction, htfTrend, settings, session);
}

/**
 * Create a conservative default preset matching research findings.
 */
export const DISPLACEMENT_CONSERVATIVE_PRESET: DisplacementFilterSettings = {
  enableDisplacementFilter: true,
  minDisplacementBodyATR: 1.2,
  minImpulseRangeATR: 1.5,
  requireDirectionalClose: true,
  requireHTFAlignment: false,
  allowedDisplacementSessions: [],
};
