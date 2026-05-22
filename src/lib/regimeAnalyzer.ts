// ── Regime Validation Layer v1 — pure research, no strategy changes ──────────

import type { TradeRow } from './edgeAnalytics';
import { classifySession } from './edgeAnalytics';

// ── Regime types ──────────────────────────────────────────────────────────────

export type MarketRegime =
  | 'trending'
  | 'ranging'
  | 'high_volatility'
  | 'low_volatility'
  | 'displacement_impulse'
  | 'low_liquidity_chop';

export interface RegimeRow {
  regime: MarketRegime;
  label: string;
  count: number;
  winRate: number;
  avgR: number;
  pf: number;
  maxLosingStreak: number;
  avgHoldBars: number;
  avgRiskPct: number; // average |sl - entry| / entry
}

export interface RegimeBreakdown {
  regime: MarketRegime;
  subFilter: string; // e.g. 'London' or 'All'
  label: string;
  count: number;
  avgR: number;
  pf: number;
  winRate: number;
}

export interface RegimeOutlierImpact {
  regime: MarketRegime;
  label: string;
  originalAvgR: number;
  withoutTop1: number;
  withoutTop3: number;
  warning?: string;
}

export interface RegimeFilterPreview {
  filterLabel: string;
  description: string;
  tradesPassed: number;
  tradesExcluded: number;
  estimatedAvgR: number;
  estimatedPF: number;
}

// ── Classification engine ─────────────────────────────────────────────────────

/**
 * Classify a trade's market regime using available trade metadata.
 * No candle data required — uses proxies derived from trade characteristics.
 *
 * Proxies used:
 * - riskPct = |sl_init - entry| / entry   → volatility proxy
 * - |r| magnitude                          → displacement proxy
 * - session context                        → liquidity proxy
 * - AI confidence                          → clarity proxy
 * - win/loss streak clustering             → trending/ranging proxy
 */
export function classifyRegime(trade: TradeRow): MarketRegime {
  const riskPct = trade.entry > 0 ? Math.abs((trade.entry - (trade as any).sl_init || trade.entry)) / trade.entry : 0;
  const rAbs = trade.r !== null ? Math.abs(trade.r) : 0;
  const session = classifySession(trade.opened_at);
  const aiConf = (trade as any).ai_confidence || 0; // eslint-disable-line

  // Displacement impulse: large R magnitude (>1.5R in either direction)
  if (rAbs > 1.5 && riskPct > 0.005) return 'displacement_impulse';

  // High volatility: risk distance > 1% of entry price
  if (riskPct > 0.01) return 'high_volatility';

  // Low volatility: risk distance < 0.2% of entry
  if (riskPct < 0.002) return 'low_volatility';

  // Low liquidity chop: Asian or Late session with small risk and losses
  if ((session === 'Asian' || session === 'Late') && riskPct < 0.005 && (trade.r ?? 0) < 0) {
    return 'low_liquidity_chop';
  }

  // Low liquidity chop: Asian/Late with small AI confidence
  if ((session === 'Asian' || session === 'Late') && aiConf < 3000 && aiConf > 0) {
    return 'low_liquidity_chop';
  }

  // Trending: London/NY AM session with moderate risk and any result
  if ((session === 'London' || session === 'NY AM') && riskPct >= 0.002) {
    return 'trending';
  }

  // Default: ranging
  return 'ranging';
}

// ── Regime labels ─────────────────────────────────────────────────────────────

const REGIME_LABELS: Record<MarketRegime, string> = {
  trending: 'Trending',
  ranging: 'Ranging',
  high_volatility: 'High Volatility',
  low_volatility: 'Low Volatility',
  displacement_impulse: 'Displacement Impulse',
  low_liquidity_chop: 'Low Liquidity Chop',
};

export function getRegimeLabel(regime: MarketRegime): string {
  return REGIME_LABELS[regime];
}

// ── Regime analysis ───────────────────────────────────────────────────────────

export function analyzeRegimes(trades: TradeRow[]): RegimeRow[] {
  const closed = trades.filter(t => t.r !== null && t.r !== undefined);
  const byRegime = new Map<MarketRegime, TradeRow[]>();

  for (const t of closed) {
    const regime = classifyRegime(t);
    if (!byRegime.has(regime)) byRegime.set(regime, []);
    byRegime.get(regime)!.push(t);
  }

  const order: MarketRegime[] = ['trending', 'displacement_impulse', 'high_volatility', 'ranging', 'low_volatility', 'low_liquidity_chop'];

  return order
    .filter(r => byRegime.has(r))
    .map(regime => {
      const rows = byRegime.get(regime)!;
      const rValues = rows.map(t => t.r!);
      const wins = rValues.filter(r => r > 0);
      const losses = rValues.filter(r => r < 0);
      const sum = rValues.reduce((a, v) => a + v, 0);
      const avgR = sum / rows.length;
      const grossProfit = wins.reduce((a, r) => a + r, 0);
      const grossLoss = Math.abs(losses.reduce((a, r) => a + r, 0));
      const pf = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;

      let maxCL = 0, curCL = 0;
      for (const r of rValues) {
        if (r < 0) { curCL++; maxCL = Math.max(maxCL, curCL); } else { curCL = 0; }
      }

      const avgRiskPct = rows.reduce((s, t) => {
        const sl = (t as any).sl_init || t.entry;
        return s + Math.abs(t.entry - sl) / t.entry;
      }, 0) / rows.length;

      return {
        regime,
        label: REGIME_LABELS[regime],
        count: rows.length,
        winRate: Math.round((wins.length / rows.length) * 1000) / 10,
        avgR: Math.round(avgR * 1000) / 1000,
        pf: Math.round(pf * 100) / 100,
        maxLosingStreak: maxCL,
        avgHoldBars: Math.round(rows.reduce((s, t) => s + ((t as any).bars_held || 0), 0) / rows.length),
        avgRiskPct: Math.round(avgRiskPct * 10000) / 100,
      };
    });
}

