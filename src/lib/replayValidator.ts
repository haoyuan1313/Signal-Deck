import { Candle, Trade as BacktestTrade, TRAIL_LEVELS } from './backtester';
import { detectSMCSetup, OHLCV, StrategySetup, SMCOptions, getUTCSession, calcATR } from './strategy';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReplayComparison {
  tradeId: string;
  symbol: string;
  openedAt: string;
  closedAt: string | null;

  // Signal comparison
  signal: {
    liveDirection: string;
    replayDirection: string | null;
    signalMatched: boolean;
    replayReason: string;
    barIndex: number;
  };

  // Entry comparison
  entry: {
    livePrice: number;
    replayPrice: number;
    delta: number;
    deltaPct: number;
  };

  // Stop comparison
  stop: {
    liveSl: number;
    replaySl: number;
    liveTp: number;
    replayTp: number;
    slDeltaPct: number;
    tpDeltaPct: number;
  };

  // Exit comparison
  exit: {
    liveExitPrice: number | null;
    replayExitPrice: number | null;
    liveExitReason: string;
    replayExitReason: string;
    exitReasonMatched: boolean;
    exitPriceDeltaPct: number;
  };

  // R comparison
  r: {
    liveR: number;
    replayR: number;
    delta: number;
  };

  // Trail updates
  trail: {
    liveUpdates: number;       // number of SL adjustments in live trade
    replayUpdates: number;     // number of SL adjustments in replay
    matchedUpdates: number;
  };

  // Flags
  flags: ValidationFlag[];

  // Metrics
  accuracyScore: number;       // 0–100 overall accuracy
  executionDrift: number;      // average price drift live vs replay
}

export interface ValidationFlag {
  severity: 'low' | 'medium' | 'high';
  type: 'slippage' | 'missed_exit' | 'delayed_stop' | 'entry_diff' | 'tp_diff' | 'signal_diff' | 'anomaly';
  message: string;
}

