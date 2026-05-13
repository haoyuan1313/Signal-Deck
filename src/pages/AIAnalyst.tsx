import { useStore } from '../store/useStore';
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Loader2,
  BarChart2,
  Clock,
  Target,
  Zap,
  Code2,
  Copy,
  Check,
  RefreshCcw,
  ShieldAlert,
  Activity,
  ArrowRight,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  category: 'entry' | 'exit' | 'filter' | 'risk' | 'timing';
  priority: 'critical' | 'high' | 'medium';
  title: string;
  reasoning: string;
  currentValue: string;
  proposedValue: string;
  expectedImpact: string;
  confidence: number;
  accepted: boolean | null;
}

interface AnalystReport {
  summary: string;
  diagnosis: string;
  dataQuality: 'sufficient' | 'limited' | 'insufficient';
  tradeCount: number;
  suggestions: Suggestion[];
  codePrompt: string;
  rawAnalysis: string;
}

interface StoredReport {
  id: string;
  created_at: string;
  trade_count: number;
  summary: string;
  diagnosis: string;
  data_quality: string;
  suggestions: Suggestion[];
  code_prompt: string;
  win_rate: string;
  net_r: string;
  profit_factor?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_TRADES_REQUIRED = 20; // FIX 1: hard gate — AXIOM's own rules forbid sub-20

const CATEGORY_LABELS: Record<string, string> = {
  entry: 'Entry Logic',
  exit: 'Exit Rules',
  filter: 'Signal Filter',
  risk: 'Risk Management',
  timing: 'Timing',
};

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  high: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  medium: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
};

const CATEGORY_COLORS: Record<string, string> = {
  entry: 'text-emerald-400',
  exit: 'text-rose-400',
  filter: 'text-blue-400',
  risk: 'text-amber-400',
  timing: 'text-purple-400',
};

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are AXIOM — a Senior Quantitative Trading Analyst with 17 years of experience specialising in Smart Money Concepts (SMC), ICT methodology, and algorithmic strategy optimisation.

YOUR IDENTITY:
- You have a direct, no-nonsense communication style. You do not sugarcoat.
- You form your own conviction based on data. You will not be talked into a view that the data does not support.
- You prioritise statistical significance over gut feel. If sample size is insufficient, you say so bluntly.
- You never suggest more than 3 changes at once. Too many changes at once make it impossible to isolate cause and effect.
- You are skeptical of "fixes" that address symptoms rather than root causes.
- Your confidence ratings are honest: below 60% = you're guessing, 60-75% = probable, 75-90% = likely, 90%+ = near certain.

HARD RULES YOU NEVER BREAK:
1. Never suggest a change based on fewer than 20 trades in that category. State "insufficient data" and stop.
2. Never recommend more than 3 suggestions per analysis.
3. Always cite the specific metric that drove each suggestion.
4. If the strategy is fundamentally sound, say so. Do not invent problems to seem useful.
5. If the data shows the strategy is broken, say so clearly — do not be diplomatic about it.
6. Never suggest increasing risk as a solution to a poor win rate.
7. Consider session timing, HTF alignment, and trade duration as separate diagnostic axes.

SMC DOMAIN KNOWLEDGE:
- FVG entries should be evaluated by: displacement size (ATR multiple), time-of-day, HTF trend alignment, and FVG mitigation depth.
- Break-even arming at +1R is standard but may be too aggressive in ranging markets.
- Stagnation exits are critical in choppy conditions but may exit too early in trending ones.
- HTF trend detection via EMA slope is a lagging indicator — consider adding momentum confirmation.
- Signal rejection reasons reveal WHERE the strategy is too restrictive vs too permissive.
- Asian session (00:00-07:00 UTC) is low liquidity — FVG setups frequently fail here due to fake displacement.
- London open (07:00-09:00 UTC) and NY open (13:30-14:30 UTC) are the highest probability SMC windows.
- If win rate after 2+ loss streak differs from baseline, the bot may be entering during unfavourable regimes.
- Profit factor below 1.2 with win rate above 50% suggests reward is being cut too early.
- If avgMinutesOnWins < avgMinutesOnLosses, trades are being let run when losing and cut when winning — structural problem.
- R standard deviation above 1.5 suggests inconsistent setup quality — entry filter too loose.

HOURLY HEATMAP INSTRUCTIONS:
The hourlyHeatmap shows 1-hour UTC buckets (00:00, 01:00 ... 23:00). Key windows to flag:
- 07:00-09:00 UTC = London open (highest SMC probability)
- 13:30-15:30 UTC = NY open (second highest)
- 00:00-06:00 UTC = Asian session (lowest, avoid FVG entries here)
If any 1h bucket has ≥5 trades and WR below 35%, flag it explicitly.

SEQUENCE ANALYSIS INSTRUCTIONS:
You have access to recentTradeSequence — the last 30 trades in chronological order. Analyse for:
a) Loss clusters at specific UTC hours or sessions → timing filter recommendation
b) Symbol-specific loss runs → asset may need different parameters
c) BE trades (be=true, r=0) after prior loss → BE trigger killing winners prematurely
d) Short duration losses (<30 min) → stop hunts, entry too early in FVG
e) Long duration losses (>120 min) → stagnation exit not triggering correctly
f) Win rate divergence between sessions → session filter needed

