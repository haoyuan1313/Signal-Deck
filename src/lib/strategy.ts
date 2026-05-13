export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StrategySetup {
  direction?: 'long' | 'short';
  reason: string;
  price?: number;
  htf_trend?: string;
  atr?: number;
  sl?: number;
  tp?: number;
  rr?: number;
  session?: string;
}

// ── Session types & constants ────────────────────────────────────────────────

export type TradingSession = 'asian' | 'london' | 'ny_am' | 'ny_pm' | 'late';

export const DEFAULT_ALLOWED_SESSIONS: TradingSession[] = ['london', 'ny_am', 'ny_pm'];

// Minimum risk thresholds (keep in sync with botEngine.ts)
export const MIN_RISK_ATR_MULTIPLE  = 0.2;
export const MIN_RISK_PRICE_PERCENT = 0.001; // 0.1%

// ── SMC strategy options ─────────────────────────────────────────────────────

export interface SMCOptions {
  rr?:               number;
  atrPeriod?:        number;
  allowedSessions?:  TradingSession[];
  require4hAlign?:   boolean;
  /** Override the "current time" used for session filtering (for backtesting). */
  currentTimeUTC?:   Date;
}

// ── Session helpers ───────────────────────────────────────────────────────────

export function getUTCSession(hourUTC: number): TradingSession {
  if (hourUTC >= 0  && hourUTC < 7)  return 'asian';
  if (hourUTC >= 7  && hourUTC < 12) return 'london';
  if (hourUTC >= 12 && hourUTC < 17) return 'ny_am';
  if (hourUTC >= 17 && hourUTC < 22) return 'ny_pm';
  return 'late';
}

function isAllowedSession(
  allowedSessions: TradingSession[],
  currentTimeUTC: Date,
): boolean {
  const session = getUTCSession(currentTimeUTC.getUTCHours());
  return allowedSessions.includes(session);
}

// ── EMA ───────────────────────────────────────────────────────────────────────

export function calcEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  // Seed with SMA of first `period` bars — more accurate than anchoring to values[0].
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 2 / (period + 1);
  let ema = seed;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

// ── ATR ───────────────────────────────────────────────────────────────────────