export interface ReplayDashboard {
  tradesAnalyzed: number;
  avgAccuracy: number;
  avgExecutionDrift: number;
  liveExpectancy: number;       // avg R per live trade
  replayExpectancy: number;     // avg R per replay trade
  flagsByType: Record<string, number>;
  comparisons: ReplayComparison[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HARD_TIMEOUT_MINUTES = 150;
const STAGNATION_MINUTES = 75;
const STAGNATION_R_THRESHOLD = 0.5;
const SIGNAL_LOOKBACK_BARS = 10; // bars before trade open to scan for signal

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
  },
  candles: Candle[],
  rr: number = 2.0,
): Promise<ReplayComparison> {
  const flags: ValidationFlag[] = [];

  // ── 1. Find the signal bar ──────────────────────────────────────────────────
  const openTime = new Date(trade.opened_at).getTime();
  let signalBarIndex = -1;

  // The signal bar is the bar whose close time is just before the trade opened
  // Trade opens at bar i's close, so signal is detected at the bar before entry
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time >= openTime) {
      signalBarIndex = i - 1;
      break;
    }
  }
  if (signalBarIndex < 300) {
    signalBarIndex = Math.max(300, candles.findIndex(c => c.time >= openTime) - 1);
  }

  let replaySetup: StrategySetup | null = null;
  let replayReason = 'no_setup_found';
  let signalMatched = false;

  if (signalBarIndex >= 300 && signalBarIndex < candles.length) {
    const barTime = new Date(candles[signalBarIndex].time);

    // Build HTF candles from LTF data up to the signal bar
    const htf1h = buildHTF(candles, signalBarIndex, 12);
    const htf4h = buildHTF(candles, signalBarIndex, 48);

    const smc: SMCOptions = {
      rr: 2.0,
      atrPeriod: 14,
      allowedSessions: ['asian', 'london', 'ny_am', 'ny_pm', 'late'],
      require4hAlign: false, // disable for replay comparison
      currentTimeUTC: barTime,
    };

    const ltf = candles.slice(Math.max(0, signalBarIndex - 499), signalBarIndex + 1);

    const setup = detectSMCSetup(ltf, htf1h, htf4h, smc);
    if (setup.reason === 'accepted' && setup.direction) {
      replaySetup = setup;
      replayReason = 'accepted';
      signalMatched = replaySetup.direction === trade.direction;
    } else {
      replayReason = setup.reason;
    }
  }

  // ── 2. Simulate trade management candle-by-candle ────────────────────────────
  const entryBarIndex = signalMatched ? signalBarIndex + 1 : signalBarIndex;
  const entryPrice = candles[Math.min(entryBarIndex, candles.length - 1)]?.open || trade.entry;

  const replaySl = replaySetup?.sl ?? trade.sl_init;
  const replayTp = replaySetup?.tp ?? trade.tp;
  const risk = Math.abs(entryPrice - replaySl) || 1;

  let currentSl = replaySl;
  let hitBE = false;
  let trailUpdates = 0;
  let replayExitPrice: number | null = null;
  let replayExitReason = 'open';
  let pendingSl: number | null = null;

  for (let j = entryBarIndex + 1; j < candles.length; j++) {
    const candle = candles[j];
    const elapsedMins = (candle.time - candles[entryBarIndex].time) / 60000;
    const currentProfitR = trade.direction === 'long'
      ? (candle.close - entryPrice) / risk
      : (entryPrice - candle.close) / risk;

    // Apply pending SL from previous bar
    if (pendingSl !== null) {
      if (trade.direction === 'long' && pendingSl > currentSl) currentSl = pendingSl;
      if (trade.direction === 'short' && pendingSl < currentSl) currentSl = pendingSl;
      pendingSl = null;
    }

    // Trailing stop
    for (const level of TRAIL_LEVELS) {
      if (currentProfitR >= level.atR) {
        const trailPrice = trade.direction === 'long'
          ? entryPrice + risk * level.lockR
          : entryPrice - risk * level.lockR;
        const improved = trade.direction === 'long' ? trailPrice > currentSl : trailPrice < currentSl;
        if (improved) {
          pendingSl = trailPrice;
          trailUpdates++;
        }
      }
    }

    // Break-even
    if (!hitBE && currentProfitR >= 1.0) {
      const improved = trade.direction === 'long' ? entryPrice > currentSl : entryPrice < currentSl;
      if (improved) {
        pendingSl = entryPrice;
        hitBE = true;
        trailUpdates++;
      }
    }

    // Hard timeout
    if (elapsedMins >= HARD_TIMEOUT_MINUTES) {
      replayExitPrice = candle.close;
      replayExitReason = 'Time Expiry';
      break;
    }

    // Stagnation
    if (elapsedMins >= STAGNATION_MINUTES && currentProfitR < STAGNATION_R_THRESHOLD) {
      replayExitPrice = candle.close;
      replayExitReason = 'Stagnation';
      break;
    }

    // SL/TP
    if (trade.direction === 'long') {
      if (candle.low <= currentSl) {
        replayExitPrice = currentSl;
        replayExitReason = hitBE ? 'BE' : 'SL';
        break;
      }
      if (candle.high >= replayTp) {
        replayExitPrice = replayTp;
        replayExitReason = 'TP';
        break;
      }
    } else {
      if (candle.high >= currentSl) {
        replayExitPrice = currentSl;
        replayExitReason = hitBE ? 'BE' : 'SL';
        break;
      }
      if (candle.low <= replayTp) {
        replayExitPrice = replayTp;
        replayExitReason = 'TP';
        break;
      }
    }

    // Apply pending SL at end of bar
    if (pendingSl !== null) {
      if (trade.direction === 'long' && pendingSl > currentSl) currentSl = pendingSl;
      if (trade.direction === 'short' && pendingSl < currentSl) currentSl = pendingSl;
      pendingSl = null;
    }
  }

  // ── 3. Compute R values ─────────────────────────────────────────────────────
  const replayR = replayExitPrice !== null
    ? trade.direction === 'long'
      ? (replayExitPrice - entryPrice) / risk
      : (entryPrice - replayExitPrice) / risk
    : 0;

  const liveR = trade.r ?? 0;

  // ── 4. Compute comparisons ──────────────────────────────────────────────────
  const entryDelta = entryPrice - trade.entry;
  const entryDeltaPct = (Math.abs(entryDelta) / trade.entry) * 100;

  const slDeltaPct = (Math.abs(replaySl - trade.sl_init) / trade.sl_init) * 100;
  const tpDeltaPct = (Math.abs(replayTp - trade.tp) / trade.tp) * 100;

  let exitPriceDeltaPct = 0;
  if (replayExitPrice && trade.exit_price) {
    exitPriceDeltaPct = (Math.abs(replayExitPrice - trade.exit_price) / trade.exit_price) * 100;
  }

  const exitReasonMatched = normalizeExitReason(replayExitReason) === normalizeExitReason(
    liveR > 0.5 ? 'TP' : liveR < -0.5 ? 'SL' : liveR === 0 ? 'BE' : 'Stagnation'
  );

  // ── 5. Generate flags ───────────────────────────────────────────────────────
  if (entryDeltaPct > 0.5) {
    flags.push({ severity: 'high', type: 'entry_diff', message: `Entry price differs by ${entryDeltaPct.toFixed(2)}% (live: ${trade.entry}, replay: ${entryPrice})` });
  } else if (entryDeltaPct > 0.1) {
    flags.push({ severity: 'medium', type: 'slippage', message: `Entry drift ${entryDeltaPct.toFixed(2)}%` });
  }

  if (tpDeltaPct > 2) {
    flags.push({ severity: 'medium', type: 'tp_diff', message: `TP differs by ${tpDeltaPct.toFixed(1)}% (live: ${trade.tp}, replay: ${replayTp})` });
  }

  if (!signalMatched && replayReason !== 'no_setup_found') {
    flags.push({ severity: 'medium', type: 'signal_diff', message: `Signal mismatch: live ${trade.direction}, replay ${replaySetup?.direction || 'none'} (${replayReason})` });
  }

  if (!exitReasonMatched) {
    flags.push({ severity: 'medium', type: 'missed_exit', message: `Exit reason mismatch: replay ${replayExitReason} vs live` });
  }

  if (trade.be_armed && !hitBE) {
    flags.push({ severity: 'high', type: 'delayed_stop', message: 'Live trade reached BE but replay did not — trailing stop may be delayed in live' });
  }

  if (Math.abs(liveR - replayR) > 0.5) {
    flags.push({ severity: 'high', type: 'anomaly', message: `R divergence: live ${liveR.toFixed(2)}R vs replay ${replayR.toFixed(2)}R` });
  }

  // ── 6. Accuracy score ───────────────────────────────────────────────────────
  let score = 100;
  if (!signalMatched) score -= 20;
  score -= Math.min(20, entryDeltaPct * 40);       // 0.5% drift = -20
  score -= Math.min(10, tpDeltaPct * 5);            // 2% tp diff = -10
  if (!exitReasonMatched) score -= 15;
  score -= Math.min(15, Math.abs(liveR - replayR) * 15); // 1R diff = -15
  score -= flags.length * 3;
  const accuracyScore = Math.max(0, Math.round(score));

  // ── 7. Execution drift ──────────────────────────────────────────────────────
  const executionDrift = (entryDeltaPct + (exitPriceDeltaPct || 0)) / 2;

  return {
    tradeId: trade.id,
    symbol: trade.symbol,
    openedAt: trade.opened_at,
    closedAt: trade.closed_at,

    signal: {
      liveDirection: trade.direction,
      replayDirection: replaySetup?.direction || null,
      signalMatched,
      replayReason,
      barIndex: signalBarIndex,
    },

    entry: {
      livePrice: trade.entry,
      replayPrice: entryPrice,
      delta: entryDelta,
      deltaPct: Math.round(entryDeltaPct * 100) / 100,
    },

    stop: {
      liveSl: trade.sl_init,
      replaySl,
      liveTp: trade.tp,
      replayTp,
      slDeltaPct: Math.round(slDeltaPct * 100) / 100,
      tpDeltaPct: Math.round(tpDeltaPct * 100) / 100,
    },

    exit: {
      liveExitPrice: trade.exit_price,
      replayExitPrice,
      liveExitReason: liveR > 0.5 ? 'TP' : liveR < -0.5 ? 'SL' : liveR === 0 ? 'BE' : 'Other',
      replayExitReason,
      exitReasonMatched,
      exitPriceDeltaPct: Math.round(exitPriceDeltaPct * 100) / 100,
    },

    r: {
      liveR,
      replayR: Math.round(replayR * 100) / 100,
      delta: Math.round((liveR - replayR) * 100) / 100,
    },

    trail: {
      liveUpdates: trade.be_armed ? 1 : 0,
      replayUpdates: trailUpdates,
      matchedUpdates: trade.be_armed && hitBE ? 1 : 0,
    },

    flags,
    accuracyScore,
    executionDrift: Math.round(executionDrift * 100) / 100,
  };
}

