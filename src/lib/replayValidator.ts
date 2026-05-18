import { Candle, TRAIL_LEVELS } from './backtester';
import { detectSMCSetup, OHLCV, StrategySetup, SMCOptions } from './strategy';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DebugInfo {
  liveOpenedAt: string;
  signalCandleTime: string;
  candleTimeDeltaSec: number;
  resolvedSymbol: string;
  candleCount: number;
  signalBarIndex: number;
  entryBarIndex: number;
  barsAroundSignal: { index: number; time: string; open: number; close: number }[];
}

export interface ReplayComparison {
  tradeId: string;
  symbol: string;
  openedAt: string;
  closedAt: string | null;
  isPaper: boolean;
  exclusionReason: string | null; // null = valid, non-null = excluded from metrics
  debug: DebugInfo;

  signal: {
    liveDirection: string;
    replayDirection: string | null;
    signalMatched: boolean;
    replayReason: string;
    barIndex: number;
    bestSetupIndex: number;
    bestSetupPrice: number;
  };

  entry: {
    livePrice: number;
    replayPrice: number;
    delta: number;
    deltaPct: number;
  };

  stop: {
    liveSl: number;
    replaySl: number;
    liveTp: number;
    replayTp: number;
    slDeltaPct: number;
    tpDeltaPct: number;
  };

  exit: {
    liveExitPrice: number | null;
    replayExitPrice: number | null;
    liveExitReason: string;
    replayExitReason: string;
    exitReasonMatched: boolean;
    exitPriceDeltaPct: number;
  };

  r: {
    liveR: number;
    replayR: number;
    delta: number;
  };

  trail: {
    liveUpdates: number;
    replayUpdates: number;
    matchedUpdates: number;
  };

  flags: ValidationFlag[];
  accuracyScore: number;
  executionDrift: number;
}

export interface ValidationFlag {
  severity: 'low' | 'medium' | 'high';
  category: 'strategy_mismatch' | 'execution_drift' | 'replay_data_bug' | 'missing_candle_data' | 'stale_or_wrong_market_data';
  message: string;
}

export interface ReplayDashboard {
  // All trades
  tradesAnalyzed: number;

  // Valid trades only
  validComparisons: ReplayComparison[];
  validCount: number;
  avgAccuracy: number;
  avgExecutionDrift: number;
  liveExpectancy: number;
  replayExpectancy: number;
  flagsByCategory: Record<string, number>;

  // Excluded trades
  excludedComparisons: ReplayComparison[];
  excludedCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HARD_TIMEOUT_MINUTES = 150;
const STAGNATION_MINUTES = 75;
const STAGNATION_R_THRESHOLD = 0.5;
const FIVE_MIN_MS = 5 * 60 * 1000;
const NINETY_MIN_MS = 90 * 60 * 1000;
const ENTRY_CANDLE_RANGE_PCT = 2.0; // ±2% from nearby candle high/low is acceptable

// ── Data sanity pre-check ──────────────────────────────────────────────────────

function checkDataSanity(
  trade: { entry: number; opened_at: string },
  candles: Candle[],
): { ok: boolean; reason: string } {
  const openedAtMs = new Date(trade.opened_at).getTime();
  const roundedOpenMs = Math.floor(openedAtMs / FIVE_MIN_MS) * FIVE_MIN_MS;

  // Find the candle covering the entry time
  let entryCandleIndex = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].time === roundedOpenMs) {
      entryCandleIndex = i;
      break;
    }
  }
  if (entryCandleIndex < 0) {
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].time >= roundedOpenMs) {
        entryCandleIndex = i;
        break;
      }
    }
  }

  if (entryCandleIndex < 0) {
    return { ok: false, reason: 'No candle found at or after entry time' };
  }

  // Check entry price against nearby candles (±2 bars)
  const nearbyStart = Math.max(0, entryCandleIndex - 2);
  const nearbyEnd = Math.min(candles.length - 1, entryCandleIndex + 2);
  let nearbyHigh = -Infinity;
  let nearbyLow = Infinity;
  for (let j = nearbyStart; j <= nearbyEnd; j++) {
    if (candles[j].high > nearbyHigh) nearbyHigh = candles[j].high;
    if (candles[j].low < nearbyLow) nearbyLow = candles[j].low;
  }

  const entryWithinRange =
    trade.entry >= nearbyLow * (1 - ENTRY_CANDLE_RANGE_PCT / 100) &&
    trade.entry <= nearbyHigh * (1 + ENTRY_CANDLE_RANGE_PCT / 100);

  if (!entryWithinRange) {
    return {
      ok: false,
      reason: `Entry $${trade.entry.toFixed(2)} outside candle range $${nearbyLow.toFixed(2)}–$${nearbyHigh.toFixed(2)} (±2%). Likely testnet/synthetic trade vs different market data.`,
    };
  }

  return { ok: true, reason: '' };
}

