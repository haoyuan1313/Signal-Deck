import { useParams, Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { ChevronLeft, TrendingUp, History, Database, Zap, Activity } from 'lucide-react';
import { formatR, cn, formatDate, formatCurrency, timeAgo } from '../lib/utils';
import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, ISeriesApi, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { motion } from 'motion/react';

export default function SymbolDetail() {
  const params     = useParams();
  const rawSymbol  = params.symbol;
  const splat      = params['*'];
  const symbol     = splat
    ? `${rawSymbol}/${splat.replace(/^\//, '')}`.toUpperCase()
    : rawSymbol?.toUpperCase() || '';

  const { trades, signals, prices, settings } = useStore();
  const chartContainerRef   = useRef<HTMLDivElement>(null);
  const chartRef            = useRef<any>(null);
  const candleSeriesRef     = useRef<ISeriesApi<any> | null>(null);
  const [ohlcvData,         setOhlcvData]         = useState<any[]>([]);
  const [selectedSignalId,  setSelectedSignalId]  = useState<string | null>(null);

  const symbolTrades  = React.useMemo(() => trades.filter(t => t.symbol === symbol), [trades, symbol]);
  const symbolSignals = React.useMemo(() => signals.filter(s => s.symbol === symbol).slice(0, 10), [signals, symbol]);
  const openTrade     = React.useMemo(() => symbolTrades.find(t => t.status === 'open'), [symbolTrades]);
  const isWhitelisted = React.useMemo(() => settings?.symbols.includes(symbol || ''), [settings?.symbols, symbol]);

  const totalR  = React.useMemo(() => symbolTrades.reduce((a, t) => a + (t.r || 0), 0), [symbolTrades]);
  const winRate = React.useMemo(() => {
    const closed = symbolTrades.filter(t => t.status === 'closed');
    return closed.length > 0
      ? ((symbolTrades.filter(t => (t.r || 0) > 0).length / closed.length) * 100).toFixed(1)
      : '0';
  }, [symbolTrades]);

  // Fetch OHLCV once
  useEffect(() => {
    if (!symbol) return;
    fetch(`/api/ohlcv?symbol=${encodeURIComponent(symbol)}&limit=200`)
      .then(r => r.json())
      .then(setOhlcvData)
      .catch(err => console.error('OHLCV fetch failed:', err));
  }, [symbol]);

  // UPGRADE: chart init effect — runs only when ohlcvData changes (heavy).
  // Previously selectedSignalId was in the dependency array, which destroyed
  // and recreated the entire chart on every signal click, causing a flicker.
  // Now the chart is built once; markers are updated in a separate effect below.
  useEffect(() => {
    if (!chartContainerRef.current || ohlcvData.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor:  '#a1a1aa',
      },
      grid: {
        vertLines: { color: '#27272a' },
        horzLines: { color: '#27272a' },
      },
      width:  chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: { borderColor: '#27272a' },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:     '#10b981',
      downColor:   '#ef4444',
      borderVisible: false,
      wickUpColor:   '#10b981',
      wickDownColor: '#ef4444',
    });

    candleSeries.setData(ohlcvData);
    candleSeriesRef.current = candleSeries;
    chartRef.current        = chart;

    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef.current?.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current    = null;
      candleSeriesRef.current = null;
    };
  }, [ohlcvData]); // ← only ohlcvData here — not selectedSignalId

  // UPGRADE: markers-only effect — runs when trades or selected signal changes.
  // Lightweight update with no chart teardown = no flicker on signal selection.
  useEffect(() => {
    if (!candleSeriesRef.current || ohlcvData.length === 0) return;

    const firstTime = typeof ohlcvData[0].time === 'string'
      ? new Date(ohlcvData[0].time).getTime() / 1000
      : ohlcvData[0].time;
    const lastTime  = typeof ohlcvData[ohlcvData.length - 1].time === 'string'
      ? new Date(ohlcvData[ohlcvData.length - 1].time).getTime() / 1000
      : ohlcvData[ohlcvData.length - 1].time;

    const tradeMarkers = symbolTrades
      .filter(t => t.opened_at)
      .map(t => {
        const ts = new Date(t.opened_at).getTime() / 1000;
        return {
          time:     ts,
          position: t.direction === 'long' ? 'belowBar' : 'aboveBar' as any,
          color:    t.direction === 'long' ? '#10b981' : '#ef4444',
          shape:    t.direction === 'long' ? 'arrowUp'  : 'arrowDown' as any,
          text:     `${t.direction.toUpperCase()} @ ${formatCurrency(t.entry)}`,
        };
      });

    const signalMarkers = selectedSignalId
      ? signals
          .filter(s => s.id === selectedSignalId)
          .map(s => ({
            time:     new Date(s.created_at).getTime() / 1000,
            position: 'inBar' as any,
            color:    '#fbbf24',
            shape:    'circle' as any,
            text:     'SIGNAL',
            size:     2,
          }))
      : [];

    const allMarkers = [...tradeMarkers, ...signalMarkers].filter(m => {
      const t = typeof m.time === 'number' ? m.time : new Date(m.time as any).getTime() / 1000;
      return t >= firstTime && t <= lastTime;
    });

    try {
      createSeriesMarkers(candleSeriesRef.current, allMarkers as any);
    } catch {}

    // Scroll chart to the selected signal if it's in the data range
    if (selectedSignalId && chartRef.current) {
      const sig = signals.find(s => s.id === selectedSignalId);
      if (sig) {
        const sigTime = new Date(sig.created_at).getTime() / 1000;
        if (sigTime >= firstTime && sigTime <= lastTime) {
          const range = 3600 * 2;
          chartRef.current.timeScale().setVisibleRange({
            from: (sigTime - range) as any,
            to:   (sigTime + range) as any,
          });
        }
      }
    }
  }, [symbolTrades, selectedSignalId, signals, ohlcvData]);

  return (
    <div className="space-y-6 md:space-y-8 pb-20">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all shadow-lg active:scale-95"
          >
            <ChevronLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white uppercase italic">
                {symbol}
              </h2>
              {!isWhitelisted && (
                <span className="text-[9px] bg-zinc-800 text-zinc-500 px-2 py-1 rounded-lg font-bold uppercase tracking-widest border border-zinc-700">
                  Not Tracked
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5 px-2 py-0.5 bg-zinc-800/50 rounded-lg w-fit border border-zinc-700/30">
              <span className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest">Mark:</span>
              <span className="text-emerald-400 font-mono font-bold text-xs">
                {prices[symbol!] ? formatCurrency(prices[symbol!]) : '---'}
              </span>
            </div>
          </div>
        </div>

        {openTrade && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-4 p-4 md:p-5 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl shadow-xl"
          >
            <div className="p-3 bg-emerald-500 rounded-xl shadow-lg shadow-emerald-500/20">
              <Activity className="text-zinc-950" size={20} />
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-0.5">
                Live Exposure
              </div>
              <div className="flex items-center justify-between gap-6">
                <div className="flex items-center gap-3 text-sm font-bold mt-1 shrink-0">
                  <span className={cn('uppercase px-2 rounded bg-emerald-500/10', openTrade.direction === 'long' ? 'text-emerald-400' : 'text-rose-400')}>
                    {openTrade.direction}
                  </span>
                  <span className="text-zinc-400 font-mono">In: {formatCurrency(openTrade.entry)}</span>
                </div>
                
                {(() => {
                  const currentPrice = prices[openTrade.symbol] || openTrade.entry;
                  const slRef = openTrade.sl_init || (openTrade.be_armed ? null : openTrade.sl);
                  const riskAmt = slRef ? Math.abs(openTrade.entry - slRef) : Math.abs(openTrade.entry - openTrade.sl) || (openTrade.entry * 0.005);
                  const pnl = (openTrade.direction === 'long' ? (currentPrice - openTrade.entry) : (openTrade.entry - currentPrice)) / riskAmt;
                  return (
                    <div className="flex items-end gap-1.5">
                      <span className={cn("font-mono text-2xl font-black tracking-tighter", pnl >= 0 ? "text-emerald-400" : "text-rose-500")}>
                        {formatR(pnl)}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-bold mb-1">R</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {[
          { label: 'Symbol Return', value: formatR(totalR), color: totalR >= 0 ? 'text-emerald-400' : 'text-rose-400' },
          { label: 'Alpha Ratio',   value: `${winRate}%`,   color: 'text-emerald-400' },
          { label: 'Instance Count', value: symbolTrades.filter(t => t.status === 'closed').length, color: 'text-white' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-900/50 border border-zinc-800/50 rounded-2xl p-6 flex flex-col gap-2 backdrop-blur-sm shadow-lg">
            <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-bold uppercase tracking-widest">
              <TrendingUp size={12} className="text-emerald-500" /> {label}
            </div>
            <span className={cn('text-3xl md:text-4xl font-black font-mono tracking-tighter', color)}>
              {String(value)}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Chart */}
        <div className="lg:col-span-2 bg-zinc-900/50 border border-zinc-800/50 rounded-3xl p-6 md:p-8 overflow-hidden backdrop-blur-sm shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <h3 className="font-bold text-sm uppercase tracking-widest text-zinc-400">Market View</h3>
            <div className="flex gap-4 text-[10px] text-zinc-500 font-bold uppercase bg-zinc-950/50 px-4 py-2 rounded-xl border border-zinc-800/50">
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Execution</div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-rose-500" /> Invalidation</div>
            </div>
          </div>
          <div className="min-h-[350px] md:min-h-[450px]">
            {ohlcvData.length > 0
              ? <div ref={chartContainerRef} className="rounded-2xl overflow-hidden border border-zinc-800/50 shadow-inner" />
              : (
                <div className="h-[400px] flex flex-col items-center justify-center text-zinc-700 gap-4 border border-dashed border-zinc-800 rounded-3xl">
                  <div className="w-12 h-12 rounded-full border-2 border-t-emerald-500 border-zinc-800 animate-spin" />
                  <p className="text-[10px] italic uppercase tracking-[0.2em] font-black">Loading chart data...</p>
                </div>
              )
            }
          </div>
        </div>

        {/* Signal list */}
        <div className="bg-zinc-900/50 border border-zinc-800/50 rounded-3xl p-6 md:p-8 flex flex-col md:h-[600px] backdrop-blur-sm shadow-2xl">
          <div className="flex items-center gap-2 mb-6 shrink-0">
            <Zap size={20} className="text-amber-500" />
            <h3 className="font-bold text-sm uppercase tracking-widest text-zinc-400">Signals</h3>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
            {symbolSignals.length > 0
              ? symbolSignals.map(signal => (
                <motion.div
                  key={signal.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  onClick={() => setSelectedSignalId(signal.id === selectedSignalId ? null : signal.id)}
                  className={cn(
                    'p-4 rounded-2xl border transition-all cursor-pointer',
                    selectedSignalId === signal.id
                      ? 'bg-zinc-800/80 border-emerald-500/50 shadow-2xl'
                      : 'bg-zinc-800/20 border-zinc-800/50 hover:bg-zinc-800/50',
                  )}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className={cn(
                      'text-[9px] font-black uppercase py-1 px-3 rounded-lg tracking-widest border',
                      signal.direction === 'long'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/20',
                    )}>
                      {signal.direction}
                    </span>
                    <span className="text-[9px] text-zinc-600 font-mono">{timeAgo(signal.created_at)}</span>
                  </div>
                  <div className="text-xs text-white font-bold tracking-tight">
                    {signal.reason === 'accepted' ? 'Setup Confirmed' : signal.reason.replace(/_/g, ' ')}
                  </div>
                </motion.div>
              ))
              : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-700 gap-4 opacity-50 text-center">
                  <Zap size={32} className="text-zinc-600" />
                  <p className="text-[11px] italic uppercase font-black tracking-widest">Awaiting Telemetry</p>
                </div>
              )
            }
          </div>
        </div>
      </div>

      {/* Trade log */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="p-6 md:p-8 border-b border-zinc-800 flex items-center gap-3">
          <History size={20} className="text-emerald-500" />
          <h3 className="font-bold text-lg tracking-tight">Trade History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="bg-zinc-800/30 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                <th className="px-6 py-5">Date</th>
                <th className="px-6 py-5">Direction</th>
                <th className="px-6 py-5">Entry / Exit</th>
                <th className="px-6 py-5">R Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {symbolTrades.length > 0
                ? [...symbolTrades]
                    .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime())
                    .map(trade => (
                      <tr key={trade.id} className="hover:bg-zinc-800/20 transition-all">
                        <td className="px-6 py-5 text-[11px] text-zinc-300 font-mono">{formatDate(trade.opened_at)}</td>
                        <td className="px-6 py-5">
                          <span className={cn(
                            'text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border',
                            trade.direction === 'long'
                              ? 'text-emerald-400 bg-emerald-500/5 border-emerald-500/20'
                              : 'text-rose-400 bg-rose-500/5 border-rose-500/20',
                          )}>
                            {trade.direction}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col gap-0.5 font-mono">
                            <div className="text-[11px] text-white font-bold">${formatCurrency(trade.entry)}</div>
                            <div className="text-[9px] text-zinc-600">
                              {trade.exit_price ? `OUT: $${formatCurrency(trade.exit_price)}` : 'Open'}
                            </div>
                          </div>
                        </td>
                        <td className={cn(
                          'px-6 py-5 font-mono font-black text-lg tracking-tighter',
                          (trade.r || 0) >= 0 ? 'text-emerald-400' : 'text-rose-500',
                        )}>
                          {formatR(trade.r)}
                        </td>
                      </tr>
                    ))
                : (
                  <tr>
                    <td colSpan={4} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-4 text-zinc-700">
                        <Activity size={40} />
                        <p className="text-sm font-medium italic">No trade history for {symbol}.</p>
                      </div>
                    </td>
                  </tr>
                )
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}