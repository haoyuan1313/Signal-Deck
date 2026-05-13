import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wand2, Send, Loader2, CheckCircle2, XCircle, AlertTriangle,
  HelpCircle, Eye, ShieldAlert, Settings, Play, Power, Clock,
  TrendingUp, ArrowRight, RefreshCcw
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';

// ─── Types ────────────────────────────────────────────────────────────────────

type ParsedIntent = {
  command: { kind: string; [k: string]: any };
  explanation: string;
  requires_confirmation: boolean;
};

type HistoryEntry =
  | { type: 'user'; text: string; ts: number }
  | { type: 'parsed'; intent: ParsedIntent; ts: number; status: 'pending' | 'confirmed' | 'rejected' | 'executed' | 'failed' }
  | { type: 'result'; ok: boolean; data?: any; error?: string; ts: number; forKind: string }
  | { type: 'system'; text: string; ts: number };

type ScreenerResult = {
  symbol: string;
  net_r: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  bars: number;
  error?: string;
};

type Recommendation = {
  id: string;
  source: 'manual' | 'autopilot';
  ranked_symbols: ScreenerResult[];
  proposed_top_3: string[];
  current_symbols: string[];
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  notes?: string;
  created_at: string;
};

type AutopilotState = {
  enabled: boolean;
  interval_hours: number;
  last_run_at?: string;
  last_run_status?: string;
  last_run_message?: string;
};

const WRITE_KINDS = new Set([
  'set_symbols', 'set_rr', 'set_risk_percent', 'add_symbol', 'remove_symbol',
  'run_screener', 'set_autopilot', 'set_autopilot_interval',
]);

const SUGGESTIONS = [
  "Find me the best 3 symbols to trade",
  "Turn on autopilot",
  "What's my win rate this month?",
  "Show open trades",
  "Set RR to 2.5",
  "What's my balance?",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function commandIcon(kind: string) {
  if (kind.startsWith('get_')) return Eye;
  if (kind === 'clarify') return HelpCircle;
  if (kind === 'reject') return ShieldAlert;
  if (kind === 'run_screener') return Play;
  if (kind.startsWith('set_autopilot')) return Power;
  return Settings;
}

function commandColor(intent: ParsedIntent) {
  if (intent.command.kind === 'reject') return 'rose';
  if (intent.command.kind === 'clarify') return 'amber';
  if (WRITE_KINDS.has(intent.command.kind)) return 'amber';
  return 'blue';
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: 'emerald' | 'rose' | 'amber' }) {
  const color = accent === 'emerald' ? 'text-emerald-400'
    : accent === 'rose' ? 'text-rose-400'
    : accent === 'amber' ? 'text-amber-400'
    : 'text-zinc-200';
  return (
    <div className="bg-zinc-950/50 px-3 py-2 rounded-lg border border-zinc-800/50">
      <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">{label}</div>
      <div className={cn('text-sm font-black font-mono mt-0.5', color)}>{String(value)}</div>
    </div>
  );
}