OUTPUT FORMAT — You must respond with valid JSON matching this exact structure:
{
  "summary": "2-3 sentence blunt executive summary of what the data shows",
  "diagnosis": "3-5 sentence root cause analysis. What is actually wrong (or right)?",
  "dataQuality": "sufficient" | "limited" | "insufficient",
  "suggestions": [
    {
      "id": "unique_string",
      "category": "entry" | "exit" | "filter" | "risk" | "timing",
      "priority": "critical" | "high" | "medium",
      "title": "Short action title",
      "reasoning": "Specific data point that drives this. Cite the number.",
      "currentValue": "What the code does now",
      "proposedValue": "Exactly what should change",
      "expectedImpact": "Expected quantitative effect e.g. +5-8% win rate",
      "confidence": 0-100
    }
  ],
  "codePrompt": "A precise, developer-ready prompt that instructs AI to rewrite the relevant strategy function. Include exact parameter values, logic conditions, and which function to modify in strategy.ts."
}

IMPORTANT: Return ONLY valid JSON. No markdown fences, no preamble, no explanation outside the JSON.`;
}

function buildUserPrompt(stats: any, previousReport?: StoredReport | null): string {
  const hasPrev = !!previousReport;
  const prevContext = hasPrev ? `

PREVIOUS AXIOM ANALYSIS (${new Date(previousReport!.created_at).toLocaleDateString()} — ${previousReport!.trade_count} trades at time):
Summary: ${previousReport!.summary}
Diagnosis: ${previousReport!.diagnosis}
Suggestions made:
${previousReport!.suggestions.map((s: any, i: number) => `${i + 1}. [${s.category}] ${s.title} (${s.confidence}% confidence)\n   Proposed: ${s.proposedValue}`).join('\n')}

CONTINUITY INSTRUCTIONS:
- Compare current data against previous analysis. State clearly if anything changed.
- If a previously flagged issue persists, acknowledge it and say whether it worsened or improved.
- If a previous suggestion is no longer valid, explain why with data.
- Do NOT invent new problems if the data is materially unchanged from last session.
- Acknowledge directly if your assessment has not changed significantly.` : '';

  return `Analyse this SMC trading bot's full performance data — including raw trade sequence, session timing, streak patterns, and signal funnel — and provide your assessment.${hasPrev ? prevContext : ''}

CURRENT PERFORMANCE DATA:
${JSON.stringify(stats, null, 2)}

Pay particular attention to:
1. Time-of-day clustering — are losses concentrated in specific UTC hours or sessions?
2. Streak patterns — what happens to win rate after consecutive losses or wins?
3. Symbol-specific behaviour — is underperformance isolated to one asset?
4. Duration patterns — do winning trades exit faster or slower than losers?
5. Signal funnel efficiency — is the strategy too restrictive or too permissive?

Give me your honest assessment. Cite specific numbers for every claim. If data is too thin, say so explicitly.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUTCSession(hour: number): string {
  if (hour >= 0 && hour < 7) return 'Asian';
  if (hour >= 7 && hour < 12) return 'London';
  if (hour >= 12 && hour < 17) return 'NY-AM';
  if (hour >= 17 && hour < 21) return 'NY-PM';
  return 'Late';
}

function computeStreaks(sorted: any[]) {
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let curWin = 0;
  let curLoss = 0;
  const postLossResults: number[] = [];
  const postWinResults: number[] = [];

  sorted.forEach((t, i) => {
    const r = t.r || 0;
    if (r > 0) {
      if (curLoss >= 2 && i < sorted.length - 1) postLossResults.push(sorted[i + 1]?.r || 0);
      curWin++;
      curLoss = 0;
      maxWinStreak = Math.max(maxWinStreak, curWin);
    } else if (r < 0) {
      if (curWin >= 2 && i < sorted.length - 1) postWinResults.push(sorted[i + 1]?.r || 0);
      curLoss++;
      curWin = 0;
      maxLossStreak = Math.max(maxLossStreak, curLoss);
    } else {
      curWin = 0;
      curLoss = 0;
    }
  });

  const postLossWinRate = postLossResults.length > 0
    ? ((postLossResults.filter(r => r > 0).length / postLossResults.length) * 100).toFixed(1)
    : 'N/A';
  const postWinWinRate = postWinResults.length > 0
    ? ((postWinResults.filter(r => r > 0).length / postWinResults.length) * 100).toFixed(1)
    : 'N/A';

  return {
    maxConsecutiveWins: maxWinStreak,
    maxConsecutiveLosses: maxLossStreak,
    winRateAfterLossStreak2Plus: postLossWinRate + (postLossResults.length > 0 ? `% (${postLossResults.length} samples)` : ''),
    winRateAfterWinStreak2Plus: postWinWinRate + (postWinResults.length > 0 ? `% (${postWinResults.length} samples)` : ''),
  };
}

// ─── FIX 5: Delta helpers ─────────────────────────────────────────────────────

function parsePct(s: string) { return parseFloat(s.replace('%', '')) || 0; }
function parseR(s: string)   { return parseFloat(s.replace('R', '')) || 0; }

function DeltaBadge({ current, prev, higherIsBetter = true, suffix = '' }: {
  current: number; prev: number; higherIsBetter?: boolean; suffix?: string;
}) {
  const delta = current - prev;
  const abs   = Math.abs(delta).toFixed(1);
  if (Math.abs(delta) < 0.05) return (
    <span className="flex items-center gap-0.5 text-[10px] text-zinc-500 font-mono">
      <Minus size={9} />0{suffix}
    </span>
  );
  const positive = higherIsBetter ? delta > 0 : delta < 0;
  return (
    <span className={cn(
      'flex items-center gap-0.5 text-[10px] font-mono font-bold',
      positive ? 'text-emerald-400' : 'text-rose-400'
    )}>
      {delta > 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {abs}{suffix}
    </span>
  );
}

// ─── FIX 6: Elapsed timer hook ────────────────────────────────────────────────

function useElapsedTimer(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (running) {
      startRef.current = Date.now();
      setElapsed(0);
      const t = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }, 1000);
      return () => clearInterval(t);
    } else {
      setElapsed(0);
    }
  }, [running]);

  return elapsed;
}

