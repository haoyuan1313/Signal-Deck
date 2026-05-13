import { useState } from 'react';
import { motion } from 'motion/react';
import { Bot, ExternalLink, Radio, ShieldCheck, Maximize2, Activity, BarChart2, TrendingUp, Clock } from 'lucide-react';
import { cn } from '../lib/utils';

// Stub data — will be replaced with real Mantle on-chain data
const STUB_DECISIONS: Array<{
  timestamp: string;
  action: 'open' | 'close';
  symbol: string;
  entry: number;
  sl: number;
  tp: number;
  tx_hash: string;
}> = [];

export default function AgentIdentity() {
  const [demoMode, setDemoMode] = useState(false);
  const [agentStatus] = useState<'live' | 'paused'>('paused');
  const [decisions] = useState(STUB_DECISIONS);

  const stats = {
    totalDecisions: decisions.length,
    onChainWinRate: '—',
    totalVolume: '—',
  };

  return (
    <div className={cn("space-y-8 pb-20", demoMode && "fixed inset-0 z-50 bg-zinc-950 p-8 overflow-auto")}>
      {!demoMode && (
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Bot className="text-violet-400" size={28} />
              <h2 className="text-3xl font-bold tracking-tight">Agent Identity</h2>
            </div>
            <p className="text-zinc-500 text-sm">Mantle ERC-8004 on-chain agent verification and decision log.</p>
          </div>
          <button
            onClick={() => setDemoMode(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-500/10 border border-violet-500/20 text-violet-400 rounded-xl font-bold text-sm hover:bg-violet-500/20 transition-all"
          >
            <Maximize2 size={16} />
            Demo Day Mode
          </button>
        </header>
      )}

      {demoMode && (
        <button
          onClick={() => setDemoMode(false)}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white p-2 bg-zinc-900 rounded-lg border border-zinc-800"
        >
          Exit Demo Mode
        </button>
      )}

      {/* Agent NFT Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-1 bg-gradient-to-br from-violet-950/50 to-zinc-900 border border-violet-500/20 rounded-3xl p-8 flex flex-col items-center text-center gap-6"
        >
          <div className="w-24 h-24 bg-violet-500/20 rounded-full flex items-center justify-center border-2 border-violet-500/30">
            <Bot size={48} className="text-violet-400" />
          </div>
          <div>
            <h3 className="text-2xl font-bold tracking-tight text-white">SignalDeck Agent</h3>
            <p className="text-zinc-500 text-sm mt-1">ERC-8004 · Mantle Network</p>
          </div>
          <div className="w-full space-y-2 text-left">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Token ID</span>
              <span className="text-violet-400 font-mono">—</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Strategy</span>
              <span className="text-white font-mono">SMC · FVG</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Chain</span>
              <span className="text-white font-mono">Mantle (5000)</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Status</span>
              <span className={cn(
                "font-bold uppercase text-xs px-2 py-0.5 rounded",
                agentStatus === 'live'
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              )}>
                <Radio size={10} className="inline mr-1" />
                {agentStatus === 'live' ? 'LIVE' : 'PAUSED'}
              </span>
            </div>
          </div>
          <button
            disabled
            className="w-full py-3 bg-violet-500/20 text-violet-400 rounded-xl font-bold text-sm opacity-50 cursor-not-allowed"
          >
            Mint Agent NFT — Coming Soon
          </button>
        </motion.div>

        {/* On-chain Performance */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-2 space-y-6"
        >
          {/* Stats Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Total Decisions', value: stats.totalDecisions, icon: Activity, color: 'text-violet-400' },
              { label: 'On-Chain Win Rate', value: stats.onChainWinRate, icon: TrendingUp, color: 'text-emerald-400' },
              { label: 'Total Volume', value: stats.totalVolume, icon: BarChart2, color: 'text-amber-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={16} className={color} />
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{label}</span>
                </div>
                <span className={cn("text-3xl font-bold font-mono tracking-tight", color)}>{value}</span>
              </div>
            ))}
          </div>

          {/* Decision Log Table */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-zinc-800 flex items-center gap-2">
              <Clock size={16} className="text-zinc-500" />
              <h3 className="font-bold text-sm uppercase tracking-widest text-zinc-400">On-Chain Decision Log</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left whitespace-nowrap">
                <thead>
                  <tr className="bg-zinc-800/30 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                    <th className="px-6 py-4">Timestamp</th>
                    <th className="px-6 py-4">Action</th>
                    <th className="px-6 py-4">Symbol</th>
                    <th className="px-6 py-4">Entry</th>
                    <th className="px-6 py-4">SL</th>
                    <th className="px-6 py-4">TP</th>
                    <th className="px-6 py-4">Tx Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {decisions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <Bot className="text-zinc-800" size={48} />
                          <p className="text-zinc-500 italic text-sm">No on-chain decisions yet</p>
                          <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
                            Connect Mantle wallet in Config to start logging
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : decisions.map((d, i) => (
                    <tr key={i} className="hover:bg-zinc-800/20 transition-all">
                      <td className="px-6 py-4 text-xs text-zinc-400 font-mono">{d.timestamp}</td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          'px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                          d.action === 'open' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                        )}>
                          {d.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-white">{d.symbol}</td>
                      <td className="px-6 py-4 text-xs font-mono text-zinc-300">${d.entry}</td>
                      <td className="px-6 py-4 text-xs font-mono text-rose-400">${d.sl}</td>
                      <td className="px-6 py-4 text-xs font-mono text-emerald-400">${d.tp}</td>
                      <td className="px-6 py-4">
                        <a
                          href={`https://explorer.mantle.xyz/tx/${d.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-violet-400 text-xs font-mono hover:underline flex items-center gap-1"
                        >
                          {d.tx_hash.slice(0, 10)}...
                          <ExternalLink size={10} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
