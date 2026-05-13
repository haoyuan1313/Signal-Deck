import { useStore } from '../store/useStore';
import { useEffect, useState, useMemo } from 'react';
import { formatR, formatCurrency, cn, formatDate, timeAgo } from '../lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { ArrowUpRight, ArrowDownRight, TrendingUp, Activity, Package, Percent, ExternalLink, Terminal, Brain } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { KPISkeleton, Skeleton } from '../components/Skeleton';

function KPICard({ title, value, subtext, icon: Icon, colorClass }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-1 shadow-sm relative overflow-hidden"
    >
      <div className="flex justify-between items-start relative z-10">
        <span className="text-zinc-500 text-sm font-medium">{title}</span>
        <div className={cn('p-2 rounded-lg bg-zinc-800', colorClass)}>
          <Icon size={18} />
        </div>
      </div>
      <div className="text-3xl font-bold font-mono tracking-tight my-2 relative z-10">{value}</div>
      <div className="text-xs text-zinc-500 flex items-center gap-1 relative z-10">{subtext}</div>
      <div className={cn('absolute -right-4 -bottom-4 opacity-5', colorClass)}>
        <Icon size={80} />
      </div>
    </motion.div>
  );
}

// FIX: resolve a price from the store under both spot and swap key formats.
// The trade DB record may store "TAO/USDT:USDT" (swap) while the price store
// key could be either format depending on what the server returned.
function resolvePrice(
  prices: Record<string, number>,
  symbol: string,
): number | null {
  if (prices[symbol] !== undefined) return prices[symbol];

  // Try stripping the swap suffix: "TAO/USDT:USDT" → "TAO/USDT"
  if (symbol.includes(':')) {
    const base = symbol.split(':')[0];
    if (prices[base] !== undefined) return prices[base];
  }

  // Try adding the swap suffix: "TAO/USDT" → "TAO/USDT:USDT"
  if (!symbol.includes(':') && symbol.includes('/')) {
    const quote   = symbol.split('/')[1];
    const swapKey = `${symbol}:${quote}`;
    if (prices[swapKey] !== undefined) return prices[swapKey];
  }

  return null; // price not yet received — caller must handle this
}