// ─── FIX 2+3: Improved buildAnalysisStats ─────────────────────────────────────

function buildAnalysisStats(trades: any[], signals: any[]) {
  const closed = trades.filter(t => t.status === 'closed');
  const open   = trades.filter(t => t.status === 'open');
  if (closed.length === 0) return null;

  const sorted = [...closed].sort(
    (a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime()
  );

  const wins      = sorted.filter(t => (t.r || 0) > 0);
  const losses    = sorted.filter(t => (t.r || 0) < 0);
  const breakevens = sorted.filter(t => t.r === 0);
  const rValues   = sorted.map(t => t.r || 0);
  const netR      = rValues.reduce((a, b) => a + b, 0);
  const avgR      = netR / rValues.length;
  const rVariance = rValues.reduce((acc, r) => acc + Math.pow(r - avgR, 2), 0) / rValues.length;
  const rStdDev   = Math.sqrt(rVariance);

  const longs     = sorted.filter(t => t.direction === 'long');
  const shorts    = sorted.filter(t => t.direction === 'short');

  // Session breakdown
  const sessionStats: Record<string, { total: number; wins: number; netR: number }> = {};
  sorted.forEach(t => {
    const session = getUTCSession(new Date(t.opened_at).getUTCHours());
    if (!sessionStats[session]) sessionStats[session] = { total: 0, wins: 0, netR: 0 };
    sessionStats[session].total++;
    if ((t.r || 0) > 0) sessionStats[session].wins++;
    sessionStats[session].netR += t.r || 0;
  });

  const sessionBreakdown: Record<string, any> = {};
  Object.entries(sessionStats).forEach(([s, d]) => {
    sessionBreakdown[s] = {
      trades: d.total,
      winRate: d.total > 0 ? ((d.wins / d.total) * 100).toFixed(1) + '%' : 'N/A',
      netR: d.netR.toFixed(2),
    };
  });

  // FIX 3: 1-hour buckets instead of 4-hour — far more actionable for SMC timing
  const hourlyBuckets: Record<string, { total: number; wins: number }> = {};
  sorted.forEach(t => {
    const hour   = new Date(t.opened_at).getUTCHours();
    const bucket = `${String(hour).padStart(2, '0')}:00`;
    if (!hourlyBuckets[bucket]) hourlyBuckets[bucket] = { total: 0, wins: 0 };
    hourlyBuckets[bucket].total++;
    if ((t.r || 0) > 0) hourlyBuckets[bucket].wins++;
  });

  const hourlyHeatmap: Record<string, string> = {};
  Object.entries(hourlyBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([bucket, data]) => {
      hourlyHeatmap[bucket] = data.total > 0
        ? `${((data.wins / data.total) * 100).toFixed(0)}% WR (${data.total} trades)`
        : 'no trades';
    });

  // Duration buckets
  const avgMinsAll    = sorted.reduce((a, t) => a + (t.bars_held || 0), 0) / sorted.length;
  const avgMinsWins   = wins.length > 0   ? wins.reduce((a, t) => a + (t.bars_held || 0), 0) / wins.length     : 0;
  const avgMinsLosses = losses.length > 0 ? losses.reduce((a, t) => a + (t.bars_held || 0), 0) / losses.length : 0;

  const durationBuckets = {
    '<30min':   { t: 0, w: 0 },
    '30-75min': { t: 0, w: 0 },
    '75-150min':{ t: 0, w: 0 },
    '>150min':  { t: 0, w: 0 },
  };
  sorted.forEach(t => {
    const mins = t.bars_held || 0;
    const key  = mins < 30 ? '<30min' : mins < 75 ? '30-75min' : mins < 150 ? '75-150min' : '>150min';
    durationBuckets[key as keyof typeof durationBuckets].t++;
    if ((t.r || 0) > 0) durationBuckets[key as keyof typeof durationBuckets].w++;
  });

  const durationAnalysis: Record<string, string> = {};
  Object.entries(durationBuckets).forEach(([range, { t, w }]) => {
    durationAnalysis[range] = t > 0 ? `${((w / t) * 100).toFixed(0)}% WR (${t} trades)` : 'no trades';
  });

  // Symbol breakdown
  const symbolBreakdown: Record<string, any> = {};
  [...new Set(sorted.map(t => t.symbol))].forEach(sym => {
    const st    = sorted.filter(t => t.symbol === sym);
    const sw    = st.filter(t => (t.r || 0) > 0);
    const sr    = st.map(t => t.r || 0);
    const snr   = sr.reduce((a, b) => a + b, 0);
    symbolBreakdown[sym] = {
      total: st.length,
      winRate: ((sw.length / st.length) * 100).toFixed(1) + '%',
      netR: snr.toFixed(2),
      avgR: (snr / sr.length).toFixed(3),
      avgDurationMins: (st.reduce((a, t) => a + (t.bars_held || 0), 0) / st.length).toFixed(0),
    };
  });

  // BE analysis
  const beArmed       = sorted.filter(t => t.be_armed);
  const beArmedWins   = beArmed.filter(t => (t.r || 0) >= 0);
  const notBeArmed    = sorted.filter(t => !t.be_armed);
  const notBeArmedWins = notBeArmed.filter(t => (t.r || 0) > 0);

  const streaks = computeStreaks(sorted);

  // FIX 2: cap sequence at 30 (was 50) — enough for pattern detection, saves tokens
  const recentSequence = sorted.slice(-30).map(t => ({
    sym:       t.symbol,
    dir:       t.direction,
    r:         parseFloat((t.r || 0).toFixed(2)),
    mins:      t.bars_held || 0,
    be:        t.be_armed,
    openHourUTC: new Date(t.opened_at).getUTCHours(),
    session:   getUTCSession(new Date(t.opened_at).getUTCHours()),
    closedAt:  t.closed_at ? new Date(t.closed_at).toISOString().slice(0, 16) : null,
  }));

  // Signal funnel — de-duplicated counts only (not raw signals array)
  const NOISE_REASONS = new Set(['no_setup_found', 'no_data', 'insufficient_data', 'no_sweep_detected', 'none', '']);
  const REASON_LABELS: Record<string, string> = {
    no_htf_trend: 'No HTF Trend',
    atr_error:    'ATR/Volatility Error',
    risk_too_low: 'Risk Too Low',
    risk_too_small:'Risk Too Small',
    htf2_mismatch: '4H Mismatch',
    session_filter:'Session Filtered',
  };

  const signalEvents: Record<string, Set<number>> = {};
  let rejectionCount = 0;
  const rejectionReasons: Record<string, number> = {};

  signals.forEach(s => {
    if (NOISE_REASONS.has(s.reason)) return;
    const hourBucket = Math.floor(new Date(s.created_at).getTime() / (1000 * 60 * 60));
    const eventKey   = `${s.symbol}:${s.reason}`;
    if (!signalEvents[eventKey]) signalEvents[eventKey] = new Set();
    if (!signalEvents[eventKey].has(hourBucket)) {
      signalEvents[eventKey].add(hourBucket);
      if (s.reason !== 'accepted') {
        rejectionCount++;
        const label = REASON_LABELS[s.reason] || s.reason.replace(/_/g, ' ');
        rejectionReasons[label] = (rejectionReasons[label] || 0) + 1;
      }
    }
  });

  const acceptedCount       = sorted.length + open.length;
  const totalRelevantEvents = acceptedCount + rejectionCount;

  const grossProfit = wins.reduce((a, t) => a + (t.r || 0), 0);
  const grossLoss   = Math.abs(losses.reduce((a, t) => a + (t.r || 0), 0));

  return {
    overview: {
      totalClosedTrades: sorted.length,
      openPositions:     open.length,
      winRate:           ((wins.length / sorted.length) * 100).toFixed(1) + '%',
      netR:              netR.toFixed(2),
      avgRPerTrade:      avgR.toFixed(3),
      rStdDev:           rStdDev.toFixed(3),
      maxSingleWin:      Math.max(...rValues).toFixed(2) + 'R',
      maxSingleLoss:     Math.min(...rValues).toFixed(2) + 'R',
      breakevens:        breakevens.length,
      profitFactor:      grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'infinite',
    },
    directionBreakdown: {
      longs:  { count: longs.length,  winRate: longs.length  > 0 ? ((longs.filter(t => (t.r||0)>0).length  / longs.length)  * 100).toFixed(1) + '%' : 'N/A', netR: longs.reduce((a,t)=>a+(t.r||0),0).toFixed(2) },
      shorts: { count: shorts.length, winRate: shorts.length > 0 ? ((shorts.filter(t => (t.r||0)>0).length / shorts.length) * 100).toFixed(1) + '%' : 'N/A', netR: shorts.reduce((a,t)=>a+(t.r||0),0).toFixed(2) },
    },
    sessionBreakdown,
    hourlyHeatmap,
    durationAnalysis,
    tradeManagement: {
      avgMinutesHeld:   avgMinsAll.toFixed(0),
      avgMinutesOnWins: avgMinsWins.toFixed(0),
      avgMinutesOnLosses: avgMinsLosses.toFixed(0),
      beArmed:    { count: beArmed.length,    winRate: beArmed.length    > 0 ? ((beArmedWins.length    / beArmed.length)    * 100).toFixed(1) + '%' : 'N/A' },
      notBeArmed: { count: notBeArmed.length, winRate: notBeArmed.length > 0 ? ((notBeArmedWins.length / notBeArmed.length) * 100).toFixed(1) + '%' : 'N/A' },
    },
    streakAnalysis: streaks,
    symbolBreakdown,
    // FIX 2: send counts only — not the raw signals array (which could be 500+ items)
    signalFunnel: {
      acceptedCount,
      rejectionCount,
      filterAcceptanceRate: totalRelevantEvents > 0 ? ((acceptedCount / totalRelevantEvents) * 100).toFixed(1) + '%' : '0%',
      rejectionReasons,
      note: 'Unique 1h-deduplicated events. Raw signal array excluded to reduce payload.',
    },
    recentTradeSequence: recentSequence,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SuggestionCardProps {
  s: Suggestion;
  onAccept: () => void;
  onReject: () => void;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({ s, onAccept, onReject }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    className={cn(
      'border rounded-2xl overflow-hidden transition-all',
      s.accepted === true  && 'border-emerald-500/40 bg-emerald-500/5',
      s.accepted === false && 'border-zinc-700/40 bg-zinc-900/30 opacity-50',
      s.accepted === null  && 'border-zinc-800 bg-zinc-900'
    )}
  >
    <div className="flex items-start justify-between gap-4 p-5 pb-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={cn('text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border', PRIORITY_STYLES[s.priority])}>
          {s.priority}
        </span>
        <span className={cn('text-[10px] font-bold uppercase tracking-wider', CATEGORY_COLORS[s.category])}>
          {CATEGORY_LABELS[s.category]}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] text-zinc-500 font-mono">confidence</span>
        <span className={cn('text-sm font-black font-mono', s.confidence >= 75 ? 'text-emerald-400' : s.confidence >= 60 ? 'text-amber-400' : 'text-rose-400')}>
          {s.confidence}%
        </span>
      </div>
    </div>

    <div className="px-5 pb-4 space-y-3">
      <h4 className="font-bold text-zinc-100 text-sm">{s.title}</h4>
      <p className="text-xs text-zinc-400 leading-relaxed">{s.reasoning}</p>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-3">
          <p className="text-[9px] text-rose-400/70 font-bold uppercase tracking-widest mb-1">Current</p>
          <p className="text-xs font-mono text-zinc-300">{s.currentValue}</p>
        </div>
        <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-3">
          <p className="text-[9px] text-emerald-400/70 font-bold uppercase tracking-widest mb-1">Proposed</p>
          <p className="text-xs font-mono text-zinc-300">{s.proposedValue}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <Target size={12} className="text-zinc-600" />
        <span>Expected: <span className="text-zinc-300 font-medium">{s.expectedImpact}</span></span>
      </div>
    </div>

    {s.accepted === null && (
      <div className="flex border-t border-zinc-800">
        <button onClick={onReject} className="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all">
          <XCircle size={14} /> Dismiss
        </button>
        <div className="w-px bg-zinc-800" />
        <button onClick={onAccept} className="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold text-emerald-400 hover:bg-emerald-500/10 transition-all">
          <CheckCircle2 size={14} /> Accept & Generate Code
        </button>
      </div>
    )}
    {s.accepted === true && (
      <div className="flex items-center justify-center gap-2 border-t border-emerald-500/20 py-2.5 text-xs font-bold text-emerald-400">
        <CheckCircle2 size={14} /> Accepted — code prompt ready below
      </div>
    )}
  </motion.div>
);

interface CodePromptPanelProps {
  prompt: string;
  accepted: Suggestion[];
}

const CodePromptPanel: React.FC<CodePromptPanelProps> = ({ prompt, accepted }) => {
  const [copied, setCopied] = useState(false);

  const fullPrompt = `You are modifying a Smart Money Concepts (SMC) crypto trading bot strategy.

ACCEPTED ANALYST SUGGESTIONS:
${accepted.map((s, i) => `${i + 1}. [${s.category.toUpperCase()}] ${s.title}
   Current: ${s.currentValue}
   Change to: ${s.proposedValue}
   Reasoning: ${s.reasoning}`).join('\n\n')}

STRATEGY CODE MODIFICATION INSTRUCTIONS:
${prompt}

CONSTRAINTS:
- Only modify the specified functions in strategy.ts
- Keep all function signatures and exports identical
- Do not change any logic not mentioned above
- Return the complete modified function(s), not just the diff
- After modifying strategy.ts, the backtester (backtester.ts) will use it automatically via the detectSMCSetup import

Please rewrite the relevant function(s) now.`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-950 border border-emerald-500/20 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-2">
          <Code2 size={16} className="text-emerald-400" />
          <span className="text-sm font-bold text-zinc-200">Vibe Coding Prompt</span>
          <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">
            Ready for AI Studio
          </span>
        </div>
        <button onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-xs font-bold text-zinc-300 transition-all">
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy Prompt'}
        </button>
      </div>
      <pre className="p-5 text-[11px] text-zinc-400 font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto custom-scrollbar">
        {fullPrompt}
      </pre>
    </motion.div>
  );
};

// ─── Supabase memory helpers ──────────────────────────────────────────────────

const AXIOM_SESSION_KEY = 'axiom_last_report';

async function loadPreviousReport(): Promise<StoredReport | null> {
  try {
    const raw = localStorage.getItem(AXIOM_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredReport;
  } catch { return null; }
}

async function saveReport(report: AnalystReport, stats: any): Promise<void> {
  try {
    const stored: StoredReport = {
      id:           Date.now().toString(),
      created_at:   new Date().toISOString(),
      trade_count:  report.tradeCount,
      summary:      report.summary,
      diagnosis:    report.diagnosis,
      data_quality: report.dataQuality,
      suggestions:  report.suggestions,
      code_prompt:  report.codePrompt,
      win_rate:     stats?.overview?.winRate || 'N/A',
      net_r:        stats?.overview?.netR    || 'N/A',
      profit_factor: stats?.overview?.profitFactor || 'N/A',
    };
    localStorage.setItem(AXIOM_SESSION_KEY, JSON.stringify(stored));
  } catch { /* localStorage unavailable */ }
}

// ─── FIX 4: Report export helper ─────────────────────────────────────────────

function exportReport(report: AnalystReport, stats: any) {
  const lines = [
    `# AXIOM Analysis — ${new Date().toLocaleDateString()}`,
    `**Trades:** ${report.tradeCount} | **WR:** ${stats?.overview?.winRate} | **Net R:** ${stats?.overview?.netR}R | **PF:** ${stats?.overview?.profitFactor}`,
    '',
    '## Executive Summary',
    report.summary,
    '',
    '## Root Cause Diagnosis',
    report.diagnosis,
    '',
    '## Recommendations',
    ...report.suggestions.map((s, i) =>
      `### ${i + 1}. ${s.title} [${s.priority.toUpperCase()}]\n` +
      `**Category:** ${CATEGORY_LABELS[s.category]} | **Confidence:** ${s.confidence}%\n\n` +
      `${s.reasoning}\n\n` +
      `- Current: \`${s.currentValue}\`\n` +
      `- Proposed: \`${s.proposedValue}\`\n` +
      `- Expected: ${s.expectedImpact}`
    ),
    '',
    '## Code Modification Prompt',
    '```',
    report.codePrompt,
    '```',
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `axiom-report-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AIAnalystPage() {
  const { trades, signals } = useStore();
  const [phase, setPhase]               = useState<'idle' | 'loading' | 'report' | 'error'>('idle');
  const [report, setReport]             = useState<AnalystReport | null>(null);
  const [previousReport, setPreviousReport] = useState<StoredReport | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const reportRef                       = useRef<HTMLDivElement>(null);

  // FIX 6: real elapsed timer instead of fake cycling messages
  const elapsed = useElapsedTimer(phase === 'loading');

  const stats        = buildAnalysisStats(trades, signals);
  const closedCount  = trades.filter(t => t.status === 'closed').length;
  const canRun       = closedCount >= MIN_TRADES_REQUIRED; // FIX 1

  useEffect(() => {
    loadPreviousReport().then(prev => { if (prev) setPreviousReport(prev); });
  }, []);

  const runAnalysis = async () => {
    if (!stats || !canRun) return;
    setPhase('loading');
    setReport(null);
    setError(null);

    try {
      const response = await fetch('/api/ai-analyst', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          prompt:           buildUserPrompt(stats, previousReport),
          systemInstruction: buildSystemPrompt(),
        }),
      });

      const responseData = await response.json();
      if (!response.ok)        throw new Error(responseData.error || `Server error ${response.status}`);
      if (!responseData.text)  throw new Error('AXIOM returned an empty response. Try again.');

      let parsed: any;
      try {
        parsed = JSON.parse(responseData.text.replace(/```json|```/g, '').trim());
      } catch {
        throw new Error('AXIOM returned malformed JSON. This occasionally happens — try again.');
      }

      const suggestions: Suggestion[] = (parsed.suggestions || []).map((s: any) => ({ ...s, accepted: null }));

      const newReport: AnalystReport = {
        summary:     parsed.summary     || '',
        diagnosis:   parsed.diagnosis   || '',
        dataQuality: parsed.dataQuality || 'limited',
        tradeCount:  closedCount,
        suggestions,
        codePrompt:  parsed.codePrompt  || '',
        rawAnalysis: responseData.text,
      };

      setReport(newReport);
      setPhase('report');
      await saveReport(newReport, stats);
      const saved = await loadPreviousReport();
      if (saved) setPreviousReport(saved);
      setTimeout(() => reportRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      setError(err.message || 'Analysis failed');
      setPhase('error');
    }
  };

  const handleAccept = (id: string) => setReport(r => r ? ({ ...r, suggestions: r.suggestions.map(s => s.id === id ? { ...s, accepted: true }  : s) }) : r);
  const handleReject = (id: string) => setReport(r => r ? ({ ...r, suggestions: r.suggestions.map(s => s.id === id ? { ...s, accepted: false } : s) }) : r);

  const acceptedSuggestions = report?.suggestions.filter(s => s.accepted === true)  || [];
  const pendingSuggestions   = report?.suggestions.filter(s => s.accepted === null)  || [];

  // FIX 5: compute deltas vs previous session
  const prevWR = previousReport ? parsePct(previousReport.win_rate)    : null;
  const prevNR = previousReport ? parseR(previousReport.net_r)         : null;
  const prevPF = previousReport ? parseFloat(previousReport.profit_factor || '0') : null;
  const curWR  = stats ? parsePct(stats.overview.winRate)              : 0;
  const curNR  = stats ? parseR(stats.overview.netR)                   : 0;
  const curPF  = stats ? parseFloat(stats.overview.profitFactor)       : 0;

  return (
    <div className="space-y-8 pb-16 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-500/10 rounded-xl border border-purple-500/20">
            <Brain className="text-purple-400" size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">AXIOM — AI Trading Analyst</h1>
            <p className="text-zinc-500 text-xs mt-0.5">Senior Quantitative Analyst · SMC/ICT Specialist · 17 Years Experience</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest overflow-x-auto pb-1">
          {['Live Data', 'AI Analysis', 'Suggestions', 'Review', 'Code Prompt', 'Backtest', 'Deploy'].map((step, i) => (
            <div key={step} className="flex items-center gap-1.5 shrink-0">
              <span className={cn('px-2 py-1 rounded-md border',
                i === 0 ? 'border-emerald-500/30 text-emerald-500 bg-emerald-500/5' :
                i === 1 ? 'border-purple-500/30 text-purple-400 bg-purple-500/5' :
                i <= 4  ? 'border-blue-500/20 text-blue-400 bg-blue-500/5' :
                'border-zinc-700 text-zinc-600 bg-zinc-900'
              )}>{step}</span>
              {i < 6 && <ArrowRight size={10} className="text-zinc-700" />}
            </div>
          ))}
        </div>
      </div>

      {/* Previous Session Banner — now with delta numbers */}
      {previousReport && phase !== 'report' && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-4 bg-purple-500/5 border border-purple-500/15 rounded-xl">
          <div className="w-2 h-2 rounded-full bg-purple-400 mt-1.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-purple-400 uppercase tracking-widest mb-1">
              Previous AXIOM session — {new Date(previousReport.created_at).toLocaleDateString()} at {new Date(previousReport.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{previousReport.summary}</p>
            {/* FIX 5: delta badges vs prior session */}
            <div className="flex gap-4 mt-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-600">WR</span>
                <span className="text-[10px] font-mono text-zinc-400">{previousReport.win_rate}</span>
                {prevWR !== null && <DeltaBadge current={curWR} prev={prevWR} suffix="%" />}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-600">Net R</span>
                <span className="text-[10px] font-mono text-zinc-400">{previousReport.net_r}R</span>
                {prevNR !== null && <DeltaBadge current={curNR} prev={prevNR} suffix="R" />}
              </div>
              {previousReport.profit_factor && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-600">PF</span>
                  <span className="text-[10px] font-mono text-zinc-400">{previousReport.profit_factor}</span>
                  {prevPF !== null && <DeltaBadge current={curPF} prev={prevPF} />}
                </div>
              )}
              <span className="text-[10px] text-purple-500 font-bold">Next analysis compares against this</span>
            </div>
          </div>
          <button onClick={() => { localStorage.removeItem(AXIOM_SESSION_KEY); setPreviousReport(null); }}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 font-bold uppercase tracking-wider shrink-0 transition-colors">
            Clear
          </button>
        </motion.div>
      )}

      {/* Data Overview Cards */}
      {stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Closed Trades',  value: stats.overview.totalClosedTrades, icon: Activity, color: 'text-zinc-300' },
              { label: 'Win Rate',       value: stats.overview.winRate, icon: TrendingUp,  color: parsePct(stats.overview.winRate) >= 50 ? 'text-emerald-400' : 'text-rose-400' },
              { label: 'Net R',          value: stats.overview.netR + 'R', icon: BarChart2, color: parseR(stats.overview.netR) >= 0 ? 'text-emerald-400' : 'text-rose-400' },
              { label: 'Profit Factor',  value: stats.overview.profitFactor, icon: Zap,    color: parseFloat(stats.overview.profitFactor) >= 1.5 ? 'text-emerald-400' : parseFloat(stats.overview.profitFactor) >= 1 ? 'text-amber-400' : 'text-rose-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} className="text-zinc-600" />
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{label}</span>
                </div>
                <p className={cn('text-xl font-black font-mono', color)}>{value}</p>
              </div>
            ))}
          </div>
          {Object.keys(stats.sessionBreakdown).length > 0 && (
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest">Sessions:</span>
              {Object.entries(stats.sessionBreakdown).map(([session, data]: [string, any]) => {
                const wr = parsePct(data.winRate);
                return (
                  <div key={session} className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px]',
                    wr >= 55 ? 'bg-emerald-500/5 border-emerald-500/20' :
                    wr >= 40 ? 'bg-zinc-900 border-zinc-700' :
                    'bg-rose-500/5 border-rose-500/20'
                  )}>
                    <span className="font-bold text-zinc-400">{session}</span>
                    <span className={cn('font-black font-mono', wr >= 55 ? 'text-emerald-400' : wr >= 40 ? 'text-zinc-300' : 'text-rose-400')}>{data.winRate}</span>
                    <span className="text-zinc-600 text-[10px]">{data.trades}t</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* FIX 1: Hard gate at MIN_TRADES_REQUIRED */}
      {closedCount < MIN_TRADES_REQUIRED && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
          <ShieldAlert size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-400">Insufficient data</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              AXIOM requires at least <span className="text-zinc-300 font-bold">{MIN_TRADES_REQUIRED} closed trades</span> to form
              a statistically valid opinion. You have <span className="text-zinc-300 font-bold">{closedCount}</span>.
              Any analysis below this threshold is noise, not signal.
            </p>
          </div>
        </div>
      )}

      {/* Analyse Button */}
      {phase !== 'report' && (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={runAnalysis}
            disabled={phase === 'loading' || !canRun}
            className={cn(
              'flex items-center gap-3 px-10 py-4 rounded-2xl font-black text-sm tracking-wide transition-all',
              phase === 'loading' || !canRun
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/20 active:scale-95'
            )}
          >
            {phase === 'loading' ? (
              <><Loader2 size={18} className="animate-spin" /> Analysing…</>
            ) : (
              <><Brain size={18} /> Request AXIOM Analysis</>
            )}
          </button>

          {/* FIX 6: real elapsed counter instead of fake cycling messages */}
          {phase === 'loading' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
              Waiting for AXIOM… {elapsed}s
              {elapsed > 20 && <span className="text-zinc-600">(large datasets take 30–60s)</span>}
            </motion.div>
          )}

          {phase === 'error' && error && (
            <div className="flex items-center gap-2 text-rose-400 text-sm">
              <XCircle size={16} />{error}
            </div>
          )}
        </div>
      )}

      {/* Report */}
      <AnimatePresence>
        {phase === 'report' && report && (
          <motion.div ref={reportRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">

            {/* AXIOM Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                <span className="text-xs font-bold text-purple-400 uppercase tracking-widest">AXIOM Report</span>
                <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-bold border',
                  report.dataQuality === 'sufficient' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                  report.dataQuality === 'limited'    ? 'bg-amber-500/10  text-amber-400  border-amber-500/20'  :
                  'bg-rose-500/10 text-rose-400 border-rose-500/20'
                )}>Data: {report.dataQuality}</span>
              </div>
              <div className="flex items-center gap-2">
                {previousReport && (
                  <span className="text-[10px] text-purple-400 font-mono bg-purple-500/5 border border-purple-500/20 px-2 py-1 rounded">
                    vs. {new Date(previousReport.created_at).toLocaleDateString()}
                  </span>
                )}
                {/* FIX 4: export button */}
                <button onClick={() => exportReport(report, stats)}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg hover:bg-zinc-800">
                  <Download size={12} /> Export MD
                </button>
                <button onClick={runAnalysis}
                  className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                  <RefreshCcw size={12} /> Re-analyse
                </button>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
              <div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Executive Summary</p>
                <p className="text-sm text-zinc-200 leading-relaxed font-medium">{report.summary}</p>
              </div>
              <div className="border-t border-zinc-800 pt-4">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Root Cause Diagnosis</p>
                <p className="text-sm text-zinc-400 leading-relaxed">{report.diagnosis}</p>
              </div>
            </div>

            {/* Data panels */}
            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Streak Patterns</p>
                  <div className="space-y-2">
                    {[
                      { label: 'Max Win Streak',        value: stats.streakAnalysis.maxConsecutiveWins },
                      { label: 'Max Loss Streak',       value: stats.streakAnalysis.maxConsecutiveLosses },
                      { label: 'WR After 2+ Losses',    value: stats.streakAnalysis.winRateAfterLossStreak2Plus },
                      { label: 'WR After 2+ Wins',      value: stats.streakAnalysis.winRateAfterWinStreak2Plus },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-500">{label}</span>
                        <span className="text-[11px] font-bold font-mono text-zinc-200">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Duration Buckets</p>
                  <div className="space-y-2">
                    {Object.entries(stats.durationAnalysis).map(([range, result]: [string, any]) => {
                      const wr = parseInt(result);
                      return (
                        <div key={range} className="flex items-center justify-between">
                          <span className="text-[11px] text-zinc-500 font-mono">{range}</span>
                          <span className={cn('text-[11px] font-bold font-mono',
                            wr >= 55 ? 'text-emerald-400' : wr >= 40 ? 'text-zinc-300' : 'text-rose-400'
                          )}>{result}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Trade Management</p>
                  <div className="space-y-2">
                    {[
                      { label: 'Avg Hold (all)',    value: stats.tradeManagement.avgMinutesHeld + 'm' },
                      { label: 'Avg Hold (wins)',   value: stats.tradeManagement.avgMinutesOnWins + 'm' },
                      { label: 'Avg Hold (losses)', value: stats.tradeManagement.avgMinutesOnLosses + 'm' },
                      { label: 'BE Armed WR',       value: stats.tradeManagement.beArmed.winRate },
                      { label: 'Non-BE WR',         value: stats.tradeManagement.notBeArmed.winRate },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-500">{label}</span>
                        <span className="text-[11px] font-bold font-mono text-zinc-200">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* FIX 3: Trade sequence — now shows 30 instead of 50 (labelled clearly) */}
            {stats && stats.recentTradeSequence.length > 0 && (
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-900/50">
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-zinc-500" />
                    <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">
                      Trade Sequence Fed to AXIOM
                    </span>
                    <span className="text-[10px] text-zinc-600">(last {stats.recentTradeSequence.length})</span>
                  </div>
                </div>
                <div className="p-4 overflow-x-auto">
                  <div className="flex gap-1.5 flex-wrap">
                    {stats.recentTradeSequence.map((t: any, i: number) => (
                      <div key={i}
                        title={`${t.sym} ${t.dir} | ${t.session} ${t.openHourUTC}:00 UTC | ${t.mins}m | ${t.r > 0 ? '+' : ''}${t.r}R${t.be ? ' (BE)' : ''}`}
                        className={cn(
                          'flex flex-col items-center justify-center w-9 h-9 rounded-lg text-[9px] font-black cursor-help transition-all hover:scale-110 border',
                          t.r > 0 ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' :
                          t.r < 0 ? 'bg-rose-500/15 border-rose-500/30 text-rose-400' :
                          'bg-zinc-800 border-zinc-700 text-zinc-500'
                        )}>
                        <span>{t.r > 0 ? '+' : ''}{t.r}</span>
                        <span className="text-[7px] opacity-60">{t.session.slice(0, 2)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-3 font-mono">
                    Hover tiles for details · Green = win · Red = loss · Grey = BE · Label = session
                  </p>
                </div>
              </div>
            )}

            {/* Suggestions */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">
                  Recommendations ({report.suggestions.length})
                </h3>
                <span className="text-[10px] text-zinc-600 font-mono">
                  {acceptedSuggestions.length} accepted · {pendingSuggestions.length} pending
                </span>
              </div>
              <div className="space-y-4">
                {report.suggestions.map(s => (
                  <SuggestionCard key={s.id} s={s} onAccept={() => handleAccept(s.id)} onReject={() => handleReject(s.id)} />
                ))}
              </div>
            </div>

            {/* Code Prompt */}
            <AnimatePresence>
              {acceptedSuggestions.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <ChevronRight size={14} className="text-emerald-400" />
                    <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
                      Step 2 — Copy prompt into AI Studio / Cursor
                    </p>
                  </div>
                  <CodePromptPanel prompt={report.codePrompt} accepted={acceptedSuggestions} />
                  <div className="flex items-start gap-2 p-3 bg-zinc-900 border border-zinc-800 rounded-xl">
                    <Clock size={14} className="text-zinc-600 mt-0.5 shrink-0" />
                    <p className="text-[11px] text-zinc-500">
                      After pasting this into AI Studio and getting the rewritten code,
                      update <code className="text-zinc-300">src/lib/strategy.ts</code> then go to{' '}
                      <span className="text-blue-400 font-bold">Backtester</span> to validate before deploying.
                    </p>
                  </div>
                </div>
              )}
            </AnimatePresence>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}