import { useState, useCallback } from 'react';
import { RotateCcw, Play, AlertTriangle, TrendingUp, BarChart3, ShieldCheck, XCircle, CheckCircle2, Timer, Bug, Database, Filter, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import type { ReplayDashboard, ReplayComparison, ValidationFlag } from '../lib/replayValidator';

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  strategy_mismatch: { label: 'Strategy Mismatch', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  execution_drift: { label: 'Execution Drift', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  replay_data_bug: { label: 'Replay Data Bug', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
  missing_candle_data: { label: 'Missing Candle Data', color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  stale_or_wrong_market_data: { label: 'Stale/Wrong Market', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
};

export default function ReplayValidatorPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<ReplayDashboard | null>(null);
  const [limit, setLimit] = useState(20);
  const [selectedTrade, setSelectedTrade] = useState<ReplayComparison | null>(null);
  const [viewGroup, setViewGroup] = useState<'valid' | 'excluded'>('valid');

  const runValidation = useCallback(async () => {
    setLoading(true); setError(null); setSelectedTrade(null);
    try {
      const res = await fetch('/api/replay/dashboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDashboard(data);
      setViewGroup(data.validCount > 0 ? 'valid' : 'excluded');
    } catch (err: any) { setError(err.message); setDashboard(null); }
    finally { setLoading(false); }
  }, [limit]);

  const activeGroup: ReplayComparison[] = dashboard
    ? (viewGroup === 'valid' ? dashboard.validComparisons : dashboard.excludedComparisons)
    : [];

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
            Candle-by-candle simulation vs live execution
          </p>
        </div>
        <div className="flex items-center gap-4 bg-zinc-900/50 border border-zinc-800/50 p-3 rounded-2xl">
          <input type="number" value={limit} onChange={(e) => setLimit(parseInt(e.target.value) || 10)}
            className="bg-zinc-800 text-sm font-black font-mono text-white w-16 outline-none rounded-xl px-3 py-2 border border-zinc-700/30 text-center" />
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
            {/* Group toggle */}
            <div className="flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
              <div className="flex items-center gap-2 bg-zinc-800 rounded-xl p-1">
                <button onClick={() => setViewGroup('valid')} className={cn(
                  "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                  viewGroup === 'valid' ? "bg-emerald-500 text-white" : "text-zinc-500 hover:text-zinc-300"
                )}>
                  <CheckCircle2 size={14} /> Valid ({dashboard.validCount})
                </button>
                <button onClick={() => setViewGroup('excluded')} className={cn(
                  "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                  viewGroup === 'excluded' ? "bg-rose-500 text-white" : "text-zinc-500 hover:text-zinc-300"
                )}>
                  <Trash2 size={14} /> Excluded ({dashboard.excludedCount})
                </button>
              </div>
              <span className="text-[10px] text-zinc-500 ml-auto">
                {viewGroup === 'valid' ? 'Used for metrics' : 'Stale/testnet/synthetic — excluded from metrics'}
              </span>
            </div>

            {/* KPI row — uses valid trades only */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <KpiCard label="Accuracy" value={`${dashboard.avgAccuracy.toFixed(0)}%`}
                color={dashboard.avgAccuracy >= 80 ? 'text-emerald-400' : dashboard.avgAccuracy >= 60 ? 'text-amber-400' : 'text-rose-400'}
                sub={`${dashboard.validCount} valid trades`} />
              <KpiCard label="Drift" value={`${dashboard.avgExecutionDrift.toFixed(2)}%`}
                color={dashboard.avgExecutionDrift < 0.3 ? 'text-emerald-400' : 'text-amber-400'} />
              <KpiCard label="Live R" value={`${dashboard.liveExpectancy.toFixed(2)}R`}
                color={dashboard.liveExpectancy > 0 ? 'text-emerald-400' : 'text-rose-400'} />
              <KpiCard label="Replay R" value={`${dashboard.replayExpectancy.toFixed(2)}R`}
                color={dashboard.replayExpectancy > 0 ? 'text-emerald-400' : 'text-rose-400'} />
              <KpiCard label="Excluded" value={`${dashboard.excludedCount}`}
                color={dashboard.excludedCount === 0 ? 'text-emerald-400' : 'text-amber-400'}
                sub="stale/testnet data" />
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
                ? ' — Strategy may behave differently in live vs simulation'
                : ' — Strategy performs consistently'}
            </div>

            {/* Flags by category */}
            {Object.keys(dashboard.flagsByCategory).length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4">Flag Categories</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {Object.entries(dashboard.flagsByCategory).map(([cat, count]) => {
                    const cfg = CATEGORY_LABELS[cat] || { label: cat, color: 'text-zinc-400 bg-zinc-800 border-zinc-700' };
                    return (
                      <div key={cat} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-bold ${cfg.color}`}>
                        {cfg.label}: {count}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Excluded data warning */}
            {dashboard.excludedCount > 0 && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-6">
                <h3 className="text-sm font-black text-rose-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <AlertTriangle size={16} /> {dashboard.excludedCount} trades excluded
                </h3>
                <p className="text-xs text-rose-400/70">
                  These trades have entry prices outside nearby candle ranges (±2%). They likely come from testnet,
                  different market conditions, or synthetic/demo data that doesn't match the Bybit candles fetched.
                  They are excluded from accuracy and expectancy calculations.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {dashboard.excludedComparisons.slice(0, 5).map(c => (
                    <span key={c.tradeId} className="px-2 py-1 rounded bg-rose-500/20 text-rose-400 text-[10px] font-mono">
                      {c.symbol} — {c.openedAt.slice(0, 10)}
                    </span>
                  ))}
                  {dashboard.excludedComparisons.length > 5 && (
                    <span className="px-2 py-1 text-rose-400/50 text-[10px]">+{dashboard.excludedComparisons.length - 5} more</span>
                  )}
                </div>
              </div>
            )}

            {/* Trade table */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
              <div className="px-8 py-6 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-white font-black text-base uppercase tracking-[0.2em]">
                  {viewGroup === 'valid' ? 'Valid' : 'Excluded'} Trades ({activeGroup.length})
                </h3>
                {viewGroup === 'excluded' && (
                  <span className="text-[10px] text-rose-400 uppercase tracking-widest">Not used in metrics</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.2em] bg-zinc-800/20 border-b border-zinc-800/50">
                      <th className="px-3 py-3">Trade</th>
                      <th className="px-3 py-3">Live Time</th>
                      <th className="px-3 py-3">Sig Bar</th>
                      <th className="px-3 py-3">Δt</th>
                      <th className="px-3 py-3">Dir</th>
                      <th className="px-3 py-3">Live Entry</th>
                      <th className="px-3 py-3">Replay Entry</th>
                      <th className="px-3 py-3">Δ%</th>
                      <th className="px-3 py-3">Live R</th>
                      <th className="px-3 py-3">Replay R</th>
                      <th className="px-3 py-3">R Δ</th>
                      <th className="px-3 py-3">Exit</th>
                      <th className="px-3 py-3">Acc</th>
                      <th className="px-3 py-3">Excl</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/30">
                    {activeGroup.map((c: ReplayComparison) => {
                      const isExcluded = !!c.exclusionReason;
                      const isStale = c.flags.some(f => f.category === 'stale_or_wrong_market_data');
                      return (
                        <tr key={c.tradeId}
                          onClick={() => setSelectedTrade(selectedTrade?.tradeId === c.tradeId ? null : c)}
                          className={cn(
                            "hover:bg-zinc-800/10 cursor-pointer transition-colors",
                            isExcluded && "bg-rose-500/5 opacity-60"
                          )}>
                          <td className="px-3 py-3 font-bold text-white">{c.symbol}</td>
                          <td className="px-3 py-3 font-mono text-zinc-400 text-[10px]">{c.openedAt.slice(0, 19).replace('T', ' ')}</td>
                          <td className="px-3 py-3 font-mono text-zinc-500 text-[10px]">{c.debug.signalCandleTime.slice(0, 19).replace('T', ' ')}</td>
                          <td className="px-3 py-3 font-mono">
                            <span className={Math.abs(c.debug.candleTimeDeltaSec) > 300 ? 'text-rose-400' : 'text-zinc-500'}>
                              {c.debug.candleTimeDeltaSec}s
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold uppercase",
                              c.signal.signalMatched ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20")}>
                              {c.signal.liveDirection}→{c.signal.replayDirection || '?'}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono text-white">${c.entry.livePrice.toFixed(2)}</td>
                          <td className="px-3 py-3 font-mono text-zinc-300">${c.entry.replayPrice.toFixed(2)}</td>
                          <td className="px-3 py-3 font-mono font-bold">
                            <span className={cn(
                              isStale || c.entry.deltaPct > 2.0 ? 'text-rose-400' : c.entry.deltaPct > 0.5 ? 'text-amber-400' : 'text-emerald-400'
                            )}>{c.entry.deltaPct.toFixed(2)}%</span>
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
                            <span className={cn("text-[10px] font-bold",
                              c.accuracyScore >= 80 ? 'text-emerald-400' : c.accuracyScore >= 60 ? 'text-amber-400' : 'text-rose-400')}>
                              {c.accuracyScore}%
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {c.exclusionReason ? (
                              <span className="text-[9px] text-rose-400 max-w-[120px] truncate block" title={c.exclusionReason}>
                                {c.exclusionReason.slice(0, 40)}...
                              </span>
                            ) : <span className="text-emerald-400">✓</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detail pane */}
            <AnimatePresence>
              {selectedTrade && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">
                      Debug: {selectedTrade.symbol} — {selectedTrade.tradeId.slice(0, 8)}
                      {selectedTrade.exclusionReason && (
                        <span className="ml-2 text-[10px] text-rose-400">EXCLUDED</span>
                      )}
                    </h3>
                    <button onClick={() => setSelectedTrade(null)} className="text-zinc-500 hover:text-white"><XCircle size={16} /></button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <DebugRow label="Live opened_at" value={selectedTrade.debug.liveOpenedAt} />
                    <DebugRow label="Signal candle" value={selectedTrade.debug.signalCandleTime} />
                    <DebugRow label="Candle Δt" value={`${selectedTrade.debug.candleTimeDeltaSec}s`} />
                    <DebugRow label="Resolved symbol" value={selectedTrade.debug.resolvedSymbol} />
                    <DebugRow label="Candles" value={`${selectedTrade.debug.candleCount}`} />
                    <DebugRow label="Signal bar idx" value={`${selectedTrade.debug.signalBarIndex}`} />
                    <DebugRow label="Entry bar idx" value={`${selectedTrade.debug.entryBarIndex}`} />
                    <DebugRow label="Paper trade" value={selectedTrade.isPaper ? 'Yes' : 'No'} />
                    {selectedTrade.exclusionReason && (
                      <DebugRow label="Exclusion" value={selectedTrade.exclusionReason} />
                    )}
                  </div>

                  <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Bars searched (signal → entry)</h4>
                  <div className="overflow-x-auto mb-4">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="text-zinc-500 uppercase tracking-wider">
                          <th className="px-2 py-1">Idx</th>
                          <th className="px-2 py-1">Time</th>
                          <th className="px-2 py-1">Open</th>
                          <th className="px-2 py-1">Close</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTrade.debug.barsAroundSignal.map(b => (
                          <tr key={b.index} className={cn("border-t border-zinc-800/30 font-mono",
                            b.index === selectedTrade.signal.bestSetupIndex && "bg-emerald-500/10 text-emerald-400")}>
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
            <div className={cn("p-6 rounded-3xl border-2 text-center",
              dashboard.validCount > 0 && dashboard.avgAccuracy >= 75 && Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) < 0.3
                ? "bg-emerald-500/10 border-emerald-500/20" : "bg-amber-500/10 border-amber-500/20"
            )}>
              <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2">
                {dashboard.validCount === 0
                  ? 'No Valid Trades — All Excluded'
                  : dashboard.excludedCount > dashboard.tradesAnalyzed * 0.3
                  ? `${dashboard.excludedCount}/${dashboard.tradesAnalyzed} trades excluded — Clean up data before trusting results`
                  : dashboard.avgAccuracy >= 75 && Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) < 0.3
                  ? 'Strategy Edge Verified' : 'Edge May Be Simulation-Only'}
              </h2>
              <p className="text-sm text-zinc-400">
                {dashboard.validCount === 0
                  ? 'All trades were excluded due to stale/wrong market data. Check that the trades in the database match the Bybit candles being fetched (same network, same time period).'
                  : dashboard.excludedCount > 0
                  ? `${dashboard.excludedCount} stale/testnet trades excluded. Metrics use ${dashboard.validCount} valid trades.`
                  : `All ${dashboard.tradesAnalyzed} trades passed data sanity checks. Metrics are based on clean data.`}
              </p>
            </div>
          </motion.div>
        ) : (
          !loading && (
            <div className="flex flex-col items-center justify-center py-32 text-center border-2 border-dashed border-zinc-800/50 rounded-[3rem]">
              <Filter size={48} className="text-zinc-700 mb-4" />
              <h2 className="text-xl font-black text-white uppercase tracking-tight">Run Validation</h2>
              <p className="text-zinc-500 text-sm mt-2 max-w-md">
                Replay your last {limit} trades against candle-by-candle simulation. Stale/testnet trades are automatically excluded.
              </p>
            </div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}

function KpiCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1">{label}</span>
      <div className={`text-xl font-black font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-zinc-600 mt-0.5">{sub}</div>}
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
