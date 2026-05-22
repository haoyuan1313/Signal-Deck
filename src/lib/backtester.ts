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
import { evaluateFilter, type EdgeFilter, DEFAULT_EDGE_FILTER } from './edgeAnalytics';

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
  beArmedTime?: number;   // bar index when BE was armed
  trailLevelsHit: { atR: number; lockR: number; barIndex: number }[];
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

// ── Detailed result ──────────────────────────────────────────────────────────

export interface DetailedResult extends BacktestResult {
  netR: number;
  netProfit: number;
  maxDrawdown: number;
  avgRPerTrade: number;
  largestWin: number;
  largestLoss: number;
  mode: 'ideal' | 'realistic';
}

// ── Monte Carlo result ───────────────────────────────────────────────────────

export interface MonteCarloResult {
  medianFinalBalance: number;
  worst5FinalBalance: number;
  best5FinalBalance: number;
  maxDrawdownRange: { min: number; max: number };
  riskOfRuin: number; // 0–1, fraction of runs where balance fell below ruin threshold
  totalRuns: number;
}

// ── Validation warnings ──────────────────────────────────────────────────────

export interface ValidationWarning {
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface BacktestOutput {
  ideal: DetailedResult;
  realistic: DetailedResult;
  monteCarlo: MonteCarloResult;
  warnings: ValidationWarning[];
}

// ── Walk-forward result ───────────────────────────────────────────────────────

export interface WalkForwardWindow {
  windowIndex: number;
  inSampleBars: number;
  outSampleBars: number;
  inSample: BacktestResult;
  outSample: BacktestResult;
  stabilityScore: number;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  avgStabilityScore: number;
  isRobust: boolean;
  summary: string;
}

// ── Constants (keep in sync with botEngine.ts) ────────────────────────────────
const HARD_TIMEOUT_MINUTES   = 150;
const STAGNATION_MINUTES     = 75;
const STAGNATION_R_THRESHOLD = 0.5;

// Trailing stop levels — keep in sync between backtester and live bot
export const TRAIL_LEVELS = [
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
  initialBalance?:     number;
  rr?:                number;
  riskPercent?:       number;
  allowedDirections?:  string[];
  allowedSessions?:   TradingSession[];
  require4hAlign?:    boolean;
  atrPeriod?:         number;
  enableTrailingStop?: boolean;
  // ── Realism settings ────────────────────────────────────────────────────────
  useCompounding?:    boolean;   // false = fixed riskAmount from initialCapital
  feePercent?:        number;    // trading fee per side (e.g. 0.001 = 0.1%)
  slippagePercent?:   number;    // slippage per execution (e.g. 0.0005 = 0.05%)
  intrabarMode?:      'conservative' | 'optimistic';
  // ── Edge filter ────────────────────────────────────────────────────────────
  edgeFilter?:        EdgeFilter;
}

// ── Core simulation engine ────────────────────────────────────────────────────

interface SimOptions {
  data:               Candle[];
  htf1h:              OHLCV[];
  htf4h:              OHLCV[];
  startIndex:         number;
  endIndex:           number;
  initialBalance:     number;
  rr:                 number;
  riskPercent:        number;
  allowedDirections:  string[];
  smc:                SMCOptions;
  enableTrailingStop: boolean;
  useCompounding:     boolean;
  feePercent:         number;
  slippagePercent:    number;
  intrabarMode:       'conservative' | 'optimistic';
  edgeFilter?:        EdgeFilter;
  symbol?:            string;
}

function simulateTrades(opts: SimOptions): { trades: Trade[]; equityCurve: number[]; finalBalance: number } {
  const {
    data, htf1h, htf4h, startIndex, endIndex,
    initialBalance, rr, riskPercent, allowedDirections,
    smc, enableTrailingStop, useCompounding, feePercent, slippagePercent, intrabarMode,
    edgeFilter, symbol: simSymbol,
  } = opts;

  let balance = initialBalance;
  const fixedRiskAmount = initialBalance * (riskPercent / 100);
  const equityCurve: number[] = [balance];
  const trades: Trade[] = [];

  for (let i = Math.max(startIndex, 300); i < endIndex; i++) {
    const barTime = new Date(data[i].time);
    const smcWithTime: SMCOptions = { ...smc, currentTimeUTC: barTime };

    // ── Lookahead prevention: use only CLOSED HTF candles ────────────────────
    // The current bar is at index i. The 1H candle that contains bar i
    // closes only when (i+1) % 12 === 0 (i.e. the 12th bar of the HTF candle).
    // Use htf1h_idx such that the last HTF candle is fully closed.
    const htf1h_idx = Math.floor((i + 1) / 12) - 1; // +1 so the current bar's candle isn't used
    const htf4h_idx = Math.floor((i + 1) / 48) - 1;

    if (htf1h_idx < 1 || htf4h_idx < 1) { equityCurve.push(balance); continue; }

    const ltf          = data.slice(Math.max(0, i - 499), i + 1);
    // Only slice up to the fully closed HTF candle (exclusive of current)
    const htf1h_subset = htf1h.slice(0, htf1h_idx);
    const htf4h_subset = htf4h.slice(0, htf4h_idx);

    const setup = detectSMCSetup(ltf, htf1h_subset, htf4h_subset, smcWithTime);

    if (setup.reason !== 'accepted' || !setup.direction) {
      equityCurve.push(balance);
      continue;
    }

    if (!allowedDirections.includes(setup.direction)) {
      equityCurve.push(balance);
      continue;
    }

    // ── Edge Filter v1 ──────────────────────────────────────────────────────
    if (edgeFilter?.enableEdgeFilter) {
      const filterResult = evaluateFilter(edgeFilter, {
        symbol: simSymbol || 'unknown',
        direction: setup.direction,
        session: setup.session || getUTCSession(barTime.getUTCHours()),
        aiConfidence: 0, // no AI scoring in backtest
      });
      if (!filterResult.passed) {
        equityCurve.push(balance);
        continue;
      }
    }

    // ── Lookahead prevention: enter on NEXT candle, not the signal candle ────
    const entryIndex = i + 1;
    if (entryIndex >= endIndex) { equityCurve.push(balance); continue; }
    const entryBar = data[entryIndex];
    const entryPrice = entryBar.open; // realistic fill at next bar open
    const sl         = setup.sl as number;
    const tp         = setup.tp as number;
    const risk       = Math.abs(entryPrice - sl);

    if (risk === 0 || risk < entryPrice * MIN_RISK_PRICE_PERCENT) {
      equityCurve.push(balance);
      continue;
    }

    // ── Trading costs: entry fee + slippage ──────────────────────────────────
    const riskAmount = useCompounding
      ? balance * (riskPercent / 100)
      : fixedRiskAmount;

    const entrySlippage = setup.direction === 'long'
      ? entryPrice * (1 + slippagePercent)    // long entry: price higher (worse)
      : entryPrice * (1 - slippagePercent);    // short entry: price lower (worse)
    const effectiveEntry = entrySlippage;

    // Fee on entry
    balance -= riskAmount * feePercent;

    let result: 'win' | 'loss' | 'open' = 'open';
    let exitPrice  = 0;
    let exitTime   = 0;
    let exitIndex  = -1;
    let exitReason = 'Unknown';
    let currentSl  = sl;
    let hitBE      = false;
    let beArmedAtBar = -1;
    const trailLevelsHit: { atR: number; lockR: number; barIndex: number }[] = [];
    // Track pending SL updates (don't apply same-candle)
    let pendingSl: number | null = null;

    // Per-trade simulation
    for (let j = entryIndex + 1; j < endIndex; j++) {
      const candle        = data[j];
      const elapsedMins   = (candle.time - data[entryIndex].time) / 60000;
      const currentProfitR =
        setup.direction === 'long'
          ? (candle.close - effectiveEntry) / risk
          : (effectiveEntry - candle.close) / risk;

      // Apply any pending SL update from the PREVIOUS candle
      if (pendingSl !== null) {
        if (setup.direction === 'long'  && pendingSl > currentSl) currentSl = pendingSl;
        if (setup.direction === 'short' && pendingSl < currentSl) currentSl = pendingSl;
        pendingSl = null;
      }

      // ── Trailing stop: compute on this candle, apply NEXT candle ───────────
      if (enableTrailingStop) {
        for (const level of TRAIL_LEVELS) {
          if (currentProfitR >= level.atR) {
            const alreadyTriggered = trailLevelsHit.some(t => t.atR === level.atR);
            if (alreadyTriggered) continue;
            const trailPrice = setup.direction === 'long'
              ? effectiveEntry + risk * level.lockR
              : effectiveEntry - risk * level.lockR;
            const better = setup.direction === 'long' ? trailPrice > currentSl : trailPrice < currentSl;
            if (better) {
              // Queue for NEXT candle — don't apply same-candle
              pendingSl = trailPrice;
              trailLevelsHit.push({ atR: level.atR, lockR: level.lockR, barIndex: j + 1 });
            }
          }
        }
      }

      // ── Break-even: compute on this candle, apply NEXT candle ──────────────
      if (!hitBE && currentProfitR >= 1.0) {
        const better = setup.direction === 'long'
          ? effectiveEntry > currentSl : effectiveEntry < currentSl;
        if (better) {
          pendingSl = effectiveEntry;
          beArmedAtBar = j + 1;
          hitBE = true;
        }
      }

      // Hard timeout
      if (elapsedMins >= HARD_TIMEOUT_MINUTES) {
        exitPrice  = candle.close;
        result     = (setup.direction === 'long' && exitPrice > effectiveEntry) ||
                     (setup.direction === 'short' && exitPrice < effectiveEntry) ? 'win' : 'loss';
        exitTime   = candle.time; exitIndex = j; exitReason = 'Time Expiry'; break;
      }

      // Stagnation exit
      if (elapsedMins >= STAGNATION_MINUTES && currentProfitR < STAGNATION_R_THRESHOLD) {
        exitPrice  = candle.close;
        result     = (setup.direction === 'long' && exitPrice > effectiveEntry) ||
                     (setup.direction === 'short' && exitPrice < effectiveEntry) ? 'win' : 'loss';
        exitTime   = candle.time; exitIndex = j; exitReason = 'Stagnation'; break;
      }

      // ── SL / TP with conservative intrabar check ───────────────────────────
      if (setup.direction === 'long') {
        const slHit = candle.low <= currentSl;
        const tpHit = candle.high >= tp;
        const bothHit = slHit && tpHit;

        if (bothHit && intrabarMode === 'conservative') {
          // Assume SL triggered first (price moved against us first)
          result = 'loss'; exitPrice = currentSl; exitTime = candle.time;
          exitIndex = j; exitReason = hitBE ? 'BE' : 'SL'; break;
        }
        if (slHit) { result = 'loss'; exitPrice = currentSl; exitTime = candle.time; exitIndex = j; exitReason = hitBE ? 'BE' : 'SL'; break; }
        if (tpHit) { result = 'win';  exitPrice = tp;        exitTime = candle.time; exitIndex = j; exitReason = 'TP'; break; }
      } else {
        const slHit = candle.high >= currentSl;
        const tpHit = candle.low <= tp;
        const bothHit = slHit && tpHit;

        if (bothHit && intrabarMode === 'conservative') {
          result = 'loss'; exitPrice = currentSl; exitTime = candle.time;
          exitIndex = j; exitReason = hitBE ? 'BE' : 'SL'; break;
        }
        if (slHit) { result = 'loss'; exitPrice = currentSl; exitTime = candle.time; exitIndex = j; exitReason = hitBE ? 'BE' : 'SL'; break; }
        if (tpHit) { result = 'win';  exitPrice = tp;        exitTime = candle.time; exitIndex = j; exitReason = 'TP'; break; }
      }

      // Apply pending SL at the end of the bar (for next iteration)
      if (pendingSl !== null) {
        if (setup.direction === 'long'  && pendingSl > currentSl) currentSl = pendingSl;
        if (setup.direction === 'short' && pendingSl < currentSl) currentSl = pendingSl;
        pendingSl = null;
      }
    }

    if (result === 'open') { equityCurve.push(balance); continue; }

    // ── Exit slippage + fee ──────────────────────────────────────────────────
    const exitSlippage = setup.direction === 'long'
      ? exitPrice * (1 - slippagePercent)   // long exit: price lower (worse)
      : exitPrice * (1 + slippagePercent);   // short exit: price higher (worse)
    const effectiveExit = exitSlippage;

    // Fee on exit
    balance -= riskAmount * feePercent;

    const actualR    = setup.direction === 'long'
      ? (effectiveExit - effectiveEntry) / risk
      : (effectiveEntry - effectiveExit) / risk;
    const pnl        = riskAmount * actualR;

    balance += pnl;

    trades.push({
      type:       setup.direction,
      entryTime:  data[entryIndex].time,
      entryPrice: effectiveEntry,
      sl: currentSl, tp,
      exitTime, exitPrice: effectiveExit,
      result, pnl,
      reason:   exitReason,
      duration: (exitTime - data[entryIndex].time) / 60000,
      session:  setup.session,
      beArmedTime: beArmedAtBar,
      trailLevelsHit,
    });

    const skipCount = exitIndex - i;
    for (let k = 0; k < skipCount; k++) equityCurve.push(balance);

    const buffer = 12;
    for (let k = 0; k < buffer && exitIndex + k < endIndex; k++) equityCurve.push(balance);
    i = exitIndex + buffer - 1;
  }

  return { trades, equityCurve, finalBalance: balance };
}

// ── Statistics builders ──────────────────────────────────────────────────────

function buildDetailedResult(
  trades: Trade[],
  equityCurve: number[],
  finalBalance: number,
  initialBalance: number,
  mode: 'ideal' | 'realistic',
): DetailedResult {
  const totalTrades = trades.length;
  const wins        = trades.filter(t => t.result === 'win').length;
  const winRate     = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  const grossProfit = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss   = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;
  const netProfit    = finalBalance - initialBalance;

  let maxCL = 0, curCL = 0;
  trades.forEach(t => {
    if (t.pnl < 0) { curCL++; maxCL = Math.max(maxCL, curCL); } else { curCL = 0; }
  });

  // Max drawdown from equity curve
  let peak = equityCurve[0];
  let maxDrawdown = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const totalR = trades.reduce((sum, t) => {
    // Reconstruct approximate R from PnL and risk amount
    return sum + (t.pnl / (finalBalance > 0 ? finalBalance : 1));
  }, 0);
  const netR = trades.reduce((sum, t) => {
    // Use PnL sign to derive R sign; not exact due to compounding but proportional
    return sum + (t.pnl > 0 ? 1 : t.pnl < 0 ? 1 : 0); // placeholder — see below
  }, 0);

  // Compute actual R values per trade
  const rValues: number[] = [];
  let runningBalance = initialBalance;
  const riskPct = (initialBalance > 0) ? 0 : 0; // We can't know exact riskPct here, use PnL ratios
  for (const t of trades) {
    const absPnl = Math.abs(t.pnl);
    if (runningBalance > 0 && absPnl > 0) {
      // R ≈ pnl / (balance * riskPct) — but we don't have riskPct in detailed result
      // Store the raw PnL for aggregate stats
      rValues.push(t.pnl);
    }
  }

  const avgRPerTrade = rValues.length > 0
    ? rValues.reduce((a, v) => a + v, 0) / rValues.length
    : 0;

  const positivePnls = trades.filter(t => t.pnl > 0).map(t => t.pnl);
  const negativePnls = trades.filter(t => t.pnl < 0).map(t => t.pnl);
  const largestWin  = positivePnls.length > 0 ? Math.max(...positivePnls) : 0;
  const largestLoss = negativePnls.length > 0 ? Math.min(...negativePnls) : 0;

  const avgDuration = totalTrades > 0
    ? trades.reduce((a, t) => a + (t.duration || 0), 0) / totalTrades
    : 0;

  const netRValue = trades.reduce((sum, t) => {
    const riskAmt = Math.abs(t.entryPrice - t.sl);
    const r = t.type === 'long'
      ? (t.exitPrice! - t.entryPrice) / riskAmt
      : (t.entryPrice - t.exitPrice!) / riskAmt;
    return sum + r;
  }, 0);

  return {
    totalTrades, winRate, finalBalance, equityCurve, trades,
    profitFactor, maxConsecutiveLosses: maxCL, avgDuration,
    netR: Math.round(netRValue * 100) / 100,
    netProfit, maxDrawdown, avgRPerTrade, largestWin, largestLoss,
    mode,
  };
}

// ── Monte Carlo simulation ───────────────────────────────────────────────────

function runMonteCarlo(trades: Trade[], initialBalance: number, riskPercent: number, runs: number = 1000): MonteCarloResult {
  const finalBalances: number[] = [];
  const drawdowns: number[] = [];
  const RUIN_THRESHOLD = 0.3; // 30% of initial capital
  let ruinCount = 0;

  for (let r = 0; r < runs; r++) {
    // Shuffle trade PnLs
    const shuffled = [...trades].sort(() => Math.random() - 0.5);
    let bal = initialBalance;
    let peak = bal;
    let runMaxDD = 0;

    for (const t of shuffled) {
      bal += t.pnl;
      if (bal <= initialBalance * RUIN_THRESHOLD) {
        ruinCount++;
        break;
      }
      if (bal > peak) peak = bal;
      const dd = (peak - bal) / peak;
      if (dd > runMaxDD) runMaxDD = dd;
    }

    finalBalances.push(bal);
    drawdowns.push(runMaxDD);
  }

  const sortedBalances = [...finalBalances].sort((a, b) => a - b);
  const sortedDDs = [...drawdowns].sort((a, b) => a - b);
  const n = sortedBalances.length;

  const median = n % 2 === 0
    ? (sortedBalances[n / 2 - 1] + sortedBalances[n / 2]) / 2
    : sortedBalances[Math.floor(n / 2)];

  const worst5Idx  = Math.floor(n * 0.05);
  const best5Idx   = Math.floor(n * 0.95);

  return {
    medianFinalBalance: median,
    worst5FinalBalance: sortedBalances[worst5Idx],
    best5FinalBalance: sortedBalances[best5Idx],
    maxDrawdownRange: {
      min: sortedDDs[worst5Idx],
      max: sortedDDs[best5Idx],
    },
    riskOfRuin: ruinCount / runs,
    totalRuns: runs,
  };
}

// ── Validation warnings ───────────────────────────────────────────────────────

function generateWarnings(result: DetailedResult): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Final balance > 100x initial
  const growth = result.finalBalance / (result.equityCurve[0] || 1);
  if (growth > 100) {
    warnings.push({ severity: 'high', message: `Final balance is ${growth.toFixed(0)}x initial capital — likely overfit or unrealistic assumptions` });
  } else if (growth > 50) {
    warnings.push({ severity: 'medium', message: `Final balance is ${growth.toFixed(0)}x initial capital — very high, verify assumptions` });
  }

