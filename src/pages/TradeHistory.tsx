import { useStore } from '../store/useStore';
import { useEffect, useState } from 'react';
import { formatR, formatCurrency, cn, formatDate } from '../lib/utils';
import { ArrowUpRight, ArrowDownRight, Download, Filter, Database, X, TrendingUp, Clock, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function TradeHistory() {
  const { trades, backendError, fetchFullHistory, fullHistoryLoaded, prices } = useStore();
  const [selectedTrade, setSelectedTrade] = useState<any>(null);

  useEffect(() => {
    fetchFullHistory();
  }, []);

  const [filterSymbol, setFilterSymbol] = useState('All');
  const [modeFilter, setModeFilter] = useState<'all' | 'live' | 'paper'>('all');

  const closedTrades = trades.filter(t => t.status === 'closed');
  const symbols = ['All', ...new Set(closedTrades.map(t => t.symbol))];

  const filteredTrades = closedTrades.filter(t => {
    const symbolMatch = filterSymbol === 'All' || t.symbol === filterSymbol;
    const modeMatch =
      modeFilter === 'all' ||
      (modeFilter === 'live' && !t.is_paper) ||
      (modeFilter === 'paper' && t.is_paper);
    return symbolMatch && modeMatch;
  });

  const totalTrades = filteredTrades.length;
  const winRate = totalTrades > 0
    ? (filteredTrades.filter(t => (t.r || 0) > 0).length / totalTrades * 100).toFixed(1)
    : '0';
  const sumR = filteredTrades.reduce((acc, t) => acc + (t.r || 0), 0);

  const selectedSymbolTrades = selectedTrade
    ? closedTrades.filter(t => t.symbol === selectedTrade.symbol)
    : [];

  const symbolWinRate = selectedSymbolTrades.length > 0
    ? (selectedSymbolTrades.filter(t => (t.r || 0) > 0).length / selectedSymbolTrades.length * 100).toFixed(1)
    : '0';

  const avgHoldTime = selectedSymbolTrades.length > 0
    ? Math.floor(selectedSymbolTrades.reduce((acc, t) => acc + (t.bars_held || 0), 0) / selectedSymbolTrades.length)
    : 0;

  return (
    <div className="space-y-8 pb-20">
      {backendError && (
        <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl text-rose-400 text-xs font-bold uppercase tracking-widest text-center shadow-lg">
          Connectivity Warning: {backendError}
        </div>
      )}

      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-bold tracking-tight text-white uppercase italic">
            Trade History
          </h2>
          <p className="text-zinc-500 text-sm font-medium">
            {fullHistoryLoaded
              ? `${totalTrades.toLocaleString()} closed trades`
              : 'Loading full history...'}
          </p>
        </div>
        <button className="flex items-center gap-2 px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-100 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border border-zinc-800 shadow-xl active:scale-95 group">
          <Download size={14} className="text-zinc-500 group-hover:text-emerald-500 transition-colors" />
          Export Data
        </button>
      </div>

      {/* Aggregate stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 bg-zinc-900/50 border border-zinc-800/50 rounded-3xl p-8 backdrop-blur-sm shadow-2xl">
        {[
          { label: 'Total Trades', value: totalTrades, mono: true },
          { label: 'Win Rate', value: `${winRate}%`, color: 'text-emerald-400' },
          { label: 'Net R', value: formatR(sumR), color: sumR >= 0 ? 'text-emerald-400' : 'text-rose-400' },
          { label: 'Expected Value', value: formatR(totalTrades > 0 ? sumR / totalTrades : 0), color: 'text-zinc-300' },
        ].map(({ label, value, color, mono }) => (
          <div key={label} className="flex flex-col gap-1 border-l-2 border-l-zinc-800 pl-6">
            <span className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em]">{label}</span>
            <span className={cn('text-4xl font-black font-mono tracking-tighter', color || 'text-white')}>
              {String(value)}
            </span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center flex-1 gap-3 bg-zinc-900/50 p-2.5 rounded-2xl border border-zinc-800/50 backdrop-blur-sm">
          <div className="flex items-center gap-2 px-3 text-zinc-500 shrink-0">
            <Filter size={14} className="text-emerald-500" />
            <span className="text-[11px] font-black uppercase tracking-widest">Asset</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1.5 sm:pb-0 flex-1 px-2 custom-scrollbar">
            {symbols.map(s => (
              <button
                key={s}
                onClick={() => setFilterSymbol(s)}
                className={cn(
                  'px-4 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all shrink-0 border',
                  filterSymbol === s
                    ? 'bg-white text-zinc-950 border-white shadow-xl'
                    : 'text-zinc-400 border-zinc-800 hover:text-zinc-100 hover:bg-zinc-800/50',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-zinc-800/50 gap-1.5 shrink-0 backdrop-blur-sm">
          {(['all', 'live', 'paper'] as const).map(m => (
            <button
              key={m}
              onClick={() => setModeFilter(m)}
              className={cn(
                'px-5 py-2 rounded-xl text-[10px] font-black uppercase transition-all tracking-[0.15em]',
                modeFilter === m
                  ? 'bg-zinc-800 text-white shadow-2xl border border-zinc-700'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Table + Slideover Panel */}
      <div className="flex gap-6">
        <div className={cn(
          "bg-zinc-900/50 border border-zinc-800/50 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-sm transition-all duration-300",
          selectedTrade ? "flex-1 min-w-0" : "flex-1"
        )}>
          <div className="overflow-x-auto min-h-[400px]">
            <table className="w-full text-left whitespace-nowrap">
              <thead>
                <tr className="bg-zinc-800/30 text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-bold">
                  <th className="px-8 py-5">Symbol / Date</th>
                  <th className="px-8 py-5">Mode</th>
                  <th className="px-8 py-5">Entry / Exit</th>
                  <th className="px-8 py-5 text-center">Outcome</th>
                  <th className="px-8 py-5">R Result</th>
                  <th className="px-8 py-5">Duration</th>
                  <th className="px-8 py-5">On-Chain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredTrades.map(trade => (
                  <tr
                    key={trade.id}
                    onClick={() => setSelectedTrade(selectedTrade?.id === trade.id ? null : trade)}
                    className={cn(
                      "hover:bg-zinc-800/20 transition-all group cursor-pointer border-l-4",
                      selectedTrade?.id === trade.id ? "border-l-emerald-500 bg-emerald-500/5" : "border-l-transparent hover:border-l-emerald-500/30"
                    )}
                  >
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center font-bold text-sm text-zinc-300 border border-zinc-700/30">
                          {trade.symbol.slice(0, 2)}
                        </div>
                        <div>
                          <span className="font-bold text-base tracking-tight text-white italic block">{trade.symbol}</span>
                          <span className="text-[10px] text-zinc-500 font-mono">{formatDate(trade.opened_at)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <span className={cn(
                        'px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border',
                        trade.is_paper
                          ? 'bg-amber-500/5 text-amber-500 border-amber-500/20'
                          : 'bg-purple-500/5 text-purple-500 border-purple-500/20',
                      )}>
                        {trade.is_paper ? 'Paper' : 'Live'}
                      </span>
                    </td>
                    <td className="px-8 py-6 font-mono font-bold">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500 text-[9px] w-6">IN:</span>
                          <span className="text-zinc-200 text-sm">${formatCurrency(trade.entry)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-500 text-[9px] w-6">OUT:</span>
                          <span className={cn('text-sm', trade.exit_price ? ((trade.direction === 'long' ? (trade.exit_price > trade.entry) : (trade.exit_price < trade.entry)) ? 'text-emerald-400' : 'text-rose-500') : 'text-zinc-500')}>
                            {trade.exit_price ? `$${formatCurrency(trade.exit_price)}` : '—'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-center">
                      <span className={cn(
                        'px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest',
                        (trade.r || 0) > 0.1 ? 'bg-emerald-500/10 text-emerald-500' :
                        (trade.r || 0) < -0.1 ? 'bg-rose-500/10 text-rose-400' :
                        'bg-zinc-800 text-zinc-500',
                      )}>
                        {(trade.r || 0) > 0.1 ? 'Win' : (trade.r || 0) < -0.1 ? 'Loss' : 'Break-even'}
                      </span>
                    </td>
                    <td className={cn(
                      'px-8 py-6 font-black font-mono text-xl tracking-tighter',
                      (trade.r || 0) >= 0 ? 'text-emerald-400' : 'text-rose-500',
                    )}>
                      {formatR(trade.r)}
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <span className="text-white font-bold text-xs">{trade.bars_held}m</span>
                        <span className="text-[10px] text-zinc-500">
                          {trade.closed_at ? formatDate(trade.closed_at) : 'Open'}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      {trade.mantle_tx_hash ? (
                        <a
                          href={`https://explorer.mantle.xyz/tx/${trade.mantle_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1 text-violet-400 text-[10px] font-mono hover:underline"
                        >
                          {trade.mantle_tx_hash.slice(0, 8)}...
                          <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span className="text-zinc-700 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredTrades.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-8 py-32 text-center">
                      <div className="flex flex-col items-center gap-4 opacity-40">
                        <Database size={48} className="text-zinc-500" />
                        <p className="text-base font-bold text-zinc-500 italic">
                          {fullHistoryLoaded ? 'No trades match current filters' : 'Loading history...'}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Slide-over panel */}
        <AnimatePresence>
          {selectedTrade && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden shrink-0"
            >
              <div className="w-[360px] bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg">{selectedTrade.symbol}</h3>
                  <button
                    onClick={() => setSelectedTrade(null)}
                    className="p-2 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Symbol Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-zinc-800/50 rounded-xl p-4">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Win Rate</span>
                    <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">{symbolWinRate}%</div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-xl p-4">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Avg Hold</span>
                    <div className="text-2xl font-bold font-mono text-white mt-1">{avgHoldTime}m</div>
                  </div>
                </div>

                {/* Last 5 Trades */}
                <div>
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Clock size={12} />
                    Last 5 Trades
                  </h4>
                  <div className="space-y-2">
                    {selectedSymbolTrades.slice(0, 5).map((t, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-zinc-800/30 rounded-xl">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-xs font-bold',
                            (t.r || 0) > 0 ? 'text-emerald-400' : 'text-rose-400'
                          )}>
                            {t.direction === 'long' ? <ArrowUpRight size={14} className="inline" /> : <ArrowDownRight size={14} className="inline" />}
                          </span>
                          <span className="text-xs text-zinc-400 font-mono">{formatDate(t.closed_at || t.opened_at)}</span>
                        </div>
                        <span className={cn('text-sm font-bold font-mono',
                          (t.r || 0) >= 0 ? 'text-emerald-400' : 'text-rose-500'
                        )}>
                          {formatR(t.r)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* On-chain info */}
                {selectedTrade.mantle_tx_hash && (
                  <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4">
                    <span className="text-[10px] text-violet-400 uppercase tracking-widest font-bold">On-Chain Tx</span>
                    <a
                      href={`https://explorer.mantle.xyz/tx/${selectedTrade.mantle_tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs font-mono text-violet-400 hover:underline mt-1 break-all"
                    >
                      {selectedTrade.mantle_tx_hash}
                      <ExternalLink size={10} className="inline ml-1" />
                    </a>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