// ── London regime breakdown ───────────────────────────────────────────────────

export function analyzeLondonRegimes(trades: TradeRow[]): RegimeBreakdown[] {
  const london = trades.filter(t => classifySession(t.opened_at) === 'London');
  const byRegime = new Map<MarketRegime, TradeRow[]>();

  for (const t of london) {
    if (t.r === null) continue;
    const regime = classifyRegime(t);
    if (!byRegime.has(regime)) byRegime.set(regime, []);
    byRegime.get(regime)!.push(t);
  }

  return Array.from(byRegime.entries()).map(([regime, rows]) => {
    const rValues = rows.map(t => t.r!);
    const wins = rValues.filter(r => r > 0);
    const sum = rValues.reduce((a, v) => a + v, 0);
    const avgR = sum / rows.length;
    const grossProfit = wins.reduce((a, r) => a + r, 0);
    const losses = rValues.filter(r => r < 0);
    const grossLoss = Math.abs(losses.reduce((a, r) => a + r, 0));
    const pf = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;

    return {
      regime,
      subFilter: 'London',
      label: `London + ${REGIME_LABELS[regime]}`,
      count: rows.length,
      avgR: Math.round(avgR * 1000) / 1000,
      pf: Math.round(pf * 100) / 100,
      winRate: Math.round((wins.length / rows.length) * 1000) / 10,
    };
  }).sort((a, b) => b.avgR - a.avgR);
}

// ── Outlier robustness per regime ─────────────────────────────────────────────

export function analyzeRegimeOutliers(trades: TradeRow[]): RegimeOutlierImpact[] {
  const closed = trades.filter(t => t.r !== null && t.r !== undefined);
  const byRegime = new Map<MarketRegime, TradeRow[]>();

  for (const t of closed) {
    const regime = classifyRegime(t);
    if (!byRegime.has(regime)) byRegime.set(regime, []);
    byRegime.get(regime)!.push(t);
  }

  return Array.from(byRegime.entries()).map(([regime, rows]) => {
    const rValues = rows.map(t => t.r!).sort((a, b) => b - a);
    const originalAvgR = rValues.reduce((a, v) => a + v, 0) / rValues.length;

    const withoutTop1 = rValues.length > 1
      ? rValues.slice(1).reduce((a, v) => a + v, 0) / (rValues.length - 1) : originalAvgR;
    const withoutTop3 = rValues.length > 3
      ? rValues.slice(3).reduce((a, v) => a + v, 0) / (rValues.length - 3) : originalAvgR;

    const warning = (originalAvgR > 0 && withoutTop3 <= 0)
      ? `Edge collapses without top 3 trades` : (originalAvgR > 0 && withoutTop1 <= 0)
      ? `Edge depends on top 1 trade` : undefined;

    return {
      regime,
      label: REGIME_LABELS[regime],
      originalAvgR: Math.round(originalAvgR * 1000) / 1000,
      withoutTop1: Math.round(withoutTop1 * 1000) / 1000,
      withoutTop3: Math.round(withoutTop3 * 1000) / 1000,
      warning,
    };
  });
}

// ── Regime-aware filter previews ──────────────────────────────────────────────

export function previewRegimeFilters(trades: TradeRow[]): RegimeFilterPreview[] {
  const closed = trades.filter(t => t.r !== null && t.r !== undefined);
  const total = closed.length;

  const filters: { label: string; description: string; predicate: (t: TradeRow) => boolean }[] = [
    {
      label: 'Trending Only',
      description: 'Exclude ranging, chop, and low-vol regimes',
      predicate: t => classifyRegime(t) === 'trending' || classifyRegime(t) === 'displacement_impulse',
    },
    {
      label: 'Displacement Only',
      description: 'Trade only displacement impulse setups',
      predicate: t => classifyRegime(t) === 'displacement_impulse',
    },
    {
      label: 'Avoid Low-Vol Chop',
      description: 'Exclude low volatility and low liquidity chop',
      predicate: t => classifyRegime(t) !== 'low_volatility' && classifyRegime(t) !== 'low_liquidity_chop',
    },
    {
      label: 'High Vol + Trending',
      description: 'Trade only high vol and trending regimes',
      predicate: t => classifyRegime(t) === 'high_volatility' || classifyRegime(t) === 'trending',
    },
  ];

  return filters.map(({ label, description, predicate }) => {
    const passed = closed.filter(predicate);
    const rValues = passed.map(t => t.r!);
    const wins = rValues.filter(r => r > 0);
    const losses = rValues.filter(r => r < 0);
    const sum = rValues.reduce((a, v) => a + v, 0);
    const avgR = passed.length > 0 ? sum / passed.length : 0;
    const grossProfit = wins.reduce((a, r) => a + r, 0);
    const grossLoss = Math.abs(losses.reduce((a, r) => a + r, 0));
    const pf = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;

    return {
      filterLabel: label,
      description,
      tradesPassed: passed.length,
      tradesExcluded: total - passed.length,
      estimatedAvgR: Math.round(avgR * 1000) / 1000,
      estimatedPF: Math.round(pf * 100) / 100,
    };
  });
}
