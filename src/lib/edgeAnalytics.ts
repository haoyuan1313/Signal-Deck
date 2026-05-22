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
