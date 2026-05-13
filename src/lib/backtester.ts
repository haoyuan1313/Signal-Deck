import {
  OHLCV,
  detectSMCSetup,
  SMCOptions,
  getHTFTrend,
  getUTCSession,
  DEFAULT_ALLOWED_SESSIONS,
  TradingSession,
  MIN_RISK_ATR_MULTIPLE,
  MIN_RISK_PRICE_PERCENT,
} from './strategy';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  type: 'long' | 'short';
  entryTime: number;
  entryPrice: number;
  sl: number;
  tp: number;
  exitTime: number | null;
  exitPrice: number | null;
  result: 'win' | 'loss' | 'open';
  pnl: number;
  reason?: string;
  duration?: number; // minutes
  session?: string;
}

export interface BacktestResult {
  totalTrades: number;
  winRate: number;
  finalBalance: number;
  equityCurve: number[];
  trades: Trade[];
  actualBars?: number;
  profitFactor: number;
  maxConsecutiveLosses: number;
  avgDuration: number;
}

// ── Walk-forward result ───────────────────────────────────────────────────────

export interface WalkForwardWindow {
  windowIndex: number;
  inSampleBars: number;
  outSampleBars: number;
  inSample: BacktestResult;
  outSample: BacktestResult;
  stabilityScore: number; // out/in winRate ratio — 1.0 is perfect
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  avgStabilityScore: number;
  isRobust: boolean; // true if avgStability > 0.7
  summary: string;
}

// ── Constants (keep in sync with botEngine.ts) ────────────────────────────────
const HARD_TIMEOUT_MINUTES   = 150;
const STAGNATION_MINUTES     = 75;
const STAGNATION_R_THRESHOLD = 0.5;

// Mirror botEngine trailing stop levels exactly
const TRAIL_LEVELS = [
  { atR: 2.0, lockR: 1.0 },
  { atR: 3.0, lockR: 2.0 },
];

// ── Signal generator (used by BacktestPage for single-bar checks) ─────────────

export function generateSignal(data: Candle[], i: number, rr: number = 2.0): any {
  if (i < 50) return null;

  const ltf = data.slice(Math.max(0, i - 499), i + 1);

  const htf_candles: OHLCV[] = [];
  const lookback_1h = Math.min(100, Math.floor(i / 12));
  for (let k = i; k > i - lookback_1h * 12; k -= 12) {
    if (k < 11) break;
    const chunk = data.slice(k - 11, k + 1);
    htf_candles.unshift({
      time:   chunk[0].time,
      open:   chunk[0].open,
      high:   Math.max(...chunk.map(c => c.high)),
      low:    Math.min(...chunk.map(c => c.low)),
      close:  chunk[chunk.length - 1].close,
      volume: chunk.reduce((acc, c) => acc + c.volume, 0),
    });
  }

  const htf2_candles: OHLCV[] = [];
  const lookback_4h = Math.min(50, Math.floor(i / 48));
  for (let k = i; k > i - lookback_4h * 48; k -= 48) {
    if (k < 47) break;
    const chunk = data.slice(k - 47, k + 1);
    htf2_candles.unshift({
      time:   chunk[0].time,
      open:   chunk[0].open,
      high:   Math.max(...chunk.map(c => c.high)),
      low:    Math.min(...chunk.map(c => c.low)),
      close:  chunk[chunk.length - 1].close,
      volume: chunk.reduce((acc, c) => acc + c.volume, 0),
    });
  }

  const setup = detectSMCSetup(ltf, htf_candles, htf2_candles, { rr });
  return setup.reason === 'accepted' ? setup : null;
}

// ── Backtest options ──────────────────────────────────────────────────────────

export interface BacktestOptions {
  initialBalance?:    number;
  rr?:               number;
  riskPercent?:      number;
  allowedDirections?: string[];
  allowedSessions?:  TradingSession[];  // UPGRADE: session filter in backtest
  require4hAlign?:   boolean;           // UPGRADE: 4H regime filter in backtest
  atrPeriod?:        number;            // UPGRADE: configurable ATR period
  enableTrailingStop?: boolean;         // UPGRADE: trailing stop toggle
}

// ── Core simulation engine ────────────────────────────────────────────────────