  // Profit factor > 2.5
  if (result.profitFactor > 2.5) {
    warnings.push({ severity: 'high', message: `Profit factor ${result.profitFactor.toFixed(2)} is unusually high (>2.5). Real strategies rarely sustain this.` });
  } else if (result.profitFactor > 2.0) {
    warnings.push({ severity: 'medium', message: `Profit factor ${result.profitFactor.toFixed(2)} is above 2.0 — validate out-of-sample.` });
  }

  // Max losing streak suspiciously low
  if (result.totalTrades >= 100 && result.maxConsecutiveLosses <= 4) {
    warnings.push({ severity: 'medium', message: `Only ${result.maxConsecutiveLosses} consecutive losses in ${result.totalTrades} trades — might be unrealistically low.` });
  }

  // Win rate + RR combination check (Kelly criterion)
  if (result.totalTrades > 0) {
    const wr = result.winRate / 100;
    const avgWin  = result.trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0) / Math.max(1, result.trades.filter(t => t.pnl > 0).length);
    const avgLoss = Math.abs(result.trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0)) / Math.max(1, result.trades.filter(t => t.pnl < 0).length);
    const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;
    const expectedValue = wr * avgRR - (1 - wr);
    if (expectedValue > 0.5) {
      warnings.push({ severity: 'high', message: `Per-trade edge is ${(expectedValue * 100).toFixed(1)}% (>50%) — unsustainable in real markets.` });
    }
  }

  // Equity curve too vertical (check if last quarter of curve has >80% of gains)
  const curve = result.equityCurve;
  if (curve.length > 100) {
    const q3Start = Math.floor(curve.length * 0.75);
    const first75Gain = curve[q3Start] - curve[0];
    const totalGain = curve[curve.length - 1] - curve[0];
    if (totalGain > 0 && first75Gain / totalGain < 0.2) {
      warnings.push({ severity: 'medium', message: 'Equity curve is very vertical — 80%+ of gains in last 25% of bars. Likely overfit to recent price action.' });
    }
  }

  return warnings;
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

  const sim = simulateTrades({
    data, htf1h, htf4h,
    startIndex: 0, endIndex: data.length,
    initialBalance, rr, riskPercent,
    allowedDirections, smc, enableTrailingStop,
    useCompounding: true, feePercent: 0, slippagePercent: 0,
    intrabarMode: 'optimistic',
    edgeFilter: options.edgeFilter,
  });

  return buildResult(sim.trades, sim.equityCurve, sim.finalBalance);
}

