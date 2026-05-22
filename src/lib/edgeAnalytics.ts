// ── Edge Analytics & Filter — pure computation, no strategy changes ────────────

// ── Edge Filter v1 ───────────────────────────────────────────────────────────

export interface EdgeFilter {
  enableEdgeFilter: boolean;
  allowedSymbols: string[];
  blockedSymbols: string[];
  allowedSessions: string[];    // UTC session names: Asian, London, NY AM, NY PM, Late
  allowedDirections: string[];  // 'long' | 'short'
  minAIConfidence: number | null;  // 0–10000 scale, null = no min
  maxAIConfidence: number | null;  // 0–10000 scale, null = no max
  requireAIConfidence: boolean;    // if true, block trades with no AI score
}

export const DEFAULT_EDGE_FILTER: EdgeFilter = {
  enableEdgeFilter: false,
  allowedSymbols: [],
  blockedSymbols: [],
  allowedSessions: [],
  allowedDirections: [],
  minAIConfidence: null,
  maxAIConfidence: null,
  requireAIConfidence: false,
};

export const CONSERVATIVE_EDGE_V1_PRESET: EdgeFilter = {
  enableEdgeFilter: true,
  allowedSymbols: ['XRP/USDT', 'ONDO/USDT', 'SOL/USDT'],
  blockedSymbols: ['DOGE/USDT', 'ETH/USDT'],
  allowedSessions: ['London'],
  allowedDirections: ['long'],
  minAIConfidence: 6000,
  maxAIConfidence: 8000,
  requireAIConfidence: true,
};

export interface FilterResult {
  passed: boolean;
  reason: string; // empty if passed
}

export interface FilterPreview {
  totalTrades: number;
  passedCount: number;
  excludedCount: number;
  passedWinRate: number;
  passedNetR: number;
  passedAvgR: number;
  passedProfitFactor: number;
  exclusionReasons: { reason: string; count: number }[];
  warning?: string;
}

/**
 * Evaluate whether a trade/setup passes the edge filter.
 * @param filter - the filter config
 * @param context - trade context (symbol, direction, session, aiConfidence)
 */
export function evaluateFilter(
  filter: EdgeFilter,
  context: {
    symbol: string;
    direction: string;
    session: string;
    aiConfidence?: number;
  },
): FilterResult {
  if (!filter.enableEdgeFilter) return { passed: true, reason: '' };

  // Blocked symbols
  if (filter.blockedSymbols.length > 0 && filter.blockedSymbols.includes(context.symbol)) {
    return { passed: false, reason: `Symbol ${context.symbol} blocked` };
  }

  // Allowed symbols (if list is non-empty, only allow those)
  if (filter.allowedSymbols.length > 0 && !filter.allowedSymbols.includes(context.symbol)) {
    return { passed: false, reason: `Symbol ${context.symbol} not in allowed list` };
  }

  // Session
  if (filter.allowedSessions.length > 0 && !filter.allowedSessions.includes(context.session)) {
    return { passed: false, reason: `Session ${context.session} not allowed` };
  }

  // Direction
  if (filter.allowedDirections.length > 0 && !filter.allowedDirections.includes(context.direction)) {
    return { passed: false, reason: `Direction ${context.direction} not allowed` };
  }

  // AI confidence required but missing
  if (filter.requireAIConfidence && (context.aiConfidence === undefined || context.aiConfidence === null || context.aiConfidence === 0)) {
    return { passed: false, reason: 'AI confidence required but missing' };
  }

  // AI confidence range
  if (filter.minAIConfidence !== null && context.aiConfidence !== undefined && context.aiConfidence !== null && context.aiConfidence > 0) {
    if (context.aiConfidence < filter.minAIConfidence) {
      return { passed: false, reason: `AI confidence ${context.aiConfidence} < min ${filter.minAIConfidence}` };
    }
  }
  if (filter.maxAIConfidence !== null && context.aiConfidence !== undefined && context.aiConfidence !== null && context.aiConfidence > 0) {
    if (context.aiConfidence > filter.maxAIConfidence) {
      return { passed: false, reason: `AI confidence ${context.aiConfidence} > max ${filter.maxAIConfidence}` };
    }
  }

  return { passed: true, reason: '' };
}