function formatResult(kind: string, data: any): React.ReactNode {
  if (!data) return null;
  if (data.error) return <p className="text-rose-400 text-xs">{data.error}</p>;

  switch (kind) {
    case 'get_win_rate':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Window" value={data.window} />
          <Stat label="Win Rate" value={`${data.win_rate_pct}%`} accent={data.win_rate_pct >= 50 ? 'emerald' : 'rose'} />
          <Stat label="Trades" value={`${data.wins}W / ${data.losses}L`} />
          <Stat label="Net R" value={`${data.net_r >= 0 ? '+' : ''}${data.net_r}R`} accent={data.net_r >= 0 ? 'emerald' : 'rose'} />
        </div>
      );
    case 'get_open_trades':
      if (!data.count) return <p className="text-zinc-500 text-xs italic">No open positions.</p>;
      return (
        <div className="space-y-1.5">
          {data.trades.map((t: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs font-mono bg-zinc-950/50 px-3 py-2 rounded-lg border border-zinc-800">
              <span className="text-zinc-300 font-bold">{t.symbol}</span>
              <span className={cn('font-bold uppercase', t.direction === 'long' ? 'text-emerald-400' : 'text-rose-400')}>{t.direction}</span>
              <span className="text-zinc-500">@{Number(t.entry).toFixed(4)}</span>
              {t.be_armed && <span className="text-amber-400 text-[9px] font-bold">BE</span>}
            </div>
          ))}
        </div>
      );
    case 'get_balance':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Equity" value={`$${Number(data.equity || 0).toFixed(2)}`} accent="emerald" />
          <Stat label="Mode" value={data.is_testnet ? 'Testnet' : 'Mainnet'} accent={data.is_testnet ? 'amber' : 'emerald'} />
        </div>
      );
    case 'get_strategy_config':
      return (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap gap-1.5">
            {(data.symbols || []).map((s: string) => (
              <span key={s} className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded font-mono text-[10px]">{s}</span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-800">
            <Stat label="RR" value={`${data.rr}R`} />
            <Stat label="Risk" value={`${data.risk_percent}%`} />
            <Stat label="Mode" value={data.paper_trading ? 'Paper' : 'Live'} accent={data.paper_trading ? 'amber' : 'rose'} />
            <Stat label="State" value={data.paused ? 'Paused' : 'Active'} accent={data.paused ? 'rose' : 'emerald'} />
          </div>
        </div>
      );
    case 'run_screener':
      // Compact summary — full panel above renders details
      return (
        <div className="text-xs text-zinc-300">
          {data.is_no_change ? (
            <span className="text-zinc-500 italic">No change — top 3 already matches current watchlist.</span>
          ) : (
            <>
              Proposed: <span className="font-mono font-bold text-emerald-400">{data.proposed_top_3.join(', ')}</span>
              <br />
              <span className="text-[10px] text-zinc-500">Pending recommendation created — see panel above.</span>
            </>
          )}
        </div>
      );
    default:
      return (
        <div className="text-xs font-mono text-emerald-400">
          ✓ Applied · {Object.entries(data).filter(([k]) => k !== 'applied').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')}
        </div>
      );
  }
}

// ─── Screener Panel ───────────────────────────────────────────────────────────

function ScreenerPanel({ onRun, onApprove, onReject, busyRun }: {
  onRun: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  busyRun: boolean;
}) {
  const [autopilot, setAutopilot] = useState<AutopilotState | null>(null);
  const [pendingRec, setPendingRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [apRes, recRes] = await Promise.all([
        fetch('/api/openclaw/autopilot'),
        fetch('/api/openclaw/recommendations?status=pending'),
      ]);
      const ap = await apRes.json();
      const recs = await recRes.json();
      setAutopilot(ap);
      setPendingRec(recs.recommendations?.[0] || null);
    } catch (e) {
      console.error('ScreenerPanel refresh failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const toggleAutopilot = async () => {
    if (!autopilot) return;
    const next = !autopilot.enabled;
    setAutopilot({ ...autopilot, enabled: next });
    try {
      await fetch('/api/openclaw/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      refresh();
    } catch (e) {
      setAutopilot({ ...autopilot, enabled: !next });
    }
  };

  const setInterval_ = async (hours: number) => {
    if (!autopilot) return;
    setAutopilot({ ...autopilot, interval_hours: hours });
    try {
      await fetch('/api/openclaw/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval_hours: hours }),
      });
      refresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleApprove = async (id: string) => {
    await onApprove(id);
    refresh();
  };
  const handleReject = async (id: string) => {
    await onReject(id);
    refresh();
  };

  const handleRun = async () => {
    await onRun();
    refresh();
  };

  if (loading) {
    return (
      <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-4 flex items-center gap-2 text-zinc-500 text-xs">
        <Loader2 size={12} className="animate-spin" /> Loading screener state…
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-hidden">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-zinc-800/50">
        <div className="flex items-center gap-3">
          <div className={cn(
            'p-2 rounded-lg border',
            autopilot?.enabled
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-zinc-800 border-zinc-700 text-zinc-500'
          )}>
            <TrendingUp size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-100">Symbol Screener</h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              Backtests top-volume USDT pairs · Ranks by net R · You approve every change
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={busyRun}
            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 rounded-lg text-xs font-bold transition-all active:scale-95"
          >
            {busyRun ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
            {busyRun ? 'Screening…' : 'Run Now'}
          </button>
        </div>
      </div>

      {/* Autopilot row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-zinc-800/50 bg-zinc-950/30">
        <div className="flex items-center gap-3 flex-1">
          <button
            onClick={toggleAutopilot}
            className={cn(
              'relative w-10 h-5 rounded-full transition-all',
              autopilot?.enabled ? 'bg-emerald-500' : 'bg-zinc-700'
            )}
          >
            <div className={cn(
              'absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-md',
              autopilot?.enabled ? 'left-5' : 'left-0.5'
            )} />
          </button>
          <div>
            <div className="text-xs font-bold text-zinc-200">
              Autopilot {autopilot?.enabled ? <span className="text-emerald-400">ON</span> : <span className="text-zinc-500">OFF</span>}
            </div>
            <div className="text-[10px] text-zinc-600">
              Auto-screens every {autopilot?.interval_hours}h · Notifies on Telegram · You still approve
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {[6, 12, 24, 48].map(h => (
            <button
              key={h}
              onClick={() => setInterval_(h)}
              className={cn(
                'px-2.5 py-1 rounded text-[10px] font-bold transition-all',
                autopilot?.interval_hours === h
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-transparent'
              )}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {/* Last run line */}
      {autopilot?.last_run_at && (
        <div className="px-4 py-2 border-b border-zinc-800/50 flex items-center gap-2 text-[10px] text-zinc-500">
          <Clock size={10} />
          Last run: {new Date(autopilot.last_run_at).toLocaleString()} · {autopilot.last_run_message}
        </div>
      )}

      {/* Pending recommendation */}
      {pendingRec ? (
        <div className="p-4 bg-amber-500/5 border-t border-amber-500/20">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Pending Recommendation</span>
                <span className="text-[9px] text-zinc-500 font-mono">
                  {pendingRec.source} · {new Date(pendingRec.created_at).toLocaleTimeString()}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                <span className="font-mono">{pendingRec.current_symbols.join(', ') || '(none)'}</span>
                <ArrowRight size={12} className="text-amber-400" />
                <span className="font-mono font-bold text-emerald-400">{pendingRec.proposed_top_3.join(', ')}</span>
              </div>
            </div>
          </div>

          {/* Top-N table */}
          <div className="bg-zinc-950/50 rounded-lg border border-zinc-800/50 overflow-hidden mb-3">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-zinc-800/30 text-zinc-500 uppercase tracking-widest font-bold">
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-right">Net R</th>
                  <th className="px-3 py-2 text-right">WR</th>
                  <th className="px-3 py-2 text-right">PF</th>
                  <th className="px-3 py-2 text-right">Trades</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {pendingRec.ranked_symbols.slice(0, 5).map((r, i) => (
                  <tr key={r.symbol} className={cn(i < 3 && 'bg-emerald-500/5')}>
                    <td className="px-3 py-2 font-mono text-zinc-600">{i + 1}</td>
                    <td className="px-3 py-2 font-mono font-bold text-zinc-200">{r.symbol}</td>
                    <td className={cn('px-3 py-2 text-right font-mono font-bold',
                      r.net_r > 0 ? 'text-emerald-400' : r.net_r < 0 ? 'text-rose-400' : 'text-zinc-500')}>
                      {r.net_r >= 0 ? '+' : ''}{r.net_r}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-400">{r.win_rate}%</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-400">{r.profit_factor}</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-500">{r.total_trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleReject(pendingRec.id)}
              className="flex-1 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded-lg transition-colors flex items-center justify-center gap-2 border border-zinc-800"
            >
              <XCircle size={12} /> Reject
            </button>
            <button
              onClick={() => handleApprove(pendingRec.id)}
              className="flex-1 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors flex items-center justify-center gap-2 border border-amber-500/30"
            >
              <CheckCircle2 size={12} /> Approve & Apply
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 text-[10px] text-zinc-600 text-center italic">
          No pending recommendations.
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OpenClawPage() {
  const { settings } = useStore();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyScreener, setBusyScreener] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      type: 'system',
      ts: Date.now(),
      text: 'OpenClaw is online. Ask in plain English. Use the Screener panel for autopilot and watchlist optimization.',
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history]);

  const executeCommand = async (intent: ParsedIntent, parsedIdx: number) => {
    setBusy(true);
    if (intent.command.kind === 'run_screener') setBusyScreener(true);
    try {
      const res = await fetch('/api/openclaw/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: intent.command }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setHistory(h => h.map((e, i) =>
        i === parsedIdx && e.type === 'parsed' ? { ...e, status: 'executed' as const } : e
      ).concat([{ type: 'result', ok: true, data: data.result, ts: Date.now(), forKind: intent.command.kind }]));
    } catch (err: any) {
      setHistory(h => h.map((e, i) =>
        i === parsedIdx && e.type === 'parsed' ? { ...e, status: 'failed' as const } : e
      ).concat([{ type: 'result', ok: false, error: err.message, ts: Date.now(), forKind: intent.command.kind }]));
    } finally {
      setBusy(false);
      setBusyScreener(false);
    }
  };

  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput('');
    setHistory(h => [...h, { type: 'user', text, ts: Date.now() }]);

    try {
      const res = await fetch('/api/openclaw/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const intent = data as ParsedIntent;
      const isMeta = intent.command.kind === 'clarify' || intent.command.kind === 'reject';
      const initialStatus = intent.requires_confirmation ? 'pending'
        : isMeta ? 'rejected' : 'confirmed';

      let parsedIdx = -1;
      setHistory(h => {
        parsedIdx = h.length;
        return [...h, { type: 'parsed', intent, ts: Date.now(), status: initialStatus }];
      });

      if (!intent.requires_confirmation && !isMeta) {
        setTimeout(() => executeCommand(intent, parsedIdx), 50);
      } else {
        setBusy(false);
      }
    } catch (err: any) {
      setHistory(h => [...h, { type: 'system', ts: Date.now(), text: `Parse error: ${err.message}` }]);
      setBusy(false);
    } finally {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const confirmIntent = (entryIndex: number) => {
    const entry = history[entryIndex];
    if (entry?.type !== 'parsed' || entry.status !== 'pending') return;
    setHistory(h => h.map((e, i) => i === entryIndex && e.type === 'parsed' ? { ...e, status: 'confirmed' } : e));
    executeCommand(entry.intent, entryIndex);
  };

  const rejectIntent = (entryIndex: number) => {
    setHistory(h => h.map((e, i) => i === entryIndex && e.type === 'parsed' ? { ...e, status: 'rejected' } : e));
  };

  // Direct screener actions (used by ScreenerPanel buttons, not the chat)
  const runScreenerDirect = async () => {
    setBusyScreener(true);
    setHistory(h => [...h, { type: 'system', ts: Date.now(), text: 'Manual screener triggered…' }]);
    try {
      const res = await fetch('/api/openclaw/run-screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'manual' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setHistory(h => [...h, {
        type: 'system', ts: Date.now(),
        text: data.is_no_change
          ? `Screener complete — top 3 unchanged (${data.proposed_top_3.join(', ')}).`
          : `Screener complete — proposed top 3: ${data.proposed_top_3.join(', ')}. Approve in panel above.`,
      }]);
    } catch (err: any) {
      setHistory(h => [...h, { type: 'system', ts: Date.now(), text: `Screener failed: ${err.message}` }]);
    } finally {
      setBusyScreener(false);
    }
  };

  const approveRec = async (id: string) => {
    try {
      const res = await fetch(`/api/openclaw/recommendations/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setHistory(h => [...h, {
        type: 'system', ts: Date.now(),
        text: `Watchlist updated → ${data.applied_symbols.join(', ')}`,
      }]);
    } catch (err: any) {
      setHistory(h => [...h, { type: 'system', ts: Date.now(), text: `Approve failed: ${err.message}` }]);
    }
  };

  const rejectRec = async (id: string) => {
    try {
      const res = await fetch(`/api/openclaw/recommendations/${id}/reject`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setHistory(h => [...h, { type: 'system', ts: Date.now(), text: 'Recommendation rejected.' }]);
    } catch (err: any) {
      setHistory(h => [...h, { type: 'system', ts: Date.now(), text: `Reject failed: ${err.message}` }]);
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-32 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
          <Wand2 className="text-emerald-400" size={22} />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-black tracking-tight text-white">
            OpenClaw — System Control
          </h1>
          <p className="text-zinc-500 text-xs mt-0.5">
            Natural-language control + autonomous symbol screener
          </p>
        </div>
        {settings && (
          <div className="hidden sm:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
            <div className={cn('w-2 h-2 rounded-full', settings.paused ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse')} />
            <span className="text-zinc-400">{settings.paused ? 'Bot Paused' : 'Bot Active'}</span>
          </div>
        )}
      </div>

      {/* Screener Panel — always visible at top */}
      <ScreenerPanel
        onRun={runScreenerDirect}
        onApprove={approveRec}
        onReject={rejectRec}
        busyRun={busyScreener}
      />

      {/* Conversation */}
      <div
        ref={scrollRef}
        className="bg-zinc-900/30 border border-zinc-800/50 rounded-3xl p-4 sm:p-6 min-h-[300px] max-h-[50vh] overflow-y-auto custom-scrollbar space-y-4"
      >
        <AnimatePresence initial={false}>
          {history.map((entry, idx) => {
            if (entry.type === 'system') {
              return (
                <motion.div key={entry.ts} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-center text-[11px] text-zinc-500 italic py-2">
                  {entry.text}
                </motion.div>
              );
            }
            if (entry.type === 'user') {
              return (
                <motion.div key={entry.ts} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="flex justify-end">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[80%]">
                    <p className="text-sm text-zinc-100">{entry.text}</p>
                  </div>
                </motion.div>
              );
            }
            if (entry.type === 'parsed') {
              const Icon = commandIcon(entry.intent.command.kind);
              const color = commandColor(entry.intent);
              const isWrite = WRITE_KINDS.has(entry.intent.command.kind);
              return (
                <motion.div key={entry.ts} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'border rounded-2xl rounded-tl-sm overflow-hidden',
                    color === 'rose' && 'bg-rose-500/5 border-rose-500/20',
                    color === 'amber' && 'bg-amber-500/5 border-amber-500/20',
                    color === 'blue' && 'bg-blue-500/5 border-blue-500/20',
                  )}>
                  <div className="p-4 flex items-start gap-3">
                    <Icon size={16} className={cn(
                      'mt-0.5 shrink-0',
                      color === 'rose' && 'text-rose-400',
                      color === 'amber' && 'text-amber-400',
                      color === 'blue' && 'text-blue-400',
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500">
                          {entry.intent.command.kind}
                        </span>
                        {isWrite && (
                          <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                            WRITE
                          </span>
                        )}
                        {entry.status === 'executed' && (
                          <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 size={10} /> EXECUTED
                          </span>
                        )}
                        {entry.status === 'rejected' && entry.intent.command.kind !== 'reject' && (
                          <span className="text-[9px] font-bold text-zinc-500">CANCELLED</span>
                        )}
                        {entry.status === 'failed' && (
                          <span className="text-[9px] font-bold text-rose-400 flex items-center gap-1">
                            <XCircle size={10} /> FAILED
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-200">{entry.intent.explanation}</p>
                      {entry.intent.command.kind === 'clarify' && (
                        <p className="text-xs text-amber-300 mt-2 italic">{entry.intent.command.question}</p>
                      )}
                      {entry.intent.command.kind === 'reject' && (
                        <p className="text-xs text-rose-300 mt-2">{entry.intent.command.reason}</p>
                      )}
                    </div>
                  </div>
                  {entry.status === 'pending' && (
                    <div className="flex border-t border-zinc-800/50">
                      <button onClick={() => rejectIntent(idx)}
                        className="flex-1 py-2.5 text-xs font-bold text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors flex items-center justify-center gap-2">
                        <XCircle size={13} /> Cancel
                      </button>
                      <div className="w-px bg-zinc-800/50" />
                      <button onClick={() => confirmIntent(idx)} disabled={busy}
                        className="flex-1 py-2.5 text-xs font-bold text-amber-400 hover:bg-amber-500/10 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                        <CheckCircle2 size={13} /> Confirm & Execute
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            }
            if (entry.type === 'result') {
              return (
                <motion.div key={entry.ts} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    'border rounded-2xl rounded-tl-sm p-4',
                    entry.ok ? 'bg-zinc-900/50 border-zinc-800' : 'bg-rose-500/5 border-rose-500/20'
                  )}>
                  {entry.ok ? formatResult(entry.forKind, entry.data) : (
                    <div className="flex items-center gap-2 text-rose-400 text-xs">
                      <AlertTriangle size={14} />
                      {entry.error}
                    </div>
                  )}
                </motion.div>
              );
            }
            return null;
          })}
        </AnimatePresence>

        {busy && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 size={12} className="animate-spin" />
            <span className="font-mono">OpenClaw thinking...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={(e) => { e.preventDefault(); submit(input); }}
        className="sticky bottom-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-2 shadow-2xl">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell OpenClaw what to do..."
            disabled={busy}
            className="flex-1 bg-transparent px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
            maxLength={500}
            autoFocus
          />
          <button type="submit" disabled={busy || !input.trim()}
            className="p-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 rounded-xl transition-all active:scale-95">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        {history.length <= 1 && (
          <div className="flex flex-wrap gap-1.5 mt-2 px-1">
            {SUGGESTIONS.map(s => (
              <button key={s} type="button" onClick={() => submit(s)} disabled={busy}
                className="text-[10px] font-medium text-zinc-500 hover:text-emerald-400 bg-zinc-800/50 hover:bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-zinc-800 hover:border-emerald-500/30 transition-all">
                {s}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}