function buildResult(
  trades: Trade[],
  equityCurve: number[],
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

  return { totalTrades, winRate, finalBalance, equityCurve, trades, profitFactor, maxConsecutiveLosses: maxCL, avgDuration };
}

// ── Comprehensive backtest (runs both ideal + realistic + Monte Carlo) ────────

export function runComprehensiveBacktest(
  data:    Candle[],
  options: BacktestOptions = {},
): BacktestOutput {
  const {
    initialBalance     = 10000,
    rr                 = 2.0,
    riskPercent        = 1.0,
    allowedDirections  = ['long', 'short'],
    allowedSessions    = DEFAULT_ALLOWED_SESSIONS,
    require4hAlign     = true,
    atrPeriod          = 14,
    enableTrailingStop = true,
    useCompounding     = false,
    feePercent         = 0.001,
    slippagePercent    = 0.0005,
    intrabarMode       = 'conservative',
    edgeFilter,
  } = options;

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

  const commonSimOpts = {
    data, htf1h, htf4h,
    startIndex: 0, endIndex: data.length,
    initialBalance, rr, riskPercent,
    allowedDirections, smc, enableTrailingStop,
    edgeFilter,
  };

  // A. Ideal backtest
  const idealSim = simulateTrades({
    ...commonSimOpts,
    useCompounding: true, feePercent: 0, slippagePercent: 0,
    intrabarMode: 'optimistic',
  });
  const idealResult = buildDetailedResult(idealSim.trades, idealSim.equityCurve, idealSim.finalBalance, initialBalance, 'ideal');

  // B. Realistic backtest
  const realisticSim = simulateTrades({
    ...commonSimOpts,
    useCompounding,
    feePercent,
    slippagePercent,
    intrabarMode,
  });
  const realisticResult = buildDetailedResult(realisticSim.trades, realisticSim.equityCurve, realisticSim.finalBalance, initialBalance, 'realistic');

  // C. Monte Carlo on realistic trades
  const monteCarlo = runMonteCarlo(realisticSim.trades, initialBalance, riskPercent);

  // D. Warnings
  const warnings = generateWarnings(realisticResult);

  return { ideal: idealResult, realistic: realisticResult, monteCarlo, warnings };
}

// ── Walk-forward validation ───────────────────────────────────────────────────

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
  const splitRatio      = 0.8;
  const windows: WalkForwardWindow[] = [];

  for (let w = 0; w < numWindows; w++) {
    const winStart  = w * windowSize;
    const winEnd    = Math.min(winStart + windowSize, data.length);
    const splitAt   = Math.floor(winStart + (winEnd - winStart) * splitRatio);

    const baseSimOpts = {
      data, htf1h, htf4h,
      initialBalance, rr, riskPercent,
      allowedDirections, smc, enableTrailingStop,
      useCompounding: true, feePercent: 0, slippagePercent: 0,
      intrabarMode: 'optimistic' as const,
    };

    const inSim = simulateTrades({ ...baseSimOpts, startIndex: winStart, endIndex: splitAt });
    const outSim = simulateTrades({ ...baseSimOpts, startIndex: splitAt, endIndex: winEnd });

    const inResult  = buildResult(inSim.trades,  inSim.equityCurve,  inSim.finalBalance);
    const outResult = buildResult(outSim.trades, outSim.equityCurve, outSim.finalBalance);

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