function simulateTrades(
  data:          Candle[],
  htf1h:         OHLCV[],
  htf4h:         OHLCV[],
  startIndex:    number,
  endIndex:      number,
  initialBalance: number,
  rr:            number,
  riskPercent:   number,
  allowedDirections: string[],
  smc:           SMCOptions,
  enableTrailingStop: boolean,
): { trades: Trade[]; equityCurve: number[]; finalBalance: number } {
  let balance = initialBalance;
  const equityCurve: number[] = [balance];
  const trades: Trade[] = [];
  const slippagePercent = 0.0005;

  for (let i = Math.max(startIndex, 300); i < endIndex; i++) {
    // Inject current bar time as currentTimeUTC so the session filter works
    // correctly during backtesting (uses historical bar time, not wall clock).
    const barTime = new Date(data[i].time);
    const smcWithTime: SMCOptions = { ...smc, currentTimeUTC: barTime };

    const htf1h_idx = Math.floor(i / 12) - 1;
    const htf4h_idx = Math.floor(i / 48) - 1;
    if (htf1h_idx < 0 || htf4h_idx < 0) { equityCurve.push(balance); continue; }

    const ltf            = data.slice(Math.max(0, i - 499), i + 1);
    const htf1h_subset   = htf1h.slice(0, htf1h_idx + 1);
    const htf4h_subset   = htf4h.slice(0, htf4h_idx + 1);

    const setup = detectSMCSetup(ltf, htf1h_subset, htf4h_subset, smcWithTime);

    if (setup.reason !== 'accepted' || !setup.direction) {
      equityCurve.push(balance);
      continue;
    }

    if (!allowedDirections.includes(setup.direction)) {
      equityCurve.push(balance);
      continue;
    }

    const entryPrice = setup.price || data[i].close;
    const sl         = setup.sl as number;
    const tp         = setup.tp as number;
    const risk       = Math.abs(entryPrice - sl);

    if (risk === 0 || risk < entryPrice * MIN_RISK_PRICE_PERCENT) {
      equityCurve.push(balance);
      continue;
    }

    // Entry fee
    balance -= balance * slippagePercent;

    let result: 'win' | 'loss' | 'open' = 'open';
    let exitPrice  = 0;
    let exitTime   = 0;
    let exitIndex  = -1;
    let exitReason = 'Unknown';
    let currentSl  = sl;
    let hitBE      = false;

    // Per-trade simulation
    for (let j = i + 1; j < endIndex; j++) {
      const candle        = data[j];
      const elapsedMins   = (candle.time - data[i].time) / 60000;
      const currentProfitR =
        setup.direction === 'long'
          ? (candle.close - entryPrice) / risk
          : (entryPrice - candle.close) / risk;

      // UPGRADE: trailing stop — mirrors botEngine TRAIL_LEVELS exactly
      if (enableTrailingStop) {
        for (const level of TRAIL_LEVELS) {
          if (currentProfitR >= level.atR) {
            const trailPrice = setup.direction === 'long'
              ? entryPrice + risk * level.lockR
              : entryPrice - risk * level.lockR;
            if (setup.direction === 'long'  && trailPrice > currentSl) currentSl = trailPrice;
            if (setup.direction === 'short' && trailPrice < currentSl) currentSl = trailPrice;
          }
        }
      }

      // Break-even
      if (!hitBE && currentProfitR >= 1.0) {
        if (setup.direction === 'long'  && entryPrice > currentSl) currentSl = entryPrice;
        if (setup.direction === 'short' && entryPrice < currentSl) currentSl = entryPrice;
        hitBE = true;
      }

      // Hard timeout
      if (elapsedMins >= HARD_TIMEOUT_MINUTES) {
        exitPrice  = candle.close;
        result     = (setup.direction === 'long' && exitPrice > entryPrice) ||
                     (setup.direction === 'short' && exitPrice < entryPrice) ? 'win' : 'loss';
        exitTime   = candle.time; exitIndex = j; exitReason = 'Time Expiry'; break;
      }

      // Stagnation exit
      if (elapsedMins >= STAGNATION_MINUTES && currentProfitR < STAGNATION_R_THRESHOLD) {
        exitPrice  = candle.close;
        result     = (setup.direction === 'long' && exitPrice > entryPrice) ||
                     (setup.direction === 'short' && exitPrice < entryPrice) ? 'win' : 'loss';
        exitTime   = candle.time; exitIndex = j; exitReason = 'Stagnation'; break;
      }

      // SL / TP
      if (setup.direction === 'long') {
        if (candle.low  <= currentSl) { result = 'loss'; exitPrice = currentSl; exitTime = candle.time; exitIndex = j; exitReason = hitBE ? 'BE' : 'SL'; break; }
        if (candle.high >= tp)        { result = 'win';  exitPrice = tp;        exitTime = candle.time; exitIndex = j; exitReason = 'TP'; break; }
      } else {
        if (candle.high >= currentSl) { result = 'loss'; exitPrice = currentSl; exitTime = candle.time; exitIndex = j; exitReason = hitBE ? 'BE' : 'SL'; break; }
        if (candle.low  <= tp)        { result = 'win';  exitPrice = tp;        exitTime = candle.time; exitIndex = j; exitReason = 'TP'; break; }
      }
    }

    if (result === 'open') { equityCurve.push(balance); continue; }

    const actualR    = setup.direction === 'long'
      ? (exitPrice - entryPrice) / risk
      : (entryPrice - exitPrice) / risk;
    const riskAmount = balance * (riskPercent / 100);
    const pnl        = riskAmount * actualR;

    balance += pnl;
    balance -= balance * slippagePercent;

    trades.push({
      type:       setup.direction,
      entryTime:  data[i].time,
      entryPrice,
      sl, tp,
      exitTime, exitPrice,
      result, pnl,
      reason:   exitReason,
      duration: (exitTime - data[i].time) / 60000,
      session:  setup.session,
    });

    const skipCount = exitIndex - i;
    for (let k = 0; k < skipCount; k++) equityCurve.push(balance);

    const buffer = 12;
    for (let k = 0; k < buffer && exitIndex + k < endIndex; k++) equityCurve.push(balance);
    i = exitIndex + buffer - 1;
  }

  return { trades, equityCurve, finalBalance: balance };
}