/**
 * Preview how many historical trades would pass a given filter.
 */
export function previewFilter(
  filter: EdgeFilter,
  trades: TradeRow[],
): FilterPreview {
  const MIN_SAMPLE = 30;
  const closed = trades.filter(t => t.r !== null && t.r !== undefined);

  const passed: TradeRow[] = [];
  const excluded: TradeRow[] = [];
  const reasonCounts = new Map<string, number>();

  for (const t of closed) {
    const result = evaluateFilter(filter, {
      symbol: t.symbol,
      direction: t.direction,
      session: classifySession(t.opened_at),
      aiConfidence: t.ai_confidence,
    });
    if (result.passed) {
      passed.push(t);
    } else {
      excluded.push(t);
      reasonCounts.set(result.reason, (reasonCounts.get(result.reason) || 0) + 1);
    }
  }

  const passedCount = passed.length;
  const totalTrades = closed.length;
  const wins = passed.filter(t => (t.r ?? 0) > 0).length;
  const winRate = passedCount > 0 ? (wins / passedCount) * 100 : 0;
  const netR = passed.reduce((s, t) => s + (t.r ?? 0), 0);
  const avgR = passedCount > 0 ? netR / passedCount : 0;

  const grossProfit = passed.filter(t => (t.r ?? 0) > 0).reduce((s, t) => s + (t.r ?? 0), 0);
  const grossLoss = Math.abs(passed.filter(t => (t.r ?? 0) < 0).reduce((s, t) => s + (t.r ?? 0), 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;

  const exclusionReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const warning = passedCount > 0 && passedCount < MIN_SAMPLE
    ? `Sample too small (${passedCount} < ${MIN_SAMPLE}). Do not scale risk.` : undefined;

  return {
    totalTrades,
    passedCount,
    excludedCount: excluded.length,
    passedWinRate: Math.round(winRate * 10) / 10,
    passedNetR: Math.round(netR * 100) / 100,
    passedAvgR: Math.round(avgR * 1000) / 1000,
    passedProfitFactor: Math.round(profitFactor * 100) / 100,
    exclusionReasons,
    warning,
  };
}

export interface TradeRow {
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  exit_price: number | null;
  r: number | null;
  opened_at: string;
  is_paper: boolean;
  status: 'open' | 'closed';
  outcome: 1 | 0 | -1 | null;
  ai_confidence?: number;
}

export interface BreakdownRow {
  count: number;
  winRate: number;       // 0–100
  netR: number;          // sum of R values
  avgR: number;          // mean R per trade
  profitFactor: number;  // gross profit / gross loss
  avgWinR: number;       // mean R of winning trades
  avgLossR: number;      // mean R of losing trades
  maxLosingStreak: number;
}

export interface Breakdown {
  key: string;
  label: string;
  row: BreakdownRow;
  warning?: string;      // e.g. "sample size < 30"
}

export interface EdgeRanking {
  best: { key: string; label: string; avgR: number; count: number };
  worst: { key: string; label: string; avgR: number; count: number };
}

export interface EdgeReport {
  bySymbol: Breakdown[];
  bySession: Breakdown[];
  byDirection: Breakdown[];
  byMode: Breakdown[];
  byExitReason: Breakdown[];
  byAiBucket: Breakdown[];
  ranking: {
    symbol: EdgeRanking;
    session: EdgeRanking;
    direction: EdgeRanking;
    exitReason: EdgeRanking;
  };
  overall: BreakdownRow;
}

// ── Session classification ────────────────────────────────────────────────────

export function classifySession(openedAt: string): string {
  const hour = new Date(openedAt).getUTCHours();
  if (hour >= 0 && hour < 7) return 'Asian';
  if (hour >= 7 && hour < 12) return 'London';
  if (hour >= 12 && hour < 17) return 'NY AM';
  if (hour >= 17 && hour < 22) return 'NY PM';
  return 'Late';
}

// ── Exit reason classification ────────────────────────────────────────────────

export function classifyExitReason(r: number | null): string {
  if (r === null || r === undefined) return 'Open';
  if (r > 0.5) return 'TP';
  if (r < -0.5) return 'SL';
  if (r >= -0.01 && r <= 0.01) return 'BE';
  return 'Timeout/Stag';
}

// ── AI confidence bucket ──────────────────────────────────────────────────────

function aiBucket(confidence: number | undefined): string {
  if (confidence === undefined || confidence === null || confidence === 0) return 'No AI';
  if (confidence <= 3000) return '0–30%';
  if (confidence <= 6000) return '30–60%';
  if (confidence <= 8000) return '60–80%';
  return '80–100%';
}

// ── Core computation ───────────────────────────────────────────────────────────

const MIN_SAMPLE = 30;

function computeRow(trades: TradeRow[]): BreakdownRow {
  const closed = trades.filter(t => t.r !== null && t.r !== undefined);
  const count = closed.length;
  if (count === 0) {
    return { count: 0, winRate: 0, netR: 0, avgR: 0, profitFactor: 0, avgWinR: 0, avgLossR: 0, maxLosingStreak: 0 };
  }

  const wins = closed.filter(t => t.r! > 0);
  const losses = closed.filter(t => t.r! < 0);
  const winCount = wins.length;
  const winRate = (winCount / count) * 100;
  const netR = closed.reduce((s, t) => s + (t.r ?? 0), 0);
  const avgR = netR / count;

  const grossProfit = wins.reduce((s, t) => s + (t.r ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.r ?? 0), 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;

  const avgWinR = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLossR = losses.length > 0 ? grossLoss / losses.length : 0;

  let maxCL = 0, curCL = 0;
  for (const t of closed) {
    if ((t.r ?? 0) < 0) { curCL++; maxCL = Math.max(maxCL, curCL); } else { curCL = 0; }
  }

  return {
    count, winRate: Math.round(winRate * 10) / 10,
    netR: Math.round(netR * 100) / 100,
    avgR: Math.round(avgR * 1000) / 1000,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgWinR: Math.round(avgWinR * 100) / 100,
    avgLossR: Math.round(avgLossR * 100) / 100,
    maxLosingStreak: maxCL,
  };
}

function groupBy<T>(items: T[], fn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = fn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

export function analyzeEdge(trades: TradeRow[]): EdgeReport {
  const closed = trades.filter(t => t.r !== null && t.r !== undefined && t.status !== 'open');

  // ── Groupings ───────────────────────────────────────────────────────────────
  const bySym = groupBy(closed, t => t.symbol);
  const bySes = groupBy(closed, t => classifySession(t.opened_at));
  const byDir = groupBy(closed, t => t.direction);
  const byMod = groupBy(closed, t => t.is_paper ? 'Paper' : 'Live');
  const byExt = groupBy(closed, t => classifyExitReason(t.r));
  const byAi  = groupBy(closed, t => aiBucket(t.ai_confidence));

  const sort = (breakdowns: Breakdown[]) =>
    breakdowns.sort((a, b) => b.row.avgR - a.row.avgR);

  const makeBreakdown = (map: Map<string, TradeRow[]>, labelOrder?: string[]): Breakdown[] => {
    const entries = labelOrder
      ? labelOrder.map(k => ({ key: k, trades: map.get(k) || [] }))
      : Array.from(map.entries()).map(([k, v]) => ({ key: k, trades: v }));
    return sort(entries.map(({ key, trades }) => {
      const row = computeRow(trades);
      const warning = row.count > 0 && row.count < MIN_SAMPLE
        ? `Small sample: ${row.count} trades (< ${MIN_SAMPLE})` : undefined;
      return { key, label: key, row, warning };
    }));
  };

  const symbolBreakdown = makeBreakdown(bySym);
  const sessionBreakdown = makeBreakdown(bySes, ['Asian', 'London', 'NY AM', 'NY PM', 'Late']);
  const directionBreakdown = makeBreakdown(byDir, ['long', 'short']);
  const modeBreakdown = makeBreakdown(byMod, ['Live', 'Paper']);
  const exitBreakdown = makeBreakdown(byExt, ['TP', 'BE', 'SL', 'Timeout/Stag']);
  const aiBreakdown = makeBreakdown(byAi, ['No AI', '0–30%', '30–60%', '60–80%', '80–100%']);

  // ── Rankings ────────────────────────────────────────────────────────────────
  const rankFrom = (breakdowns: Breakdown[], excludeSmall: boolean = true): EdgeRanking => {
    const filtered = excludeSmall
      ? breakdowns.filter(b => b.row.count >= MIN_SAMPLE)
      : breakdowns;
    if (filtered.length === 0) {
      return {
        best: { key: '—', label: '—', avgR: 0, count: 0 },
        worst: { key: '—', label: '—', avgR: 0, count: 0 },
      };
    }
    const sorted = [...filtered].sort((a, b) => b.row.avgR - a.row.avgR);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    return {
      best: { key: best.key, label: best.key, avgR: best.row.avgR, count: best.row.count },
      worst: { key: worst.key, label: worst.key, avgR: worst.row.avgR, count: worst.row.count },
    };
  };

  return {
    bySymbol: symbolBreakdown,
    bySession: sessionBreakdown,
    byDirection: directionBreakdown,
    byMode: modeBreakdown,
    byExitReason: exitBreakdown,
    byAiBucket: aiBreakdown,
    ranking: {
      symbol: rankFrom(symbolBreakdown),
      session: rankFrom(sessionBreakdown),
      direction: rankFrom(directionBreakdown),
      exitReason: rankFrom(exitBreakdown),
    },
    overall: computeRow(closed),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Edge Filter Research Mode v2 — sensitivity, presets, stability ────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ── Research presets ──────────────────────────────────────────────────────────

export const RESEARCH_PRESETS: { id: string; label: string; description: string; filter: EdgeFilter }[] = [
  {
    id: 'conservative-v1',
    label: 'A. Conservative v1',
    description: 'XRP, ONDO, SOL · London · long · AI 60–80%',
    filter: CONSERVATIVE_EDGE_V1_PRESET,
  },
  {
    id: 'moderate-v1',
    label: 'B. Moderate v1',
    description: 'XRP, ONDO, SOL · London + NY AM · long · AI 60–80%',
    filter: {
      enableEdgeFilter: true,
      allowedSymbols: ['XRP/USDT', 'ONDO/USDT', 'SOL/USDT'],
      blockedSymbols: ['DOGE/USDT', 'ETH/USDT'],
      allowedSessions: ['London', 'NY AM'],
      allowedDirections: ['long'],
      minAIConfidence: 6000,
      maxAIConfidence: 8000,
      requireAIConfidence: true,
    },
  },
  {
    id: 'expanded-v1',
    label: 'C. Expanded v1',
    description: 'XRP, ONDO, SOL, ADA · London + NY AM + Asian · long · AI ≥ 60%',
    filter: {
      enableEdgeFilter: true,
      allowedSymbols: ['XRP/USDT', 'ONDO/USDT', 'SOL/USDT', 'ADA/USDT'],
      blockedSymbols: ['DOGE/USDT', 'ETH/USDT'],
      allowedSessions: ['London', 'NY AM', 'Asian'],
      allowedDirections: ['long'],
      minAIConfidence: 6000,
      maxAIConfidence: null,
      requireAIConfidence: true,
    },
  },
  {
    id: 'symbol-only',
    label: 'D. Symbol-only',
    description: 'XRP, ONDO, SOL · all sessions · both directions · any AI',
    filter: {
      enableEdgeFilter: true,
      allowedSymbols: ['XRP/USDT', 'ONDO/USDT', 'SOL/USDT'],
      blockedSymbols: ['DOGE/USDT', 'ETH/USDT'],
      allowedSessions: [],
      allowedDirections: [],
      minAIConfidence: null,
      maxAIConfidence: null,
      requireAIConfidence: false,
    },
  },
  {
    id: 'session-only',
    label: 'E. Session-only',
    description: 'All symbols · London · both directions · any AI',
    filter: {
      enableEdgeFilter: true,
      allowedSymbols: [],
      blockedSymbols: [],
      allowedSessions: ['London'],
      allowedDirections: [],
      minAIConfidence: null,
      maxAIConfidence: null,
      requireAIConfidence: false,
    },
  },
];

// ── Contribution analysis ─────────────────────────────────────────────────────

export interface FilterContribution {
  filterName: string;
  removed: boolean; // true = this filter was removed
  tradesAdded: number;
  newAvgR: number;
  newPF: number;
  newWR: number;
  avgRDelta: number;
  pfDelta: number;
  wrDelta: number;
}

export function analyzeFilterContributions(
  baseFilter: EdgeFilter,
  trades: TradeRow[],
): FilterContribution[] {
  const dimensions: { name: string; filter: EdgeFilter }[] = [
    { name: 'Symbol filter', filter: { ...baseFilter, allowedSymbols: [], blockedSymbols: [] } },
    { name: 'Session filter', filter: { ...baseFilter, allowedSessions: [] } },
    { name: 'Direction filter', filter: { ...baseFilter, allowedDirections: [] } },
    { name: 'AI confidence filter', filter: { ...baseFilter, minAIConfidence: null, maxAIConfidence: null, requireAIConfidence: false } },
  ];

  const basePreview = previewFilter(baseFilter, trades);

  return dimensions.map(({ name, filter }) => {
    const preview = previewFilter(filter, trades);
    return {
      filterName: name,
      removed: true,
      tradesAdded: preview.passedCount - basePreview.passedCount,
      newAvgR: preview.passedAvgR,
      newPF: preview.passedProfitFactor,
      newWR: preview.passedWinRate,
      avgRDelta: Math.round((preview.passedAvgR - basePreview.passedAvgR) * 1000) / 1000,
      pfDelta: Math.round((preview.passedProfitFactor - basePreview.passedProfitFactor) * 100) / 100,
      wrDelta: Math.round((preview.passedWinRate - basePreview.passedWinRate) * 10) / 10,
    };
  });
}

// ── Stability metrics ─────────────────────────────────────────────────────────

export interface StabilityMetrics {
  tradeCount: number;
  avgR: number;
  pf: number;
  maxLosingStreak: number;
  longestFlatPeriod: number;    // max consecutive trades with cumulative R ≤ 0
  monteCarloMedian: number;
  monteCarloWorst5: number;
  sampleConfidenceScore: number; // 0–100
}

function monteCarloR(rValues: number[], runs: number = 1000): { median: number; worst5: number } {
  if (rValues.length === 0) return { median: 0, worst5: 0 };
  const finalBalances: number[] = [];
  for (let r = 0; r < runs; r++) {
    // Shuffle and accumulate
    const shuffled = [...rValues].sort(() => Math.random() - 0.5);
    let sum = 0;
    for (const v of shuffled) sum += v;
    finalBalances.push(sum);
  }
  const sorted = [...finalBalances].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const worst5 = sorted[Math.floor(n * 0.05)];
  return { median, worst5 };
}

export function computeStabilityMetrics(filter: EdgeFilter, trades: TradeRow[]): StabilityMetrics {
  const preview = previewFilter(filter, trades);
  // Use all filtered trades for the closed list
  const closed = trades.filter(t => t.r !== null && t.r !== undefined);
  const passed = closed.filter(t => {
    const result = evaluateFilter(filter, {
      symbol: t.symbol, direction: t.direction,
      session: classifySession(t.opened_at), aiConfidence: t.ai_confidence,
    });
    return result.passed;
  });

  const rValues = passed.map(t => t.r!);
  const { median, worst5 } = monteCarloR(rValues);

  // Longest flat period: max consecutive trades where cumulative R ≤ 0
  let longestFlat = 0;
  let flatCount = 0;
  let cumulativeR = 0;
  for (const r of rValues) {
    cumulativeR += r;
    if (cumulativeR <= 0) {
      flatCount++;
      if (flatCount > longestFlat) longestFlat = flatCount;
    } else {
      flatCount = 0;
      cumulativeR = 0;
    }
  }

  // Max losing streak from R values
  let maxCL = 0, curCL = 0;
  for (const r of rValues) {
    if (r < 0) { curCL++; maxCL = Math.max(maxCL, curCL); } else { curCL = 0; }
  }

  // Confidence score heuristic
  let confidence = 50; // neutral start
  if (rValues.length >= 100) confidence += 20;
  else if (rValues.length >= 50) confidence += 10;
  else if (rValues.length >= 30) confidence += 5;
  else confidence -= 20;

  if (preview.passedAvgR > 0.1) confidence += 15;
  else if (preview.passedAvgR > 0) confidence += 5;
  else confidence -= 10;

  if (preview.passedProfitFactor > 2.0) confidence += 10;
  else if (preview.passedProfitFactor > 1.3) confidence += 5;
  else confidence -= 5;

  if (maxCL <= 5) confidence += 5;
  else if (maxCL > 10) confidence -= 5;

  if (longestFlat <= 10) confidence += 5;
  else if (longestFlat > 20) confidence -= 5;

  confidence = Math.max(0, Math.min(100, confidence));

  return {
    tradeCount: rValues.length,
    avgR: preview.passedAvgR,
    pf: preview.passedProfitFactor,
    maxLosingStreak: maxCL,
    longestFlatPeriod: longestFlat,
    monteCarloMedian: Math.round(median * 100) / 100,
    monteCarloWorst5: Math.round(worst5 * 100) / 100,
    sampleConfidenceScore: confidence,
  };
}

// ── Outlier detection ─────────────────────────────────────────────────────────

export interface OutlierImpact {
  topRemoved: number;
  remainingTrades: number;
  newAvgR: number;
  newPF: number;
  avgRDelta: number;
  pfDelta: number;
  warning?: string;
}

export function detectOutlierImpact(filter: EdgeFilter, trades: TradeRow[]): OutlierImpact[] {
  const closed = trades.filter(t => t.r !== null && t.r !== undefined);
  const passed = closed.filter(t => {
    const result = evaluateFilter(filter, {
      symbol: t.symbol, direction: t.direction,
      session: classifySession(t.opened_at), aiConfidence: t.ai_confidence,
    });
    return result.passed;
  });

  const rValues = passed.map(t => t.r!).sort((a, b) => b - a); // descending

  const computeImpact = (removeTop: number): OutlierImpact => {
    const remaining = rValues.slice(removeTop);
    const sum = remaining.reduce((a, v) => a + v, 0);
    const avgR = remaining.length > 0 ? sum / remaining.length : 0;
    const wins = remaining.filter(r => r > 0);
    const losses = remaining.filter(r => r < 0);
    const grossProfit = wins.reduce((a, r) => a + r, 0);
    const grossLoss = Math.abs(losses.reduce((a, r) => a + r, 0));
    const pf = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;

    const originalAvgR = rValues.reduce((a, v) => a + v, 0) / rValues.length;

    const avgRDelta = originalAvgR - avgR;
    const pfDelta = pf - (previewFilter(filter, trades).passedProfitFactor);

    let warning: string | undefined;
    if (recalculateAvgWithoutTop(rValues, removeTop) <= 0 && originalAvgR > 0) {
      warning = `Edge collapses when top ${removeTop} trade(s) removed — may depend on outliers.`;
    }

    return {
      topRemoved: removeTop,
      remainingTrades: remaining.length,
      newAvgR: Math.round(avgR * 1000) / 1000,
      newPF: Math.round(pf * 100) / 100,
      avgRDelta: Math.round(avgRDelta * 1000) / 1000,
      pfDelta: Math.round(pfDelta * 100) / 100,
      warning,
    };
  };

  return [1, 3, 5].map(n => {
    if (rValues.length <= n) return null;
    return computeImpact(n);
  }).filter(Boolean) as OutlierImpact[];
}

function recalculateAvgWithoutTop(sortedR: number[], removeTop: number): number {
  const remaining = sortedR.slice(removeTop);
  if (remaining.length === 0) return 0;
  return remaining.reduce((a, v) => a + v, 0) / remaining.length;
}

// ── Preset comparison table helper ────────────────────────────────────────────

export interface PresetComparison {
  presetId: string;
  label: string;
  stability: StabilityMetrics;
  outlier: OutlierImpact[];
  contributions: FilterContribution[];
}

export function compareAllPresets(trades: TradeRow[]): PresetComparison[] {
  return RESEARCH_PRESETS.map(preset => ({
    presetId: preset.id,
    label: preset.label,
    stability: computeStabilityMetrics(preset.filter, trades),
    outlier: detectOutlierImpact(preset.filter, trades),
    contributions: analyzeFilterContributions(preset.filter, trades),
  }));
}
