import { useState, useCallback } from 'react';
import { RotateCcw, Play, AlertTriangle, TrendingUp, TrendingDown, BarChart3, Activity, ShieldCheck, XCircle, CheckCircle2, ArrowUpRight, Timer } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import type { ReplayDashboard, ReplayComparison, ValidationFlag } from '../lib/replayValidator';

export default function ReplayValidatorPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<ReplayDashboard | null>(null);
  const [limit, setLimit] = useState(20);

  const runValidation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/replay/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
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
            Compare live trades against historical simulation to detect strategy drift
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard label="Accuracy" value={`${dashboard.avgAccuracy.toFixed(0)}%`}
                icon={ShieldCheck} color={dashboard.avgAccuracy >= 80 ? 'text-emerald-400' : dashboard.avgAccuracy >= 60 ? 'text-amber-400' : 'text-rose-400'} />
              <KpiCard label="Execution Drift" value={`${dashboard.avgExecutionDrift.toFixed(2)}%`}
                icon={Timer} color={dashboard.avgExecutionDrift < 0.3 ? 'text-emerald-400' : 'text-amber-400'} />
              <KpiCard label="Live Expectancy" value={`${dashboard.liveExpectancy.toFixed(2)}R`}
                icon={TrendingUp} color={dashboard.liveExpectancy > 0 ? 'text-emerald-400' : 'text-rose-400'} />
              <KpiCard label="Replay Expectancy" value={`${dashboard.replayExpectancy.toFixed(2)}R`}
                icon={BarChart3} color={dashboard.replayExpectancy > 0 ? 'text-emerald-400' : 'text-rose-400'} />
            </div>

            {/* Expectancy delta */}
            <div className={cn(
              "p-4 rounded-2xl border text-sm font-bold",
              Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) < 0.3
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
            )}>
              Live vs replay expectancy delta: {(dashboard.liveExpectancy - dashboard.replayExpectancy).toFixed(2)}R
              {Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) > 0.3
                ? ' — Strategy may behave differently in live trading than simulation'
                : ' — Strategy performs consistently between live and simulation'}
            </div>

            {/* Flags summary */}
            {Object.keys(dashboard.flagsByType).length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-400" /> Flags
                </h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(dashboard.flagsByType).map(([type, count]) => (
                    <span key={type} className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold uppercase tracking-widest">
                      {type.replace(/_/g, ' ')}: {count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Trade comparison table */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
              <div className="px-8 py-6 border-b border-zinc-800">
                <h3 className="text-white font-black text-base uppercase tracking-[0.2em]">Trade Comparison ({dashboard.tradesAnalyzed})</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.2em] bg-zinc-800/20 border-b border-zinc-800/50">
                      <th className="px-4 py-3">Trade</th>
                      <th className="px-4 py-3">Signal</th>
                      <th className="px-4 py-3">Entry Δ</th>
                      <th className="px-4 py-3">Live R</th>
                      <th className="px-4 py-3">Replay R</th>
                      <th className="px-4 py-3">R Δ</th>
                      <th className="px-4 py-3">Exit Match</th>
                      <th className="px-4 py-3">Accuracy</th>
                      <th className="px-4 py-3">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/30">
                    {dashboard.comparisons.map((c: ReplayComparison) => (
                      <tr key={c.tradeId} className="hover:bg-zinc-800/10">
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-bold text-white text-xs">{c.symbol}</span>
                            <span className="text-[9px] text-zinc-500">{new Date(c.openedAt).toLocaleDateString()}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {c.signal.signalMatched
                            ? <CheckCircle2 size={14} className="text-emerald-400" />
                            : <XCircle size={14} className="text-rose-400" />}
                          <span className="text-[9px] text-zinc-500 ml-1">{c.signal.replayReason}</span>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          <span className={cn(c.entry.deltaPct < 0.3 ? 'text-emerald-400' : 'text-rose-400')}>
                            {c.entry.deltaPct.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono font-bold">
                          <span className={c.r.liveR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {c.r.liveR >= 0 ? '+' : ''}{c.r.liveR.toFixed(2)}R
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono font-bold">
                          <span className={c.r.replayR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {c.r.replayR >= 0 ? '+' : ''}{c.r.replayR.toFixed(2)}R
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          <span className={Math.abs(c.r.delta) < 0.3 ? 'text-zinc-400' : 'text-rose-400'}>
                            {c.r.delta >= 0 ? '+' : ''}{c.r.delta.toFixed(2)}R
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {c.exit.exitReasonMatched
                            ? <CheckCircle2 size={14} className="text-emerald-400" />
                            : <span className="text-[9px] text-rose-400">{c.exit.replayExitReason}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <div className={cn("w-12 h-1.5 rounded-full", c.accuracyScore >= 80 ? 'bg-emerald-500' : c.accuracyScore >= 60 ? 'bg-amber-500' : 'bg-rose-500')}>
                              <div className="h-full bg-white/20 rounded-full" style={{ width: `${c.accuracyScore}%` }} />
                            </div>
                            <span className="text-[10px] font-bold text-zinc-400">{c.accuracyScore}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {c.flags.length > 0 && (
                            <div className="flex gap-0.5">
                              {c.flags.map((f: ValidationFlag, i: number) => (
                                <span key={i} title={f.message}
                                  className={cn("w-2 h-2 rounded-full",
                                    f.severity === 'high' ? 'bg-rose-500' : f.severity === 'medium' ? 'bg-amber-500' : 'bg-blue-500')} />
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Verdict */}
            <div className={cn(
              "p-6 rounded-3xl border-2 text-center",
              dashboard.avgAccuracy >= 75 && Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) < 0.3
                ? "bg-emerald-500/10 border-emerald-500/20"
                : "bg-amber-500/10 border-amber-500/20"
            )}>
              <h2 className="text-xl font-black text-white uppercase tracking-widest mb-2">
                {dashboard.avgAccuracy >= 75 && Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy) < 0.3
                  ? 'Strategy Edge Verified'
                  : 'Edge May Be Simulation-Only'}
              </h2>
              <p className="text-sm text-zinc-400">
                {(() => {
                  const delta = Math.abs(dashboard.liveExpectancy - dashboard.replayExpectancy);
                  if (dashboard.avgAccuracy >= 90 && delta < 0.2) {
                    return 'High accuracy, low drift — the strategy edge exists in reality. Live execution closely mirrors simulation.';
                  } else if (dashboard.avgAccuracy >= 75 && delta < 0.3) {
                    return 'Strategy performs similarly in live and simulation. Minor drift is within acceptable bounds.';
                  } else if (dashboard.avgAccuracy >= 60) {
                    return 'Moderate drift detected — execution differs from simulation. Review entry timing and exit triggers.';
                  } else {
                    return 'Significant drift between simulation and reality. The backtest may be overstating the edge. Re-evaluate strategy assumptions, execution model, and cost estimates.';
                  }
                })()}
              </p>
            </div>
          </motion.div>
        ) : (
          !loading && (
            <div className="flex flex-col items-center justify-center py-32 text-center border-2 border-dashed border-zinc-800/50 rounded-[3rem]">
              <Activity size={48} className="text-zinc-700 mb-4" />
              <h2 className="text-xl font-black text-white uppercase tracking-tight">Run Validation</h2>
              <p className="text-zinc-500 text-sm mt-2 max-w-md">
                Click Validate to replay your last {limit} trades against historical simulation and compare results.
              </p>
            </div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={color} />
        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{label}</span>
      </div>
      <div className={`text-xl font-black font-mono ${color}`}>{value}</div>
    </div>
  );
}