// ── Public backtest runner ────────────────────────────────────────────────────

export function runBacktest(
  data:    Candle[],
  options: BacktestOptions = {},
): BacktestResult {
  const {
    initialBalance     = 10000,
    rr                 = 2.0,
    riskPercent        = 1.0,
    allowedDirections  = ['long', 'short'],
    allowedSessions    = DEFAULT_ALLOWED_SESSIONS,
    require4hAlign     = true,
    atrPeriod          = 14,
    enableTrailingStop = true,
  } = options;

  // Pre-aggregate HTF candles once for performance
  const htf1h: OHLCV[] = [];
  const htf4h: OHLCV[] = [];
  const aggregate = (interval: number, target: OHLCV[]) => {
    for (let i = 0; i < data.length; i += interval) {
      const chunk = data.slice(i, i + interval);
      if (!chunk.length) continue;
      target.push({
        time:   chunk[0].time,
        open:   chunk[0].open,
        high:   Math.max(...chunk.map(c => c.high)),
        low:    Math.min(...chunk.map(c => c.low)),
        close:  chunk[chunk.length - 1].close,
        volume: chunk.reduce((acc, c) => acc + c.volume, 0),
      });
    }
  };
  aggregate(12, htf1h);
  aggregate(48, htf4h);

  const smc: SMCOptions = {
    rr, atrPeriod, allowedSessions, require4hAlign,
  };

  const { trades, equityCurve, finalBalance } = simulateTrades(
    data, htf1h, htf4h,
    0, data.length,
    initialBalance, rr, riskPercent,
    allowedDirections, smc, enableTrailingStop,
  );

  return buildResult(trades, equityCurve, finalBalance);
}

// ── Walk-forward validation ───────────────────────────────────────────────────
// UPGRADE: splits data into N windows (default 5), runs in-sample on the
// first 80% of each window and out-of-sample on the last 20%.  Checks if
// performance is consistent across windows.  A strategy that degrades heavily
// on out-of-sample data is likely overfit to the specific period.