export function calcATR(ohlcv: OHLCV[], period: number = 14): number | null {
  if (ohlcv.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < ohlcv.length; i++) {
    const h = ohlcv[i].high;
    const l = ohlcv[i].low;
    const prevC = ohlcv[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    trs.push(tr);
  }
  const sliced = trs.slice(-period);
  return sliced.reduce((a, b) => a + b, 0) / period;
}

// ── HTF trend ─────────────────────────────────────────────────────────────────

export function getHTFTrend(ohlcv: OHLCV[], requireSlope: boolean = true): 'bullish' | 'bearish' | null {
  if (ohlcv.length < 20) return null;
  const closes = ohlcv.map(x => x.close);
  const period = Math.min(ohlcv.length - 1, 20);

  const emaVal = calcEMA(closes, period);
  if (emaVal === null) return null;

  const currentClose = closes[closes.length - 1];

  if (!requireSlope) {
    return currentClose > emaVal ? 'bullish' : 'bearish';
  }

  const emaPrev = calcEMA(closes.slice(0, -5), period);
  if (emaPrev === null) {
    return currentClose > emaVal ? 'bullish' : 'bearish';
  }

  const slope = (emaVal - emaPrev) / emaPrev;
  const minSlopePct = 0.00005;

  if (currentClose > emaVal && slope > minSlopePct)  return 'bullish';
  if (currentClose < emaVal && slope < -minSlopePct) return 'bearish';
  return null;
}

// ── Sweep setup (legacy) ──────────────────────────────────────────────────────

export function detectSweepSetup(ohlcv: OHLCV[], rr: number = 2.0): StrategySetup {
  if (ohlcv.length < 50) return { reason: 'insufficient_data' };

  const i = ohlcv.length - 1;
  const prev = ohlcv[i - 1];
  const lookback = ohlcv.slice(i - 21, i - 1);

  const maxHigh = Math.max(...lookback.map(c => c.high));
  const minLow  = Math.min(...lookback.map(c => c.low));

  let direction: 'long' | 'short' | null = null;
  if (prev.high > maxHigh) direction = 'short';
  else if (prev.low < minLow) direction = 'long';
  if (!direction) return { reason: 'no_sweep_detected' };

  const entryPrice = ohlcv[i].close;
  const slWindow   = ohlcv.slice(i - 4, i + 1);

  let sl = 0;
  if (direction === 'long') sl = Math.min(...slWindow.map(c => c.low));
  else                       sl = Math.max(...slWindow.map(c => c.high));

  const risk = Math.abs(entryPrice - sl);
  if (risk < entryPrice * 0.002) return { reason: 'risk_too_low' };

  const tp = direction === 'long'
    ? entryPrice + risk * rr
    : entryPrice - risk * rr;

  return { direction, reason: 'accepted', price: entryPrice, sl, tp, rr };
}

// ── SMC setup (main) ──────────────────────────────────────────────────────────

export function detectSMCSetup(
  ohlcv_5m: OHLCV[],
  ohlcv_1h: OHLCV[],
  ohlcv_4h: OHLCV[],
  options: SMCOptions | number = 2.0,
): StrategySetup {
  // Accept legacy numeric `rr` arg for backwards-compat
  const opts: SMCOptions = typeof options === 'number' ? { rr: options } : options;
  const {
    rr              = 2.0,
    atrPeriod       = 14,
    allowedSessions = DEFAULT_ALLOWED_SESSIONS,
    require4hAlign  = true,
    currentTimeUTC  = new Date(),
  } = opts;

  if (ohlcv_5m.length < 50 || ohlcv_1h.length < 20) {
    return { reason: 'insufficient_data' };
  }

  // ── Session filter ───────────────────────────────────────────────────────────
  if (!isAllowedSession(allowedSessions, currentTimeUTC)) {
    return { reason: 'session_filter' };
  }

  // ── Triple timeframe alignment ───────────────────────────────────────────────
  const trend_4h = (require4hAlign && ohlcv_4h.length >= 20)
    ? getHTFTrend(ohlcv_4h, false)
    : null;
  const trend_1h = getHTFTrend(ohlcv_1h, true);

  if (!trend_1h) return { reason: 'no_htf_trend' };

  if (require4hAlign && trend_4h && trend_4h !== trend_1h) {
    return { reason: 'htf_conflict' };
  }

  const atr = calcATR(ohlcv_5m, atrPeriod);
  if (!atr) return { reason: 'atr_error' };

  // ── FVG scan ─────────────────────────────────────────────────────────────────
  for (let i = ohlcv_5m.length - 2; i > ohlcv_5m.length - 15; i--) {
    const c1 = ohlcv_5m[i - 2];
    const c2 = ohlcv_5m[i - 1];
    const c3 = ohlcv_5m[i];

    const body = Math.abs(c2.close - c2.open);
    if (body < atr * 1.2)  continue;
    if (body > atr * 15.0) continue;

    const contextLimit = 50;
    const lookback = ohlcv_5m.slice(Math.max(0, i - contextLimit), i - 2);
    if (lookback.length < 10) continue;

    const recentHigh  = Math.max(...lookback.map(h => h.high));
    const recentLow   = Math.min(...lookback.map(l => l.low));
    const rangeHeight = recentHigh - recentLow;

    let direction: 'long' | 'short' | null = null;
    let gap_price = 0;
    let sl = 0;

    // Bullish FVG
    if (c2.close > c2.open && c3.low > c1.high && trend_1h === 'bullish') {
      const isDiscount = c2.close < (recentLow + rangeHeight * 0.75);
      if (isDiscount) {
        direction = 'long';
        gap_price = (c3.low + c1.high) / 2;
        sl        = Math.min(c1.low, c2.low);
      }
    }
    // Bearish FVG
    else if (c2.close < c2.open && c3.high < c1.low && trend_1h === 'bearish') {
      const isPremium = c2.close > (recentLow + rangeHeight * 0.25);
      if (isPremium) {
        direction = 'short';
        gap_price = (c3.high + c1.low) / 2;
        sl        = Math.max(c1.high, c2.high);
      }
    }

    if (!direction) continue;

    const risk = Math.abs(gap_price - sl);
    if (risk < atr * MIN_RISK_ATR_MULTIPLE)   continue;
    if (risk < gap_price * MIN_RISK_PRICE_PERCENT) continue;

    const session = getUTCSession(currentTimeUTC.getUTCHours());

    return {
      direction,
      reason:    'accepted',
      price:     gap_price,
      htf_trend: `${trend_1h} (4H: ${trend_4h ?? 'n/a'})`,
      atr,
      sl,
      tp:      gap_price + (risk * rr) * (direction === 'long' ? 1 : -1),
      session,
    };
  }

  return { reason: 'no_setup_found' };
}