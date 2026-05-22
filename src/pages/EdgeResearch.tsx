import { useStore } from '../store/useStore';
import { useState, useMemo } from 'react';
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, ShieldCheck, Activity, Zap, Filter, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import {
  compareAllPresets, RESEARCH_PRESETS,
  type TradeRow, type PresetComparison, type FilterContribution, type OutlierImpact, type StabilityMetrics,
} from '../lib/edgeAnalytics';

export default function EdgeResearch() {
  const { trades } = useStore();

  const tradeRows: TradeRow[] = useMemo(() => trades
    .filter(t => t.status === 'closed' && t.r !== null)
    .map(t => ({
      symbol: t.symbol, direction: t.direction, entry: t.entry,
      exit_price: t.exit_price, r: t.r, opened_at: t.opened_at,
      is_paper: t.is_paper, status: t.status, outcome: t.outcome,
      ai_confidence: t.ai_confidence,
    })), [trades]);

  const allPresets = useMemo(() => tradeRows.length >= 10 ? compareAllPresets(tradeRows) : [], [tradeRows]);
  const [selectedPreset, setSelectedPreset] = useState<string>(RESEARCH_PRESETS[0]?.id || '');

  const active = allPresets.find(p => p.presetId === selectedPreset);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-4 uppercase italic">
            <div className="p-3 bg-emerald-500/10 rounded-2xl shadow-xl shadow-emerald-500/5">
              <Zap className="text-emerald-400" size={28} />
            </div>
            Edge Filter Research v2
          </h1>
          <p className="text-zinc-500 text-sm mt-2 font-medium">
            Sensitivity analysis, preset comparison, stability metrics — no strategy changes
          </p>
        </div>
      </div>

      {allPresets.length === 0 ? (
        <div className="text-center py-20 text-zinc-500">
          <Activity size={48} className="mx-auto mb-4 text-zinc-700" />
          <p className="text-sm font-bold">Need ≥10 closed trades with R values for analysis.</p>
        </div>
      ) : (
        <>
          {/* Preset selector */}
          <div className="flex flex-wrap gap-2">
            {RESEARCH_PRESETS.map(p => {
              const data = allPresets.find(c => c.presetId === p.id);
              return (
                <button key={p.id} onClick={() => setSelectedPreset(p.id)}
                  className={cn(
                    "px-4 py-3 rounded-xl border text-left transition-all min-w-[200px]",
                    selectedPreset === p.id
                      ? "bg-emerald-500/10 border-emerald-500/20"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                  )}>
                  <div className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">{p.label}</div>
                  <div className="text-[9px] text-zinc-400 mt-0.5">{p.description}</div>
                  {data && (
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[10px] font-mono font-bold text-white">{data.stability.tradeCount}t</span>
                      <span className={cn("text-[10px] font-mono font-bold", data.stability.avgR >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {data.stability.avgR > 0 ? '+' : ''}{data.stability.avgR.toFixed(3)}R
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500">C:{data.stability.sampleConfidenceScore}%</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {active && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              {/* Stability metrics */}
              <StabilityCard metrics={active.stability} />

              {/* Filter contribution analysis */}
              <ContributionCard contributions={active.contributions} />

              {/* Outlier detection */}
              <OutlierCard outlier={active.outlier} />

              {/* All presets comparison table */}
              <ComparisonTable presets={allPresets} tradeCount={tradeRows.length} />
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

function StabilityCard({ metrics }: { metrics: StabilityMetrics }) {
  const c = metrics.sampleConfidenceScore;
  const confidenceLabel = c >= 80 ? 'High' : c >= 60 ? 'Moderate' : c >= 40 ? 'Low' : 'Very Low';
  const confidenceColor = c >= 80 ? 'text-emerald-400' : c >= 60 ? 'text-amber-400' : c >= 40 ? 'text-orange-400' : 'text-rose-400';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
      <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
        <ShieldCheck size={18} className="text-emerald-400" /> Stability Metrics
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricBox label="Trade Count" value={`${metrics.tradeCount}`} color="text-white" sub={metrics.tradeCount < 30 ? '⚠ Small sample' : undefined} />
        <MetricBox label="Avg R" value={`${metrics.avgR > 0 ? '+' : ''}${metrics.avgR.toFixed(3)}R`} color={metrics.avgR >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
        <MetricBox label="Profit Factor" value={metrics.pf.toFixed(2)} color={metrics.pf >= 1.3 ? 'text-emerald-400' : 'text-amber-400'} />
        <MetricBox label="Confidence" value={`${confidenceLabel} (${c}%)`} color={confidenceColor} />
        <MetricBox label="Max Losing Streak" value={`${metrics.maxLosingStreak}`} color={metrics.maxLosingStreak <= 5 ? 'text-emerald-400' : 'text-amber-400'} />
        <MetricBox label="Longest Flat Period" value={`${metrics.longestFlatPeriod} trades`} color={metrics.longestFlatPeriod <= 10 ? 'text-emerald-400' : 'text-amber-400'} />
        <MetricBox label="MC Median" value={`${metrics.monteCarloMedian > 0 ? '+' : ''}${metrics.monteCarloMedian.toFixed(1)}R`} color={metrics.monteCarloMedian >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
        <MetricBox label="MC Worst 5%" value={`${metrics.monteCarloWorst5 > 0 ? '+' : ''}${metrics.monteCarloWorst5.toFixed(1)}R`} color={metrics.monteCarloWorst5 >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
      </div>
    </div>
  );
}

function ContributionCard({ contributions }: { contributions: FilterContribution[] }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
      <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
        <Filter size={18} className="text-violet-400" /> Filter Contribution Analysis
      </h3>
      <p className="text-[10px] text-zinc-500 mb-4">
        What happens when each filter is removed independently. Positive delta = better without the filter.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-600 text-[9px] font-bold uppercase tracking-wider border-b border-zinc-800/50">
              <th className="px-3 py-2 text-left">Filter Removed</th>
              <th className="px-3 py-2 text-right">Trades +</th>
              <th className="px-3 py-2 text-right">New Avg R</th>
              <th className="px-3 py-2 text-right">Δ Avg R</th>
              <th className="px-3 py-2 text-right">New PF</th>
              <th className="px-3 py-2 text-right">Δ PF</th>
              <th className="px-3 py-2 text-right">New WR</th>
              <th className="px-3 py-2 text-right">Δ WR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/30">
            {contributions.map(c => (
              <tr key={c.filterName} className="hover:bg-zinc-800/10">
                <td className="px-3 py-3 font-bold text-white">{c.filterName}</td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">+{c.tradesAdded}</td>
                <td className="px-3 py-3 text-right font-mono">
                  <span className={c.newAvgR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{c.newAvgR > 0 ? '+' : ''}{c.newAvgR.toFixed(3)}R</span>
                </td>
                <td className="px-3 py-3 text-right font-mono">{c.avgRDelta >= 0 ? '+' : ''}{c.avgRDelta.toFixed(3)}R</td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">{c.newPF.toFixed(2)}</td>
                <td className="px-3 py-3 text-right font-mono">{c.pfDelta >= 0 ? '+' : ''}{c.pfDelta.toFixed(2)}</td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">{c.newWR.toFixed(0)}%</td>
                <td className="px-3 py-3 text-right font-mono">{c.wrDelta >= 0 ? '+' : ''}{c.wrDelta.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OutlierCard({ outlier }: { outlier: OutlierImpact[] }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
      <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
        <TrendingDown size={18} className="text-amber-400" /> Outlier Detection
      </h3>
      <p className="text-[10px] text-zinc-500 mb-4">
        Impact of removing the top N most profitable trades. If expectancy collapses, the edge may depend on outliers.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {outlier.map(o => (
          <div key={o.topRemoved} className={cn(
            "bg-zinc-800/30 rounded-xl p-4 border",
            o.warning ? "border-amber-500/20 bg-amber-500/5" : "border-zinc-700/30"
          )}>
            <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Without top {o.topRemoved}</div>
            {o.warning && (
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-amber-400 mb-2">
                <AlertTriangle size={10} /> {o.warning}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <div className="text-zinc-500">Trades</div>
                <div className="font-mono text-white">{o.remainingTrades}</div>
              </div>
              <div>
                <div className="text-zinc-500">New Avg R</div>
                <div className={cn("font-mono", o.newAvgR >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{o.newAvgR > 0 ? '+' : ''}{o.newAvgR.toFixed(3)}R</div>
              </div>
              <div>
                <div className="text-zinc-500">Δ R</div>
                <div className={cn("font-mono", o.avgRDelta <= 0 ? 'text-rose-400' : 'text-emerald-400')}>{o.avgRDelta >= 0 ? '+' : ''}{o.avgRDelta.toFixed(3)}R</div>
              </div>
              <div>
                <div className="text-zinc-500">New PF</div>
                <div className="font-mono text-zinc-400">{o.newPF.toFixed(2)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparisonTable({ presets, tradeCount }: { presets: PresetComparison[]; tradeCount: number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
      <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
        <Layers size={18} className="text-blue-400" /> All Presets Comparison
      </h3>
      <p className="text-[10px] text-zinc-500 mb-4">
        {tradeCount} total closed trades available for filtering. Confidence: heuristic 0–100 score.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-600 text-[9px] font-bold uppercase tracking-wider border-b border-zinc-800/50">
              <th className="px-3 py-2 text-left">Preset</th>
              <th className="px-3 py-2 text-right">Trades</th>
              <th className="px-3 py-2 text-right">Avg R</th>
              <th className="px-3 py-2 text-right">PF</th>

              <th className="px-3 py-2 text-right">Max L</th>
              <th className="px-3 py-2 text-right">MC Med</th>
              <th className="px-3 py-2 text-right">MC W5</th>
              <th className="px-3 py-2 text-right">Flat</th>
              <th className="px-3 py-2 text-right">Conf</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/30">
            {presets.map(p => (
              <tr key={p.presetId} className="hover:bg-zinc-800/10">
                <td className="px-3 py-3 font-bold text-white">
                  {p.label}
                  <div className="text-[9px] text-zinc-500 font-normal">{RESEARCH_PRESETS.find(r => r.id === p.presetId)?.description}</div>
                </td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">{p.stability.tradeCount}</td>
                <td className="px-3 py-3 text-right font-mono">
                  <span className={p.stability.avgR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{p.stability.avgR > 0 ? '+' : ''}{p.stability.avgR.toFixed(3)}R</span>
                </td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">{p.stability.pf.toFixed(2)}</td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">{p.stability.maxLosingStreak}</td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">{p.stability.monteCarloMedian > 0 ? '+' : ''}{p.stability.monteCarloMedian.toFixed(1)}R</td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">{p.stability.monteCarloWorst5 > 0 ? '+' : ''}{p.stability.monteCarloWorst5.toFixed(1)}R</td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">{p.stability.longestFlatPeriod}</td>
                <td className="px-3 py-3 text-right font-mono">
                  <span className={p.stability.sampleConfidenceScore >= 70 ? 'text-emerald-400' : p.stability.sampleConfidenceScore >= 50 ? 'text-amber-400' : 'text-rose-400'}>
                    {p.stability.sampleConfidenceScore}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricBox({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-zinc-800/30 rounded-xl p-4">
      <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-black font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-amber-400 mt-0.5">{sub}</div>}
    </div>
  );
}