export default function Dashboard() {
  const { trades, signals, logs, botLive, lastHeartbeat, prices, loading, fetchLogs, fetchInitialData, backendError, settings } = useStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'all' | 'live' | 'paper'>('all');

  useEffect(() => {
    const logInterval  = setInterval(fetchLogs, 5000);
    const dataInterval = setInterval(() => fetchInitialData(true), 30000);
    return () => { clearInterval(logInterval); clearInterval(dataInterval); };
  }, [fetchLogs, fetchInitialData]);

  const filteredTrades = useMemo(() => trades.filter(t => {
    if (activeTab === 'all')   return true;
    if (activeTab === 'live')  return !t.is_paper;
    if (activeTab === 'paper') return t.is_paper;
    return true;
  }), [trades, activeTab]);

  const closedTrades  = useMemo(() => filteredTrades.filter(t => t.status === 'closed'), [filteredTrades]);
  const openTrades    = useMemo(() => filteredTrades.filter(t => t.status === 'open'),   [filteredTrades]);
  const last30dTrades = useMemo(() => closedTrades.filter(t =>
    t.closed_at && new Date(t.closed_at).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000
  ), [closedTrades]);

  const winRate = useMemo(() => last30dTrades.length > 0
    ? (last30dTrades.filter(t => (t.r || 0) > 0).length / last30dTrades.length * 100).toFixed(1)
    : '0.0',
  [last30dTrades]);

  const totalR = useMemo(() => closedTrades.reduce((acc, t) => acc + (t.r || 0), 0), [closedTrades]);

  const { profitFactor } = useMemo(() => {
    const grossProfit = closedTrades.filter(t => (t.r || 0) > 0).reduce((acc, t) => acc + (t.r || 0), 0);
    const grossLoss   = Math.abs(closedTrades.filter(t => (t.r || 0) < 0).reduce((acc, t) => acc + (t.r || 0), 0));
    return { profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? 'INF' : '0.00') };
  }, [closedTrades]);

  const avgDuration = useMemo(() => {
    const total = closedTrades.reduce((acc, t) => acc + (t.bars_held || 0), 0);
    return closedTrades.length > 0 ? Math.floor(total / closedTrades.length) : 0;
  }, [closedTrades]);

  const avgR = useMemo(() =>
    closedTrades.length > 0 ? (totalR / closedTrades.length).toFixed(2) : '0.00',
  [totalR, closedTrades.length]);

  const equityData = useMemo(() => {
    const sorted = [...closedTrades].sort(
      (a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime()
    );
    const step = Math.max(1, Math.floor(sorted.length / 500));
    let cumulativeR = 0;
    const data = sorted
      .filter((_, i) => i % step === 0)
      .map(trade => {
        cumulativeR += trade.r || 0;
        return { name: formatDate(trade.closed_at!), cumulativeR: +cumulativeR.toFixed(2) };
      });
    data.unshift({ name: 'Start', cumulativeR: 0 });
    return data;
  }, [closedTrades]);

  if (loading) {
    return (
      <div className="space-y-8 pb-12">
        <header className="flex flex-col gap-1">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </header>
        <KPISkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Skeleton className="lg:col-span-2 h-[400px] rounded-2xl" />
          <Skeleton className="h-[400px] rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-10 pb-20">
      {backendError && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex flex-col sm:flex-row items-center gap-4 text-rose-400"
        >
          <Activity size={24} className="shrink-0 hidden sm:block" />
          <div className="flex-1 text-center sm:text-left">
            <h4 className="text-sm font-bold uppercase tracking-tight">System Alert</h4>
            <p className="text-xs opacity-80">{backendError}</p>
          </div>
          <button onClick={() => window.location.reload()} className="w-full sm:w-auto text-xs bg-rose-500/20 hover:bg-rose-500/30 px-6 py-2 sm:py-1.5 rounded-xl font-bold transition-all">
            Reconnect
          </button>
        </motion.div>
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent">
            Executive Dashboard
          </h2>
          <p className="text-zinc-500 text-sm max-w-lg">Real-time performance monitoring across all algorithmic trade flows.</p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="flex bg-zinc-900/50 p-1 rounded-xl border border-zinc-800/50 backdrop-blur-sm self-start sm:self-auto">
            {(['all', 'live', 'paper'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all',
                  activeTab === tab ? 'bg-zinc-800 text-zinc-100 shadow-xl' : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className={cn(
              'flex flex-col items-end px-4 py-2 rounded-xl border transition-all shadow-lg',
              botLive
                ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-500',
            )}>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                <div className={cn('w-2 h-2 rounded-full shadow-[0_0_10px]', botLive ? 'bg-emerald-500 animate-pulse shadow-emerald-500/50' : 'bg-zinc-600')} />
                Status: {botLive ? 'Live' : 'Stopped'}
              </div>
              {lastHeartbeat && (
                <span className="text-[9px] opacity-60 font-mono mt-0.5">{timeAgo(lastHeartbeat)}</span>
              )}
            </div>

            {settings && (
              <div className={cn(
                'hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest shadow-lg',
                settings.paper_trading
                  ? 'bg-amber-500/5 border-amber-500/20 text-amber-500'
                  : 'bg-purple-500/5 border-purple-500/20 text-purple-400',
              )}>
                {settings.paper_trading ? <Package size={14} /> : <TrendingUp size={14} />}
                {settings.paper_trading ? 'Paper Mode' : 'Live Alpha'}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <KPICard title="Win Rate (30d)" value={`${winRate}%`} subtext={`${last30dTrades.filter(t => (t.r || 0) > 0).length} wins`} icon={Percent} colorClass="text-emerald-400" />
        <KPICard title="Total PnL" value={formatR(totalR)} subtext={`Profit Factor: ${profitFactor}`} icon={TrendingUp} colorClass={totalR >= 0 ? 'text-emerald-400' : 'text-rose-400'} />
        <KPICard title="Open Positions" value={openTrades.length} subtext={openTrades.length > 0 ? `Risked on ${openTrades[0].symbol}` : 'Scanning...'} icon={Activity} colorClass="text-amber-400" />
        <KPICard title="Avg R / Trade" value={`${avgR}R`} subtext={`Avg hold: ~${avgDuration}m`} icon={Brain} colorClass="text-zinc-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
        {/* Equity curve */}
        <div className="md:col-span-2 bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 md:p-8 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-bold text-lg tracking-tight">Equity Performance</h3>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Cumulative R-Units</p>
            </div>
            <span className="hidden sm:block text-[10px] bg-emerald-500/10 text-emerald-500 px-3 py-1 rounded-full font-bold uppercase tracking-widest border border-emerald-500/20">
              Live Feed
            </span>
          </div>
          <div className="h-[250px] sm:h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="colorR" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} opacity={0.3} />
                <XAxis dataKey="name" stroke="#52525b" fontSize={9} tickLine={false} axisLine={false} hide={equityData.length < 2} dy={10} />
                <YAxis stroke="#52525b" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `${v}R`} dx={-10} />
                <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', fontSize: '12px' }} itemStyle={{ color: '#10b981' }} cursor={{ stroke: '#10b981', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="cumulativeR" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorR)" animationDuration={1500} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bot console */}
        <div className="md:col-span-2 lg:col-span-1 bg-black rounded-3xl p-6 flex flex-col h-[400px] border border-zinc-800 shadow-2xl overflow-hidden group">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <div className="flex items-center gap-2">
              <Terminal size={18} className="text-emerald-500" />
              <h3 className="font-bold text-xs uppercase tracking-widest text-zinc-400">Engine Console</h3>
            </div>
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500/20" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/20" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20" />
            </div>
          </div>
          <div className="flex-1 bg-zinc-950/80 rounded-2xl p-5 font-mono text-[10px] overflow-y-auto space-y-2 custom-scrollbar scroll-smooth border border-zinc-900">
            {logs.length > 0 ? logs.map(log => (
              <div key={log.id} className="flex gap-3 leading-relaxed">
                <span className="text-zinc-700 shrink-0 select-none">#{log.created_at.split('T')[1].slice(0, 8)}</span>
                <span className={cn(
                  'break-all',
                  log.type === 'loop'   && 'text-emerald-500 font-bold',
                  log.type === 'check'  && 'text-zinc-500',
                  log.type === 'accept' && 'text-white bg-emerald-500/20 px-1 rounded',
                  log.type === 'reject' && 'text-rose-400',
                  log.type === 'info'   && 'text-zinc-500',
                )}>
                  {log.message}
                </span>
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center h-full text-zinc-700 italic gap-4">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-emerald-500/20 border-zinc-900" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Initializing...</p>
              </div>
            )}
          </div>
        </div>

        {/* Signal feed */}
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 overflow-hidden flex flex-col md:max-h-[480px] backdrop-blur-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-lg tracking-tight">Signal Feed</h3>
            <button onClick={() => navigate('/signals')} className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 hover:underline">
              View All
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
            {signals.length > 0 ? signals.slice(0, 8).map((signal, idx) => (
              <motion.div
                key={signal.id}
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                viewport={{ once: true }}
                className="group flex flex-col gap-1.5 p-4 rounded-xl bg-zinc-800/30 border border-zinc-800/50 hover:bg-zinc-800/60 hover:border-emerald-500/30 transition-all cursor-pointer"
                onClick={() => navigate(`/symbols/${signal.symbol}`)}
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm tracking-tight text-white">{signal.symbol}</span>
                    <span className="text-[9px] text-zinc-500 font-mono">5m</span>
                  </div>
                  <span className={cn(
                    'text-[9px] px-2 py-0.5 rounded-lg font-bold uppercase tracking-tight border',
                    signal.reason === 'accepted'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-zinc-700/30 text-zinc-500 border-zinc-700/50',
                  )}>
                    {signal.reason === 'accepted' ? 'Accepted' : 'Skipped'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className={cn('flex items-center gap-1 font-bold uppercase', signal.direction === 'long' ? 'text-emerald-400' : 'text-rose-400')}>
                      {signal.direction === 'long' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {signal.direction}
                    </span>
                    <span className="opacity-30">|</span>
                    <span className="font-mono text-[10px]">{timeAgo(signal.created_at)}</span>
                  </div>
                  <ExternalLink size={12} className="text-zinc-700 group-hover:text-emerald-500 transition-colors" />
                </div>
              </motion.div>
            )) : (
              <div className="flex h-40 items-center justify-center text-zinc-600 italic text-xs">
                Waiting for signals...
              </div>
            )}
          </div>
        </div>

        {/* Open positions table */}
        <div className="lg:col-span-2 bg-zinc-900/50 border border-zinc-800/50 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-sm">
          <div className="p-6 md:p-8 border-b border-zinc-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="font-bold text-xl tracking-tight">Active Market Risk ({openTrades.length})</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">📡 Stream Active</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              Live Price Engine
            </div>
          </div>

          <div className="overflow-x-auto min-h-[200px]">
            <table className="w-full text-left whitespace-nowrap">
              <thead>
                <tr className="bg-zinc-800/30 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                  <th className="px-6 py-4">Symbol & Mode</th>
                  <th className="px-6 py-4">Entry / SL</th>
                  <th className="px-6 py-4 hidden md:table-cell">PnL (R)</th>
                  <th className="px-6 py-4 text-right">Current Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {openTrades.length > 0 ? openTrades.map(trade => {
                  // FIX: resolve price under both symbol formats
                  const currentPrice = resolvePrice(prices, trade.symbol);

                  // FIX: guard against sl_init being 0 or null (old trades inserted
                  // before the schema migration added the column).
                  // Fall back to sl, and if both are 0 or missing, use a small
                  // fraction of entry so we never divide by zero.
                  const slInit = trade.sl_init && trade.sl_init !== 0
                    ? trade.sl_init
                    : trade.sl && trade.sl !== 0
                    ? trade.sl
                    : null;

                  const riskAmt = slInit !== null
                    ? Math.abs(trade.entry - slInit)
                    : null;

                  // Only calculate PnL if we have both price and a valid risk amount
                  const pnl = currentPrice !== null && riskAmt !== null && riskAmt > 0
                    ? (trade.direction === 'long'
                        ? (currentPrice - trade.entry)
                        : (trade.entry - currentPrice)
                      ) / riskAmt
                    : null;

                  const priceLoading = currentPrice === null;

                  return (
                    <tr
                      key={trade.id}
                      className="hover:bg-zinc-800/20 transition-all group cursor-pointer"
                      onClick={() => navigate(`/symbols/${trade.symbol}`)}
                    >
                      <td className="px-6 py-6">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            'w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shadow-lg',
                            trade.direction === 'long' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500',
                          )}>
                            {trade.symbol[0]}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-base tracking-tight text-white">{trade.symbol}</span>
                            <div className="flex items-center gap-1.5">
                              <span className={cn('text-[9px] font-black uppercase px-1.5 rounded-md', trade.direction === 'long' ? 'text-emerald-500 bg-emerald-500/10' : 'text-rose-500 bg-rose-500/10')}>
                                {trade.direction}
                              </span>
                              <span className={cn('px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase', trade.is_paper ? 'bg-amber-500/10 text-amber-500' : 'bg-purple-500/10 text-purple-500')}>
                                {trade.is_paper ? 'Paper' : 'Live'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-6">
                        <div className="flex flex-col gap-1 font-mono">
                          <div className="flex items-center gap-1.5">
                            <span className="text-zinc-500 text-[10px]">IN:</span>
                            <span className="text-zinc-200 font-bold">${formatCurrency(trade.entry)}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-zinc-500 text-[10px]">SL:</span>
                            <span className="text-rose-400/80">${formatCurrency(trade.sl)}</span>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-6 hidden md:table-cell">
                        {priceLoading ? (
                          // Price not received yet — show spinner instead of 0.00R
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full border border-zinc-600 border-t-emerald-500 animate-spin" />
                            <span className="text-zinc-600 text-xs font-mono">fetching...</span>
                          </div>
                        ) : pnl === null ? (
                          <span className="text-zinc-600 text-xs font-mono">no sl data</span>
                        ) : (
                          <div className="flex items-end gap-2">
                            <span className={cn('font-mono font-black text-2xl tracking-tighter', pnl >= 0 ? 'text-emerald-400' : 'text-rose-500')}>
                              {formatR(pnl)}
                            </span>
                            <span className="text-[10px] font-bold text-zinc-500 mb-1">R-Unit</span>
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-6 text-right">
                        <div className="flex flex-col items-end gap-2">
                          {priceLoading ? (
                            <span className="text-zinc-600 text-xs font-mono animate-pulse">—</span>
                          ) : (
                            <span className={cn('font-bold text-xs font-mono', pnl !== null && pnl >= 0 ? 'text-emerald-400' : 'text-rose-500')}>
                              ${formatCurrency(currentPrice!)}
                            </span>
                          )}
                          {trade.be_armed ? (
                            <div className="px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[8px] font-black rounded-lg uppercase border border-amber-500/30">
                              Breakeven
                            </div>
                          ) : (
                            <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest group-hover:text-emerald-500 transition-colors">
                              Details →
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <Package className="text-zinc-800" size={48} />
                        <p className="text-zinc-500 italic text-sm">No active positions</p>
                        <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Scanning for setups...</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}