// ── Core replay engine ─────────────────────────────────────────────────────────

export async function replayTrade(
  trade: {
    id: string;
    symbol: string;
    direction: string;
    entry: number;
    sl_init: number;
    sl: number;
    tp: number;
    exit_price: number | null;
    r: number | null;
    opened_at: string;
    closed_at: string | null;
    be_armed: boolean;
    is_paper?: boolean;
  },
  candles: Candle[],
  resolvedSymbol: string,
): Promise<ReplayComparison> {
  const flags: ValidationFlag[] = [];
  const isPaper = trade.is_paper ?? false;

  // ── Pre-check: data sanity ──────────────────────────────────────────────────
  const sanity = checkDataSanity(trade, candles);
  let exclusionReason: string | null = null;

  if (!sanity.ok) {
    exclusionReason = sanity.reason;
    flags.push({
      severity: 'high',
      category: 'stale_or_wrong_market_data',
      message: sanity.reason,
    });
  }

  // ── 0. Normalize timestamps to UTC 5m grid ──────────────────────────────────
  const openedAtMs = new Date(trade.opened_at).getTime();
  const roundedOpenMs = Math.floor(openedAtMs / FIVE_MIN_MS) * FIVE_MIN_MS;
  const candleTimeDeltaMs = openedAtMs - roundedOpenMs;

  // Find the candle covering the entry time
  let entryCandleIndex = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].time >= roundedOpenMs) {
      entryCandleIndex = i;
      break;
    }
  }
  if (entryCandleIndex < 0) entryCandleIndex = candles.length - 1;

  // ── 1. Signal search: ONLY bars before entry time ────────────────────────────
  // Signal must be detected on a candle that closes BEFORE the trade opened.
  // Search from opened_at - 90 min to the bar just before entry (inclusive).
  const searchEndBar = Math.max(300, entryCandleIndex - 1);
  const searchStartMs = openedAtMs - NINETY_MIN_MS;
  let searchStartBar = searchEndBar;
  for (let i = searchEndBar; i >= 300; i--) {
    if (candles[i].time < searchStartMs) { searchStartBar = i + 1; break; }
    searchStartBar = i;
  }
  searchStartBar = Math.max(300, searchStartBar);

  const barsAroundSignal: DebugInfo['barsAroundSignal'] = [];
  let bestSetup: StrategySetup | null = null;
  let bestSetupIndex = -1;
  let bestSetupPrice = 0;
  let bestDirectionMatch = false;
  let bestPriceDist = Infinity;

  for (let barIdx = searchStartBar; barIdx <= searchEndBar; barIdx++) {
    if (candles[barIdx].time >= openedAtMs) break; // never use a bar after trade opened

    const barTime = new Date(candles[barIdx].time);
    const htf1h = buildHTF(candles, barIdx, 12);
    const htf4h = buildHTF(candles, barIdx, 48);

    const smc: SMCOptions = {
      rr: 2.0, atrPeriod: 14,
      allowedSessions: ['asian', 'london', 'ny_am', 'ny_pm', 'late'],
      require4hAlign: false,
      currentTimeUTC: barTime,
    };

    const ltf = candles.slice(Math.max(0, barIdx - 499), barIdx + 1);
    const setup = detectSMCSetup(ltf, htf1h, htf4h, smc);

    // Log first and last few bars for debug
    if (barIdx === searchStartBar || barIdx === searchEndBar ||
        barIdx === searchStartBar + 1 || barIdx === searchEndBar - 1 ||
        (setup.reason === 'accepted' && setup.direction)) {
      barsAroundSignal.push({
        index: barIdx,
        time: new Date(candles[barIdx].time).toISOString(),
        open: candles[barIdx].open,
        close: candles[barIdx].close,
      });
    }

    if (setup.reason !== 'accepted' || !setup.direction) continue;
    if (!setup.price) continue;

    const dirMatch = setup.direction === trade.direction;
    const priceDist = Math.abs(setup.price - trade.entry) / trade.entry;

    if (bestSetup === null || (dirMatch && !bestDirectionMatch) ||
        (dirMatch === bestDirectionMatch && priceDist < bestPriceDist)) {
      bestSetup = setup;
      bestSetupIndex = barIdx;
      bestSetupPrice = setup.price;
      bestDirectionMatch = dirMatch;
      bestPriceDist = priceDist;
    }
  }

  // If no setup found in proper search range, still log the entry bar for debug
  if (barsAroundSignal.length === 0) {
    barsAroundSignal.push({
      index: entryCandleIndex,
      time: candles[Math.min(entryCandleIndex, candles.length - 1)]
        ? new Date(candles[Math.min(entryCandleIndex, candles.length - 1)].time).toISOString() : '?',
      open: candles[Math.min(entryCandleIndex, candles.length - 1)]?.open ?? 0,
      close: candles[Math.min(entryCandleIndex, candles.length - 1)]?.close ?? 0,
    });
  }

  const replaySignalBarIndex = bestSetup ? bestSetupIndex : Math.max(300, entryCandleIndex - 1);
  const signalMatched = bestSetup !== null && bestSetup.direction === trade.direction;

  // ── 2. Determine replay entry ───────────────────────────────────────────────
  const entryBarIndex = replaySignalBarIndex + 1;
  const entryCandle = candles[Math.min(entryBarIndex, candles.length - 1)];
  const replayEntryPrice = entryCandle?.open ?? trade.entry;

  const replaySl = bestSetup?.sl ?? trade.sl_init;
  const replayTp = bestSetup?.tp ?? trade.tp;
  const risk = Math.abs(replayEntryPrice - replaySl) || 1;

  // ── 3. Debug info ───────────────────────────────────────────────────────────
  const debug: DebugInfo = {
    liveOpenedAt: trade.opened_at,
    signalCandleTime: candles[replaySignalBarIndex]
      ? new Date(candles[replaySignalBarIndex].time).toISOString() : 'unknown',
    candleTimeDeltaSec: Math.round(candleTimeDeltaMs / 1000),
    resolvedSymbol,
    candleCount: candles.length,
    signalBarIndex: replaySignalBarIndex,
    entryBarIndex,
    barsAroundSignal,
  };

  // ── 4. Data quality checks ──────────────────────────────────────────────────
  if (candles.length < 300) {
    flags.push({ severity: 'high', category: 'missing_candle_data',
      message: `Only ${candles.length} candles available (need ≥300).` });
  }

  if (Math.abs(candleTimeDeltaMs) > FIVE_MIN_MS * 2) {
    flags.push({ severity: 'medium', category: 'replay_data_bug',
      message: `Trade opened_at (${trade.opened_at}) is ${(candleTimeDeltaMs / 1000).toFixed(0)}s from nearest 5m candle grid.` });
  }

  // ── 5. Simulate trade management (skip if excluded) ──────────────────────────
  let replayExitPrice: number | null = null;
  let replayExitReason = 'open';
  let hitBE = false;
  let trailUpdates = 0;
  let currentSl = replaySl;
  let pendingSl: number | null = null;

  if (!exclusionReason) {
    for (let j = entryBarIndex + 1; j < candles.length; j++) {
      const candle = candles[j];
      const elapsedMins = (candle.time - candles[entryBarIndex].time) / 60000;
      const currentProfitR = trade.direction === 'long'
        ? (candle.close - replayEntryPrice) / risk
        : (replayEntryPrice - candle.close) / risk;

      if (pendingSl !== null) {
        if (trade.direction === 'long' && pendingSl > currentSl) currentSl = pendingSl;
        if (trade.direction === 'short' && pendingSl < currentSl) currentSl = pendingSl;
        pendingSl = null;
      }

      for (const level of TRAIL_LEVELS) {
        if (currentProfitR >= level.atR) {
          const trailPrice = trade.direction === 'long'
            ? replayEntryPrice + risk * level.lockR
            : replayEntryPrice - risk * level.lockR;
          const improved = trade.direction === 'long' ? trailPrice > currentSl : trailPrice < currentSl;
          if (improved) { pendingSl = trailPrice; trailUpdates++; }
        }
      }

      if (!hitBE && currentProfitR >= 1.0) {
        const improved = trade.direction === 'long' ? replayEntryPrice > currentSl : replayEntryPrice < currentSl;
        if (improved) { pendingSl = replayEntryPrice; hitBE = true; trailUpdates++; }
      }

      if (elapsedMins >= HARD_TIMEOUT_MINUTES) {
        replayExitPrice = candle.close; replayExitReason = 'Time Expiry'; break;
      }
      if (elapsedMins >= STAGNATION_MINUTES && currentProfitR < STAGNATION_R_THRESHOLD) {
        replayExitPrice = candle.close; replayExitReason = 'Stagnation'; break;
      }

      if (trade.direction === 'long') {
        const slHit = candle.low <= currentSl;
        const tpHit = candle.high >= replayTp;
        if (slHit && tpHit) { replayExitPrice = currentSl; replayExitReason = hitBE ? 'BE' : 'SL'; break; }
        if (slHit) { replayExitPrice = currentSl; replayExitReason = hitBE ? 'BE' : 'SL'; break; }
        if (tpHit) { replayExitPrice = replayTp; replayExitReason = 'TP'; break; }
      } else {
        const slHit = candle.high >= currentSl;
        const tpHit = candle.low <= replayTp;
        if (slHit && tpHit) { replayExitPrice = currentSl; replayExitReason = hitBE ? 'BE' : 'SL'; break; }
        if (slHit) { replayExitPrice = currentSl; replayExitReason = hitBE ? 'BE' : 'SL'; break; }
        if (tpHit) { replayExitPrice = replayTp; replayExitReason = 'TP'; break; }
      }

      if (pendingSl !== null) {
        if (trade.direction === 'long' && pendingSl > currentSl) currentSl = pendingSl;
        if (trade.direction === 'short' && pendingSl < currentSl) currentSl = pendingSl;
        pendingSl = null;
      }
    }
  }

  // ── 6. Compute R values ─────────────────────────────────────────────────────
  const replayR = replayExitPrice !== null
    ? trade.direction === 'long'
      ? (replayExitPrice - replayEntryPrice) / risk
      : (replayEntryPrice - replayExitPrice) / risk
    : 0;
  const liveR = trade.r ?? 0;

  // ── 7. Compute comparisons ──────────────────────────────────────────────────
  const entryDelta = replayEntryPrice - trade.entry;
  const entryDeltaPct = trade.entry > 0 ? (Math.abs(entryDelta) / trade.entry) * 100 : 0;
  const slDeltaPct = trade.sl_init > 0 ? (Math.abs(replaySl - trade.sl_init) / trade.sl_init) * 100 : 0;
  const tpDeltaPct = trade.tp > 0 ? (Math.abs(replayTp - trade.tp) / trade.tp) * 100 : 0;

  let exitPriceDeltaPct = 0;
  if (replayExitPrice && trade.exit_price && trade.exit_price > 0) {
    exitPriceDeltaPct = (Math.abs(replayExitPrice - trade.exit_price) / trade.exit_price) * 100;
  }

  const replayExitNormalized = normalizeExitReason(replayExitReason);
  const liveExitNormalized = trade.r !== null
    ? (trade.r > 0.5 ? 'TP' : trade.r < -0.5 ? 'SL' : trade.r === 0 ? 'BE' : 'Stagnation') : 'open';
  const exitReasonMatched = replayExitNormalized === liveExitNormalized;

  // ── 8. Generate flags (only for non-excluded trades) ─────────────────────────
  if (!exclusionReason) {
    if (entryDeltaPct > 2.0) {
      flags.push({ severity: 'high', category: 'replay_data_bug',
        message: `Entry delta ${entryDeltaPct.toFixed(1)}% (>2%). Live: $${trade.entry.toFixed(2)}, Replay: $${replayEntryPrice.toFixed(2)}` });
    } else if (entryDeltaPct > 0.5) {
      flags.push({ severity: 'medium', category: 'execution_drift',
        message: `Entry drift ${entryDeltaPct.toFixed(2)}%.` });
    } else if (entryDeltaPct > 0.1) {
      flags.push({ severity: 'low', category: 'execution_drift',
        message: `Minor entry drift ${entryDeltaPct.toFixed(2)}%.` });
    }

    if (!signalMatched && bestSetup) {
      flags.push({ severity: 'medium', category: 'strategy_mismatch',
        message: `Direction mismatch: live ${trade.direction}, replay ${bestSetup.direction}` });
    }

    if (tpDeltaPct > 2) {
      flags.push({ severity: 'medium', category: 'strategy_mismatch',
        message: `TP differs by ${tpDeltaPct.toFixed(1)}%.` });
    }
    if (slDeltaPct > 2) {
      flags.push({ severity: 'medium', category: 'strategy_mismatch',
        message: `SL differs by ${slDeltaPct.toFixed(1)}%.` });
    }

    if (!exitReasonMatched && replayExitReason !== 'open') {
      flags.push({ severity: 'low', category: 'execution_drift',
        message: `Exit reason: replay ${replayExitReason} vs live ${liveExitNormalized}` });
    }

    if (trade.be_armed && !hitBE) {
      flags.push({ severity: 'medium', category: 'execution_drift',
        message: 'Live reached BE but replay did not.' });
    }

    if (Math.abs(liveR - replayR) > 0.5) {
      flags.push({ severity: 'high', category: 'execution_drift',
        message: `R divergence: live ${liveR.toFixed(2)}R vs replay ${replayR.toFixed(2)}R` });
    }
  }

  // ── 9. Accuracy score ───────────────────────────────────────────────────────
  let score = 100;
  if (exclusionReason) {
    score = 0; // excluded trades get 0 accuracy
  } else {
    if (!bestSetup) score -= 20;
    if (!signalMatched) score -= 15;
    if (entryDeltaPct > 2.0) score -= 30;
    else if (entryDeltaPct > 0.5) score -= Math.min(15, entryDeltaPct * 10);
    if (!exitReasonMatched) score -= 10;
    score -= Math.min(15, Math.abs(liveR - replayR) * 15);
  }
  const accuracyScore = Math.max(0, Math.round(score));

  return {
    tradeId: trade.id, symbol: trade.symbol,
    openedAt: trade.opened_at, closedAt: trade.closed_at,
    isPaper, exclusionReason, debug,

    signal: {
      liveDirection: trade.direction,
      replayDirection: bestSetup?.direction || null,
      signalMatched,
      replayReason: bestSetup?.reason || 'no_setup_found',
      barIndex: replaySignalBarIndex,
      bestSetupIndex,
      bestSetupPrice: Math.round(bestSetupPrice * 1000000) / 1000000,
    },

    entry: {
      livePrice: trade.entry,
      replayPrice: replayEntryPrice,
      delta: Math.round(entryDelta * 1000000) / 1000000,
      deltaPct: Math.round(entryDeltaPct * 100) / 100,
    },

    stop: {
      liveSl: trade.sl_init,
      replaySl: Math.round(replaySl * 1000000) / 1000000,
      liveTp: trade.tp,
      replayTp: Math.round(replayTp * 1000000) / 1000000,
      slDeltaPct: Math.round(slDeltaPct * 100) / 100,
      tpDeltaPct: Math.round(tpDeltaPct * 100) / 100,
    },

    exit: {
      liveExitPrice: trade.exit_price,
      replayExitPrice: replayExitPrice !== null ? Math.round(replayExitPrice * 1000000) / 1000000 : null,
      liveExitReason: liveExitNormalized,
      replayExitReason,
      exitReasonMatched,
      exitPriceDeltaPct: Math.round(exitPriceDeltaPct * 100) / 100,
    },

    r: {
      liveR, replayR: Math.round(replayR * 100) / 100,
      delta: Math.round((liveR - replayR) * 100) / 100,
    },

    trail: {
      liveUpdates: trade.be_armed ? 1 : 0,
      replayUpdates: trailUpdates,
      matchedUpdates: (trade.be_armed && hitBE) ? 1 : 0,
    },

    flags, accuracyScore,
    executionDrift: Math.round((entryDeltaPct + (exitPriceDeltaPct || 0)) / 2 * 100) / 100,
  };
}

