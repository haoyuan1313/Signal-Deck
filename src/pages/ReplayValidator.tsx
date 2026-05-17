import { useState, useCallback } from 'react';
import { RotateCcw, Play, AlertTriangle, TrendingUp, BarChart3, ShieldCheck, XCircle, CheckCircle2, Timer, Bug, Zap, Database } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import type { ReplayDashboard, ReplayComparison, ValidationFlag } from '../lib/replayValidator';

const CATEGORY_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  strategy_mismatch: { label: 'Strategy Mismatch', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: AlertTriangle },
  execution_drift: { label: 'Execution Drift', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', icon: TrendingUp },
  replay_data_bug: { label: 'Replay Data Bug', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20', icon: Bug },
  missing_candle_data: { label: 'Missing Candle Data', color: 'text-violet-400 bg-violet-500/10 border-violet-500/20', icon: Database },
};

export default function ReplayValidatorPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<ReplayDashboard | null>(null);
  const [limit, setLimit] = useState(20);
  const [selectedTrade, setSelectedTrade] = useState<ReplayComparison | null>(null);

  const runValidation = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedTrade(null);
    try {
      const res = await fetch('/api/replay/dashboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDashboard(data);
    } catch (err: any) {
      setError(err.message);
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const replayBugCount = dashboard?.comparisons.filter(c =>
    c.flags.some(f => f.category === 'replay_data_bug')
  ).length || 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-4 uppercase italic">
            <div className="p-3 bg-violet-500/10 rounded-2xl shadow-xl shadow-violet-500/5">
              <ShieldCheck className="text-violet-400" size={28} />
            </div>
            Trade Replay Validator
          </h1>
          <p className="text-zinc-500 text-sm mt-2 font-medium">
            Compare live trades against candle-by-candle simulation
          </p>
        </div>
        <div className="flex items-center gap-4 bg-zinc-900/50 border border-zinc-800/50 p-3 rounded-2xl">
          <div className="flex items-center gap-2 px-3">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Sample</span>
            <input type="number" value={limit} onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
              className="bg-zinc-800 text-sm font-black font-mono text-white w-16 outline-none rounded-xl px-3 py-2 border border-zinc-700/30 text-center" />
          </div>
          <button onClick={runValidation} disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-black uppercase text-xs tracking-widest rounded-xl transition-all active:scale-95">
            {loading ? <RotateCcw size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
            Validate
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/5 border border-rose-500/20 text-rose-400 p-4 rounded-xl flex items-center gap-3">
          <XCircle size={16} /> {error}
        </div>
      )}

      <AnimatePresence>
        {dashboard && dashboard.tradesAnalyzed > 0 ? (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <KpiCard label="Accuracy" value={`${dashboard.avgAccuracy.toFixed(0)}%`}
                color={dashboard.avgAccuracy >= 80 ? 'text-emerald-400' : dashboard.avgAccuracy >= 60 ? 'text-amber-400' : 'text-rose-400'} />
              <KpiCard label="Drift" value={`${dashboard.avgExecutionDrift.toFixed(2)}%`}
                color={dashboard.avgExecutionDrift < 0.3 ? 'text-emerald-400' : 'text-amber-400'} />
              <KpiCard label="Live R" value={`${dashboard.liveExpectancy.toFixed(2)}R`}
                color={dashboard.liveExpectancy > 0 ? 'text-emerald-400' : 'text-rose-400'} />
              <KpiCard label="Replay R" value={`${dashboard.replayExpectancy.toFixed(2)}R`}
                color={dashboard.replayExpectancy > 0 ? 'text-emerald-400' : 'text-rose-400'} />
              <KpiCard label="Replay Bugs" value={`${replayBugCount}`}
                color={replayBugCount === 0 ? 'text-emerald-400' : 'text-rose-400'} />
            </div>

            {/* Expectancy delta */}
            <div className={cn(
              "p-4 rounded-2xl border text-sm font-bold",
              Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) < 0.3
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
            )}>
              Expectancy delta: {(dashboard.liveExpectancy - dashboard.replayExpectancy).toFixed(2)}R
              {Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) > 0.3
                ? ' — Strategy may behave differently in live trading'
                : ' — Strategy performs consistently'}
            </div>

            {/* Flags by category */}
            {Object.keys(dashboard.flagsByCategory).length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4">Flags by Category</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(dashboard.flagsByCategory).map(([cat, count]) => {
                    const cfg = CATEGORY_LABELS[cat] || { label: cat, color: 'text-zinc-400 bg-zinc-800 border-zinc-700', icon: AlertTriangle };
                    const Icon = cfg.icon;
                    return (
                      <div key={cat} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold ${cfg.color}`}>
                        <Icon size={14} /> {cfg.label}: {count}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Replay bug warning */}
            {replayBugCount > 0 && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-6">
                <h3 className="text-sm font-black text-rose-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Bug size={16} /> {replayBugCount} trades have possible replay data bugs
                </h3>
                <p className="text-xs text-rose-400/70">
                  Entry deltas &gt;2% indicate the replay may be matching the wrong candle or using mismatched symbol data.
                  Check the debug columns for timestamp alignment and resolved symbols.
                </p>
              </div>
            )}

            {/* Trade comparison table with debug columns */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
              <div className="px-8 py-6 border-b border-zinc-800">
                <h3 className="text-white font-black text-base uppercase tracking-[0.2em]">
                  Trade Comparison ({dashboard.tradesAnalyzed})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.2em] bg-zinc-800/20 border-b border-zinc-800/50">
                      <th className="px-3 py-3">Trade</th>
                      <th className="px-3 py-3">Live Time</th>
                      <th className="px-3 py-3">Signal Bar</th>
                      <th className="px-3 py-3">Δt</th>
                      <th className="px-3 py-3">Direction</th>
                      <th className="px-3 py-3">Live Entry</th>
                      <th className="px-3 py-3">Replay Entry</th>
                      <th className="px-3 py-3">Δ%</th>
                      <th className="px-3 py-3">Live R</th>
                      <th className="px-3 py-3">Replay R</th>
                      <th className="px-3 py-3">R Δ</th>
                      <th className="px-3 py-3">Exit Match</th>
                      <th className="px-3 py-3">Acc</th>
                      <th className="px-3 py-3">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/30">
                    {dashboard.comparisons.map((c: ReplayComparison) => {
                      const hasBug = c.flags.some(f => f.category === 'replay_data_bug');
                      const entryBug = c.entry.deltaPct > 2.0;
                      return (
                        <tr key={c.tradeId}
                          onClick={() => setSelectedTrade(selectedTrade?.tradeId === c.tradeId ? null : c)}
                          className={cn(
                            "hover:bg-zinc-800/10 cursor-pointer transition-colors",
                            hasBug && "bg-rose-500/5"
                          )}>
                          <td className="px-3 py-3 font-bold text-white">{c.symbol}</td>
                          <td className="px-3 py-3 font-mono text-zinc-400 text-[10px]">{c.openedAt.slice(0, 19).replace('T', ' ')}</td>
                          <td className="px-3 py-3 font-mono text-zinc-500 text-[10px]">{c.debug.signalCandleTime.slice(0, 19).replace('T', ' ')}</td>
                          <td className="px-3 py-3 font-mono">
                            <span className={cn(Math.abs(c.debug.candleTimeDeltaSec) > 300 ? 'text-rose-400' : 'text-zinc-500')}>
                              {c.debug.candleTimeDeltaSec}s
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[9px] font-bold uppercase",
                              c.signal.signalMatched
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            )}>
                              {c.signal.liveDirection} → {c.signal.replayDirection || '?'}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono text-white">${c.entry.livePrice.toFixed(2)}</td>
                          <td className="px-3 py-3 font-mono text-zinc-300">${c.entry.replayPrice.toFixed(2)}</td>
                          <td className="px-3 py-3 font-mono font-bold">
                            <span className={cn(
                              entryBug ? 'text-rose-400' : c.entry.deltaPct > 0.5 ? 'text-amber-400' : 'text-emerald-400'
                            )}>
                              {c.entry.deltaPct.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono font-bold">
                            <span className={c.r.liveR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                              {c.r.liveR >= 0 ? '+' : ''}{c.r.liveR.toFixed(2)}R
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono font-bold">
                            <span className={c.r.replayR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                              {c.r.replayR >= 0 ? '+' : ''}{c.r.replayR.toFixed(2)}R
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono">
                            <span className={Math.abs(c.r.delta) < 0.3 ? 'text-zinc-400' : 'text-rose-400'}>
                              {c.r.delta >= 0 ? '+' : ''}{c.r.delta.toFixed(2)}R
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {c.exit.exitReasonMatched
                              ? <CheckCircle2 size={14} className="text-emerald-400" />
                              : <span className="text-[9px] text-rose-400">{c.exit.replayExitReason}</span>}
                          </td>
                          <td className="px-3 py-3">
                            <span className={cn(
                              "text-[10px] font-bold",
                              c.accuracyScore >= 80 ? 'text-emerald-400' : c.accuracyScore >= 60 ? 'text-amber-400' : 'text-rose-400'
                            )}>{c.accuracyScore}%</span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex gap-0.5 flex-wrap max-w-[80px]">
                              {c.flags.map((f: ValidationFlag, i: number) => (
                                <span key={i} title={`[${f.category}] ${f.message}`}
                                  className={cn("w-2 h-2 rounded-full",
                                    f.category === 'replay_data_bug' ? 'bg-rose-500' :
                                    f.category === 'strategy_mismatch' ? 'bg-amber-500' :
                                    f.category === 'missing_candle_data' ? 'bg-violet-500' :
                                    'bg-blue-500')} />
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected trade detail pane */}
            <AnimatePresence>
              {selectedTrade && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">
                      Debug: {selectedTrade.symbol} — {selectedTrade.tradeId.slice(0, 8)}
                    </h3>
                    <button onClick={() => setSelectedTrade(null)} className="text-zinc-500 hover:text-white">
                      <XCircle size={16} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <DebugRow label="Live opened_at" value={selectedTrade.debug.liveOpenedAt} />
                    <DebugRow label="Signal candle time" value={selectedTrade.debug.signalCandleTime} />
                    <DebugRow label="Candle time delta" value={`${selectedTrade.debug.candleTimeDeltaSec}s`} />
                    <DebugRow label="Resolved symbol" value={selectedTrade.debug.resolvedSymbol} />
                    <DebugRow label="Candle count" value={`${selectedTrade.debug.candleCount}`} />
                    <DebugRow label="Signal bar index" value={`${selectedTrade.debug.signalBarIndex}`} />
                    <DebugRow label="Entry bar index" value={`${selectedTrade.debug.entryBarIndex}`} />
                    <DebugRow label="Best setup bar" value={`${selectedTrade.signal.bestSetupIndex} (price: ${selectedTrade.signal.bestSetupPrice})`} />
                  </div>

                  <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Bars around signal (±3)</h4>
                  <div className="overflow-x-auto mb-4">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="text-zinc-500 uppercase tracking-wider">
                          <th className="px-2 py-1">Index</th>
                          <th className="px-2 py-1">Time</th>
                          <th className="px-2 py-1">Open</th>
                          <th className="px-2 py-1">Close</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTrade.debug.barsAroundSignal.map(b => (
                          <tr key={b.index} className={cn(
                            "border-t border-zinc-800/30 font-mono",
                            b.index === selectedTrade.signal.bestSetupIndex && "bg-emerald-500/10 text-emerald-400"
                          )}>
                            <td className="px-2 py-1">{b.index}</td>
                            <td className="px-2 py-1">{b.time.slice(11, 19)}</td>
                            <td className="px-2 py-1">${b.open.toFixed(4)}</td>
                            <td className="px-2 py-1">${b.close.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {selectedTrade.flags.length > 0 && (
                    <>
                      <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Flags</h4>
                      <div className="space-y-1">
                        {selectedTrade.flags.map((f, i) => {
                          const cfg = CATEGORY_LABELS[f.category] || CATEGORY_LABELS.execution_drift;
                          return (
                            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-bold ${cfg.color}`}>
                              <span className="uppercase text-[8px] tracking-wider opacity-60">[{f.category.replace(/_/g, ' ')}]</span>
                              {f.message}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Verdict */}
            <div className={cn(
              "p-6 rounded-3xl border-2 text-center",
              dashboard.avgAccuracy >= 75 && Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) < 0.3
                ? "bg-emerald-500/10 border-emerald-500/20" : "bg-amber-500/10 border-amber-500/20"
            )}>
              <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2">
                {replayBugCount > dashboard.tradesAnalyzed * 0.3
                  ? 'High Replay Data Bug Rate — Fix Timestamp/Symbol Alignment'
                  : dashboard.avgAccuracy >= 75 && Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) < 0.3
                  ? 'Strategy Edge Verified' : 'Edge May Be Simulation-Only'}
              </h2>
              <p className="text-sm text-zinc-400">
                {replayBugCount > dashboard.tradesAnalyzed * 0.3
                  ? `${replayBugCount}/${dashboard.tradesAnalyzed} trades have replay data bugs. Click a trade row to inspect debug info. The low accuracy is likely a data matching issue, not a strategy failure.`
                  : dashboard.avgAccuracy >= 90 ? 'High accuracy, low drift — the strategy edge exists in reality.'
                  : dashboard.avgAccuracy >= 75 ? 'Strategy performs similarly in live and simulation.'
                  : 'Significant drift between simulation and reality. Review entry timing and execution.'}
              </p>
            </div>
          </motion.div>
        ) : (
          !loading && (
            <div className="flex flex-col items-center justify-center py-32 text-center border-2 border-dashed border-zinc-800/50 rounded-[3rem]">
              <Zap size={48} className="text-zinc-700 mb-4" />
              <h2 className="text-xl font-black text-white uppercase tracking-tight">Run Validation</h2>
              <p className="text-zinc-500 text-sm mt-2 max-w-md">
                Click Validate to replay your last {limit} trades against candle-by-candle simulation.
              </p>
            </div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{label}</span>
      <div className={`text-xl font-black font-mono ${color}`}>{value}</div>
    </div>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-800/50 rounded-xl p-3">
      <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-xs font-mono text-zinc-200 break-all">{value}</div>
    </div>
  );
}