// ── Dashboard aggregator ───────────────────────────────────────────────────────

export function buildDashboard(comparisons: ReplayComparison[]): ReplayDashboard {
  const valid = comparisons.filter(c => c.exit.replayExitReason !== 'open');
  const total = valid.length;

  if (total === 0) {
    return {
      tradesAnalyzed: 0, avgAccuracy: 0, avgExecutionDrift: 0,
      liveExpectancy: 0, replayExpectancy: 0, flagsByType: {}, comparisons: [],
    };
  }

  const avgAccuracy = valid.reduce((s, c) => s + c.accuracyScore, 0) / total;
  const avgExecutionDrift = valid.reduce((s, c) => s + c.executionDrift, 0) / total;
  const liveExpectancy = valid.reduce((s, c) => s + c.r.liveR, 0) / total;
  const replayExpectancy = valid.reduce((s, c) => s + c.r.replayR, 0) / total;

  const flagsByType: Record<string, number> = {};
  for (const c of valid) {
    for (const f of c.flags) {
      flagsByType[f.type] = (flagsByType[f.type] || 0) + 1;
    }
  }

  return {
    tradesAnalyzed: total,
    avgAccuracy: Math.round(avgAccuracy * 10) / 10,
    avgExecutionDrift: Math.round(avgExecutionDrift * 100) / 100,
    liveExpectancy: Math.round(liveExpectancy * 100) / 100,
    replayExpectancy: Math.round(replayExpectancy * 100) / 100,
    flagsByType,
    comparisons: valid,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildHTF(candles: Candle[], currentIndex: number, interval: number): OHLCV[] {
  const result: OHLCV[] = [];
  for (let i = interval - 1; i <= currentIndex; i += interval) {
    const chunk = candles.slice(i - interval + 1, i + 1);
    if (!chunk.length) continue;
    result.push({
      time: chunk[0].time,
      open: chunk[0].open,
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
  if (reason.startsWith('SL') || reason === 'StopLoss' || reason === 'SL') return 'SL';
  if (reason === 'BE') return 'BE';
  if (reason.startsWith('Time')) return 'Timeout';
  if (reason.startsWith('Stag')) return 'Stagnation';
  return reason;
}