// ── Dashboard aggregator ───────────────────────────────────────────────────────

export function buildDashboard(comparisons: ReplayComparison[]): ReplayDashboard {
  const valid = comparisons.filter(c => c.exclusionReason === null);
  const excluded = comparisons.filter(c => c.exclusionReason !== null);
  const total = comparisons.length;

  if (valid.length === 0) {
    return {
      tradesAnalyzed: total,
      validComparisons: [], validCount: 0,
      avgAccuracy: 0, avgExecutionDrift: 0,
      liveExpectancy: 0, replayExpectancy: 0, flagsByCategory: {},
      excludedComparisons: excluded, excludedCount: excluded.length,
    };
  }

  const avgAccuracy = valid.reduce((s, c) => s + c.accuracyScore, 0) / valid.length;
  const avgExecutionDrift = valid.reduce((s, c) => s + c.executionDrift, 0) / valid.length;
  const closed = valid.filter(c => c.r.liveR !== 0);
  const liveExpectancy = closed.length > 0
    ? closed.reduce((s, c) => s + c.r.liveR, 0) / closed.length : 0;
  const replayExpectancy = closed.length > 0
    ? closed.reduce((s, c) => s + c.r.replayR, 0) / closed.length : 0;

  const flagsByCategory: Record<string, number> = {};
  for (const c of valid) {
    for (const f of c.flags) {
      flagsByCategory[f.category] = (flagsByCategory[f.category] || 0) + 1;
    }
  }

  return {
    tradesAnalyzed: total,
    validComparisons: valid, validCount: valid.length,
    avgAccuracy: Math.round(avgAccuracy * 10) / 10,
    avgExecutionDrift: Math.round(avgExecutionDrift * 100) / 100,
    liveExpectancy: Math.round(liveExpectancy * 100) / 100,
    replayExpectancy: Math.round(replayExpectancy * 100) / 100,
    flagsByCategory,
    excludedComparisons: excluded, excludedCount: excluded.length,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildHTF(candles: Candle[], currentIndex: number, interval: number): OHLCV[] {
  const result: OHLCV[] = [];
  for (let i = interval - 1; i <= currentIndex; i += interval) {
    const chunk = candles.slice(i - interval + 1, i + 1);
    if (!chunk.length) continue;
    result.push({
      time: chunk[0].time, open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((acc, c) => acc + c.volume, 0),
    });
  }
  return result;
}

function normalizeExitReason(reason: string): string {
  if (reason.startsWith('TP')) return 'TP';
  if (reason.startsWith('SL')) return 'SL';
  if (reason === 'BE') return 'BE';
  if (reason.startsWith('Time')) return 'Timeout';
  if (reason.startsWith('Stag')) return 'Stagnation';
  return reason;
}