export function runWalkForward(
  data:        Candle[],
  options:     BacktestOptions = {},
  numWindows:  number = 5,
): WalkForwardResult {
  const {
    initialBalance     = 10000,
    rr                 = 2.0,
    riskPercent        = 1.0,
    allowedDirections  = ['long', 'short'],
    allowedSessions    = DEFAULT_ALLOWED_SESSIONS,
    require4hAlign     = true,
    atrPeriod          = 14,
    enableTrailingStop = true,
  } = options;

  // Pre-aggregate HTF once for all windows
  const htf1h: OHLCV[] = [];
  const htf4h: OHLCV[] = [];
  const aggregate = (interval: number, target: OHLCV[]) => {
    for (let i = 0; i < data.length; i += interval) {
      const chunk = data.slice(i, i + interval);
      if (!chunk.length) continue;
      target.push({
        time:   chunk[0].time,
        open:   chunk[0].open,
        high:   Math.max(...chunk.map(c => c.high)),
        low:    Math.min(...chunk.map(c => c.low)),
        close:  chunk[chunk.length - 1].close,
        volume: chunk.reduce((acc, c) => acc + c.volume, 0),
      });
    }
  };
  aggregate(12, htf1h);
  aggregate(48, htf4h);

  const smc: SMCOptions = { rr, atrPeriod, allowedSessions, require4hAlign };
  const windowSize      = Math.floor(data.length / numWindows);
  const splitRatio      = 0.8; // 80% in-sample, 20% out-of-sample
  const windows: WalkForwardWindow[] = [];

  for (let w = 0; w < numWindows; w++) {
    const winStart  = w * windowSize;
    const winEnd    = Math.min(winStart + windowSize, data.length);
    const splitAt   = Math.floor(winStart + (winEnd - winStart) * splitRatio);

    const inSim = simulateTrades(
      data, htf1h, htf4h,
      winStart, splitAt,
      initialBalance, rr, riskPercent,
      allowedDirections, smc, enableTrailingStop,
    );
    const outSim = simulateTrades(
      data, htf1h, htf4h,
      splitAt, winEnd,
      initialBalance, rr, riskPercent,
      allowedDirections, smc, enableTrailingStop,
    );

    const inResult  = buildResult(inSim.trades,  inSim.equityCurve,  inSim.finalBalance);
    const outResult = buildResult(outSim.trades, outSim.equityCurve, outSim.finalBalance);

    // Stability score: how well out-of-sample WR tracks in-sample WR
    const stability = inResult.winRate > 0
      ? Math.min(1, outResult.winRate / inResult.winRate)
      : 0;

    windows.push({
      windowIndex:   w,
      inSampleBars:  splitAt - winStart,
      outSampleBars: winEnd - splitAt,
      inSample:      inResult,
      outSample:     outResult,
      stabilityScore: Math.round(stability * 100) / 100,
    });
  }

  const avgStability = windows.reduce((a, w) => a + w.stabilityScore, 0) / windows.length;
  const isRobust     = avgStability >= 0.7;

  const summary =
    `Walk-forward (${numWindows} windows): ` +
    `avg stability ${(avgStability * 100).toFixed(1)}% — ` +
    (isRobust
      ? '✅ Strategy appears robust. Out-of-sample performance tracks in-sample well.'
      : '⚠️ Strategy may be overfit. Out-of-sample degrades significantly vs in-sample.');

  return { windows, avgStabilityScore: Math.round(avgStability * 100) / 100, isRobust, summary };
}

// ── Stats builder ─────────────────────────────────────────────────────────────

function buildResult(
  trades:       Trade[],
  equityCurve:  number[],
  finalBalance: number,
): BacktestResult {
  const totalTrades = trades.length;
  const wins        = trades.filter(t => t.result === 'win').length;
  const winRate     = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  const grossProfit = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss   = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;

  let maxCL = 0, curCL = 0;
  trades.forEach(t => {
    if (t.pnl < 0) { curCL++; maxCL = Math.max(maxCL, curCL); } else { curCL = 0; }
  });

  const avgDuration = totalTrades > 0
    ? trades.reduce((a, t) => a + (t.duration || 0), 0) / totalTrades
    : 0;

  return {
    totalTrades, winRate, finalBalance, equityCurve, trades,
    profitFactor, maxConsecutiveLosses: maxCL, avgDuration,
  };
}