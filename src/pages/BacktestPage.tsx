import { useStore } from '../store/useStore';
import React, { useState, useEffect } from 'react';
import { 
  BarChart2, 
  Play, 
  TrendingUp, 
  History, 
  AlertCircle,
  TrendingDown,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCcw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Globe
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { runComprehensiveBacktest, BacktestOutput, DetailedResult, MonteCarloResult, ValidationWarning, Candle, Trade } from '../lib/backtester';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';

export default function BacktestPage() {
  const { settings } = useStore();
  const [selectedSymbol, setSelectedSymbol] = useState('BTC/USDT');
  const [timeframe, setTimeframe] = useState('5m');
  const [limit, setLimit] = useState(50000);
  const [initialBalance, setInitialBalance] = useState(10000);
  const [rr, setRr] = useState(2.0);
  const [riskPercent, setRiskPercent] = useState(1.0);
  const [allowedDirections, setAllowedDirections] = useState<string[]>(['long', 'short']);
  const [atrPeriod, setAtrPeriod] = useState(14);
  const [allowedSessions, setAllowedSessions] = useState<string[]>(['london', 'ny_am', 'ny_pm']);
  const [require4hAlign, setRequire4hAlign] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<BacktestOutput | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showMode, setShowMode] = useState<'ideal' | 'realistic'>('realistic');
  const tradesPerPage = 20;

  // Realism settings
  const [useCompounding, setUseCompounding] = useState(false);
  const [feePercent, setFeePercent] = useState(0.1);
  const [slippagePercent, setSlippagePercent] = useState(0.05);
  const [intrabarMode, setIntrabarMode] = useState<'conservative' | 'optimistic'>('conservative');

  // Reset pagination when output changes
  useEffect(() => {
    setCurrentPage(1);
  }, [output]);

  // Sync with Bot Config on load
  useEffect(() => {
    if (settings) {
      if (settings.symbols.length > 0) setSelectedSymbol(settings.symbols[0]);
      setTimeframe(settings.timeframe);
      setRr(settings.rr);
      setRiskPercent(settings.risk_percent || 1.0);
      setAllowedDirections(settings.allowed_directions);
      if (settings.bars) setLimit(settings.bars);
      if (settings.atr_period) setAtrPeriod(settings.atr_period);
      if (settings.allowed_sessions) setAllowedSessions(settings.allowed_sessions);
      setRequire4hAlign(settings.require_4h_align ?? true);
      // Optional: if settings had a balance we'd sync it here
    }
  }, [settings]);

  const startBacktest = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // SMC strategy specifically needs 5m data for entry and 1H reconstruction
      const response = await fetch(`/api/ohlcv?symbol=${encodeURIComponent(selectedSymbol)}&timeframe=5m&limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch market data');
      
      const data: Candle[] = await response.json();
      if (data.length < 500) throw new Error('Not enough data (need at least 500 5m bars).');

      const backtestResult = runComprehensiveBacktest(data, {
        initialBalance,
        rr,
        riskPercent,
        allowedDirections,
        atrPeriod,
        allowedSessions: allowedSessions as any,
        require4hAlign,
        useCompounding,
        feePercent: feePercent / 100,
        slippagePercent: slippagePercent / 100,
        intrabarMode,
      });
      setOutput(backtestResult);
      setLastUpdate(new Date());
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const winRateColor = (rate: number) => {
    if (rate >= 60) return 'text-emerald-400';
    if (rate >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  const activeResult = output ? (showMode === 'ideal' ? output.ideal : output.realistic) : null;
  const activeTrades = activeResult?.trades || [];

  const equityChartData = React.useMemo(() => {
    if (!activeResult?.equityCurve) return [];
    const step = Math.max(1, Math.floor(activeResult.equityCurve.length / 1000));
    return activeResult.equityCurve
      .filter((_, i) => i % step === 0)
      .map((val, i) => ({ step: i * step, balance: val }));
  }, [activeResult?.equityCurve]);

  const dataRange = React.useMemo(() => {
    if (!activeResult?.trades.length) return null;
    const start = new Date(Math.min(...activeResult.trades.map(t => t.entryTime)));
    const end = new Date(Math.max(...activeResult.trades.map(t => t.exitTime || t.entryTime)));
    return { start, end };
  }, [activeResult]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-4 uppercase italic">
            <div className="p-3 bg-emerald-500/10 rounded-2xl shadow-xl shadow-emerald-500/5">
              <TrendingUp className="text-emerald-400" size={28} />
            </div>
            Backtest Engine
          </h1>
          <p className="text-zinc-500 text-sm mt-2 flex items-center gap-3 font-medium">
            <span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-500" /> SMC 2.0 Execution</span>
            {dataRange && (
              <span className="flex items-center gap-2 ml-2 border-l border-zinc-800 pl-3">
                <span className="text-zinc-600 font-mono text-[11px] font-bold uppercase tracking-widest">
                  History: {dataRange.start.toLocaleDateString()} — {dataRange.end.toLocaleDateString()}
                </span>
              </span>
            )}
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 bg-zinc-900/50 border border-zinc-800/50 p-3 rounded-2xl shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-4 px-3">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-1">Asset</span>
              <select 
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="bg-zinc-800 text-xs font-black text-white px-4 py-2 rounded-xl outline-none border border-zinc-700/50 focus:ring-1 focus:ring-emerald-500/50 min-w-[140px] transition-all cursor-pointer uppercase italic"
              >
                {settings?.symbols.map(s => <option key={s} value={s}>{s}</option>) || (
                   <option value="BTC/USDT">BTC/USDT</option>
                )}
              </select>
            </div>
          </div>

          <div className="hidden sm:block w-[1px] h-10 bg-zinc-800/50" />

          <button 
            onClick={startBacktest}
            disabled={isLoading}
            className="flex items-center justify-center gap-3 px-8 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-black uppercase text-xs tracking-widest rounded-xl transition-all shadow-xl shadow-emerald-500/20 active:scale-95"
          >
            {isLoading ? <RefreshCcw size={18} className="animate-spin" /> : <Play size={18} fill="currentColor" />}
            <span>{isLoading ? 'Processing...' : 'Run Simulation'}</span>
          </button>
        </div>
      </div>

      {/* Advanced Config - Collapsible on small screens? Let's just make it a nice responsive grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 p-4 bg-zinc-900/30 border border-zinc-800/50 rounded-3xl">
        <div className="flex flex-col gap-1.5 p-3">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Initial Capital</span>
          <div className="flex items-center gap-3">
            <input 
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(parseInt(e.target.value) || 1000)}
              className="bg-zinc-800/50 text-base font-black font-mono text-white w-full outline-none rounded-xl px-4 py-2 border border-zinc-700/30 focus:border-white/50 transition-all font-mono"
            />
            <span className="text-xs font-bold text-zinc-600">$</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Risk Exposure</span>
          <div className="flex items-center gap-3">
            <input 
              type="number"
              step="0.1"
              value={riskPercent}
              onChange={(e) => setRiskPercent(parseFloat(e.target.value) || 1.0)}
              className="bg-zinc-800/50 text-base font-black font-mono text-amber-400 w-full outline-none rounded-xl px-4 py-2 border border-zinc-700/30 focus:border-amber-500/50 transition-all"
            />
            <span className="text-xs font-bold text-zinc-600">%</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Target Multiplier</span>
          <div className="flex items-center gap-3">
            <input 
              type="number"
              step="0.1"
              value={rr}
              onChange={(e) => setRr(parseFloat(e.target.value) || 2.0)}
              className="bg-zinc-800/50 text-base font-black font-mono text-emerald-400 w-full outline-none rounded-xl px-4 py-2 border border-zinc-700/30 focus:border-emerald-500/50 transition-all"
            />
            <span className="text-xs font-bold text-zinc-600">RR</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 p-3 text-white">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Sample Size</span>
          <div className="flex items-center gap-3">
            <input 
              type="number" 
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value) || 100)}
              className="bg-zinc-800/50 text-base font-black font-mono text-white w-full outline-none rounded-xl px-4 py-2 border border-zinc-700/30 focus:border-white/50 transition-all"
            />
            <span className="text-xs font-bold text-zinc-600">Bars</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Timeframe</span>
          <div className="flex items-center px-4 py-2 bg-zinc-800/50 border border-zinc-700/30 rounded-xl">
             <span className="text-base font-black font-mono text-zinc-300">5m</span>
             <span className="ml-auto text-[9px] font-bold text-zinc-500 uppercase italic">Execution</span>
          </div>
        </div>
      </div>

      {/* Realism settings */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-zinc-900/30 border border-zinc-800/50 rounded-3xl">
        <div className="flex flex-col gap-1.5 p-3">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Compounding</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={useCompounding} onChange={(e) => setUseCompounding(e.target.checked)} />
            <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
          </label>
          <span className="text-[9px] text-zinc-500">{useCompounding ? 'Risk scales with balance' : 'Fixed risk from initial'}</span>
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Fee %</span>
          <input type="number" step="0.01" value={feePercent} onChange={(e) => setFeePercent(parseFloat(e.target.value) || 0)}
            className="bg-zinc-800/50 text-sm font-black font-mono text-white w-24 outline-none rounded-xl px-3 py-2 border border-zinc-700/30" />
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Slippage %</span>
          <input type="number" step="0.01" value={slippagePercent} onChange={(e) => setSlippagePercent(parseFloat(e.target.value) || 0)}
            className="bg-zinc-800/50 text-sm font-black font-mono text-white w-24 outline-none rounded-xl px-3 py-2 border border-zinc-700/30" />
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em]">Intrabar</span>
          <button onClick={() => setIntrabarMode(m => m === 'conservative' ? 'optimistic' : 'conservative')}
            className={cn(
              "px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
              intrabarMode === 'conservative' ? "bg-rose-500/20 text-rose-400 border border-rose-500/30" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
            )}>
            {intrabarMode}
          </button>
          <span className="text-[9px] text-zinc-500">Conservative: SL triggers before TP if both hit same bar</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-6 space-y-6 shadow-xl backdrop-blur-sm">
           <div className="flex items-center gap-3 border-b border-zinc-800/50 pb-4">
             <div className="p-2 bg-amber-500/10 rounded-lg">
                <SettingsIcon size={16} className="text-amber-500" />
             </div>
             <h3 className="text-xs font-black text-white uppercase tracking-widest">Confluence Filter</h3>
           </div>
           
           <div className="space-y-6">
             <div className="space-y-3">
               <div className="flex justify-between items-center">
                 <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Trend Alignment (4H)</span>
                 <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={require4hAlign}
                      onChange={(e) => setRequire4hAlign(e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-emerald-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                 </label>
               </div>
               <p className="text-[10px] text-zinc-500 italic">Filter setups by 4H macro trend bias.</p>
             </div>

             <div className="space-y-3">
               <div className="flex justify-between items-center">
                 <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">ATR Lookback: {atrPeriod}</span>
               </div>
               <input 
                  type="range"
                  min="5"
                  max="50"
                  step="1"
                  value={atrPeriod}
                  onChange={(e) => setAtrPeriod(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-500"
               />
             </div>
           </div>
        </div>

        <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-6 space-y-6 shadow-xl backdrop-blur-sm md:col-span-2">
           <div className="flex items-center gap-3 border-b border-zinc-800/50 pb-4">
             <div className="p-2 bg-blue-500/10 rounded-lg">
                <Globe size={16} className="text-blue-500" />
             </div>
             <h3 className="text-xs font-black text-white uppercase tracking-widest">Market Sessions</h3>
           </div>

           <div className="flex flex-wrap gap-2">
             {[
               { id: 'asian', label: 'Asian', time: '0-7h' },
               { id: 'london', label: 'London', time: '7-12h' },
               { id: 'ny_am', label: 'NY AM', time: '12-17h' },
               { id: 'ny_pm', label: 'NY PM', time: '17-22h' },
               { id: 'late', label: 'Late', time: '22-0h' },
             ].map(s => (
               <button
                 key={s.id}
                 onClick={() => {
                   if (allowedSessions.includes(s.id)) setAllowedSessions(allowedSessions.filter(x => x !== s.id));
                   else setAllowedSessions([...allowedSessions, s.id]);
                 }}
                 className={cn(
                   "flex flex-col items-center justify-center min-w-[80px] p-2.5 rounded-xl border transition-all text-center gap-1",
                   allowedSessions.includes(s.id) 
                     ? "bg-zinc-100 border-white text-zinc-950 shadow-[0_0_20px_rgba(255,255,255,0.1)]" 
                     : "bg-zinc-800 border-transparent text-zinc-500 hover:border-zinc-700"
                 )}
               >
                 <span className="text-[10px] font-black uppercase tracking-tight">{s.label}</span>
                 <span className="text-[9px] font-bold opacity-60 font-mono italic">{s.time}</span>
               </button>
             ))}
           </div>
           <p className="text-[10px] text-zinc-500 italic mt-2 opacity-60">Session-based volatility filtering. SMC setups are historically cleaner in London & NY AM.</p>
        </div>
      </div>

      {error && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-red-500/5 border border-red-500/20 text-red-500 p-6 rounded-3xl flex items-center gap-4 shadow-2xl">
          <div className="p-2 bg-red-500/10 rounded-xl">
            <AlertCircle size={20} />
          </div>
          <p className="text-xs font-bold uppercase tracking-widest">{error}</p>
        </motion.div>
      )}

      {output ? (
        <>
          {/* Mode toggle & warnings */}
          <div className="flex flex-wrap items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
            <div className="flex items-center gap-2 bg-zinc-800 rounded-xl p-1">
              <button onClick={() => setShowMode('ideal')} className={cn(
                "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                showMode === 'ideal' ? "bg-zinc-100 text-zinc-950" : "text-zinc-500 hover:text-zinc-300"
              )}>Ideal</button>
              <button onClick={() => setShowMode('realistic')} className={cn(
                "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                showMode === 'realistic' ? "bg-amber-500 text-zinc-950" : "text-zinc-500 hover:text-zinc-300"
              )}>Realistic</button>
            </div>
            <span className="text-[10px] text-zinc-500">
              {showMode === 'ideal' ? 'No fees, compounding, optimistic intrabar, instant SL updates' : 'Fixed risk, fees + slippage, conservative intrabar, delayed SL updates'}
            </span>
          </div>

          {/* Validation warnings */}
          {output.warnings.length > 0 && (
            <div className="space-y-1.5">
              {output.warnings.map((w, i) => (
                <div key={i} className={cn(
                  "flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold",
                  w.severity === 'high' ? "bg-rose-500/10 border border-rose-500/20 text-rose-400" :
                  w.severity === 'medium' ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" :
                  "bg-blue-500/10 border border-blue-500/20 text-blue-400"
                )}>
                  <AlertCircle size={14} />
                  {w.message}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Stats Summary */}
            <div className="lg:col-span-1 grid grid-cols-2 gap-4 h-fit">
              <StatCard label="Total Trades" value={activeResult.totalTrades} icon={Activity} color="text-blue-400" />
              <StatCard label="Win Rate" value={`${activeResult.winRate.toFixed(1)}%`} icon={TrendingUp} color={winRateColor(activeResult.winRate)} />
              <StatCard label="Profit Factor" value={activeResult.profitFactor.toFixed(2)} icon={BarChart2} color={activeResult.profitFactor > 1.2 ? 'text-emerald-400' : 'text-amber-400'} />
              <StatCard label="Max Losing Streak" value={activeResult.maxConsecutiveLosses} icon={TrendingDown} color="text-rose-500" />
              <StatCard label="Net R" value={activeResult.netR.toFixed(1)} icon={BarChart2} color="text-violet-400" />
              <StatCard label="Avg PnL/Trade" value={`$${formatCurrency(activeResult.avgRPerTrade)}`} icon={Activity} color="text-zinc-400" />
              <StatCard label="Largest Win" value={`$${formatCurrency(activeResult.largestWin)}`} icon={ArrowUpRight} color="text-emerald-400" />
              <StatCard label="Largest Loss" value={`$${formatCurrency(activeResult.largestLoss)}`} icon={ArrowDownRight} color="text-rose-400" />
              <StatCard label="Max Drawdown" value={`${(activeResult.maxDrawdown * 100).toFixed(1)}%`} icon={TrendingDown} color="text-rose-500" />

              <div className="col-span-2 bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl backdrop-blur-sm">
                <div className="flex flex-col gap-1 mb-6 border-l-4 border-l-emerald-500 pl-4">
                  <span className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em]">Final Balance</span>
                  <span className="text-4xl font-black font-mono text-white tracking-tighter">
                    ${activeResult.finalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-widest">
                    <span className="text-zinc-500">Net Profit</span>
                    <span className={activeResult.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-500'}>
                      {activeResult.netProfit >= 0 ? '+' : ''}${formatCurrency(activeResult.netProfit)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-widest">
                    <span className="text-zinc-500">Wins / Losses</span>
                    <span>
                      <span className="text-emerald-400">{activeResult.trades.filter(t => t.result === 'win').length}</span>
                      <span className="text-zinc-600"> / </span>
                      <span className="text-rose-500">{activeResult.trades.filter(t => t.result === 'loss').length}</span>
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-widest">
                    <span className="text-zinc-500">Avg Duration</span>
                    <span className="text-zinc-300 font-mono">{Math.round(activeResult.avgDuration)}m</span>
                  </div>
                </div>
              </div>

              {/* Monte Carlo */}
              <div className="col-span-2 bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldCheck size={14} className="text-violet-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Monte Carlo (1,000 shuffles)</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-zinc-800/50 rounded-xl p-3">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Median Final</div>
                    <div className="text-sm font-black font-mono text-white">${output.monteCarlo.medianFinalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-xl p-3">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Risk of Ruin</div>
                    <div className="text-sm font-black font-mono text-rose-400">{(output.monteCarlo.riskOfRuin * 100).toFixed(1)}%</div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-xl p-3">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Worst 5%</div>
                    <div className="text-sm font-black font-mono text-rose-400">${output.monteCarlo.worst5FinalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  </div>
                  <div className="bg-zinc-800/50 rounded-xl p-3">
                    <div className="text-[9px] text-zinc-500 uppercase tracking-widest mb-1">Best 5%</div>
                    <div className="text-sm font-black font-mono text-emerald-400">${output.monteCarlo.best5FinalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                  </div>
                </div>
                <div className="mt-3 flex justify-between text-[9px] text-zinc-600">
                  <span>DD range: {(output.monteCarlo.maxDrawdownRange.min * 100).toFixed(1)}% – {(output.monteCarlo.maxDrawdownRange.max * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>

            {/* Equity Curve Chart */}
            <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-3xl p-8 flex flex-col min-h-[450px] shadow-2xl backdrop-blur-sm">
              <div className="flex items-center justify-between mb-8">
                <div className="flex flex-col gap-1">
                  <h3 className="text-white text-sm font-black uppercase tracking-widest">Growth Trajectory</h3>
                  <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest italic">
                    {showMode === 'ideal' ? 'Ideal — Compounding, no costs' : 'Realistic — Fixed risk, fees + slippage'}
                  </p>
                </div>
                <div className="p-3 bg-zinc-950/50 rounded-2xl border border-zinc-800/50">
                  <TrendingUp className={showMode === 'ideal' ? 'text-emerald-500' : 'text-amber-500'} size={20} />
                </div>
              </div>
              <div className="flex-1 w-full -ml-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityChartData}>
                    <defs>
                      <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={showMode === 'ideal' ? '#10b981' : '#f59e0b'} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={showMode === 'ideal' ? '#10b981' : '#f59e0b'} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="6 6" stroke="#27272a" vertical={false} opacity={0.3} />
                    <XAxis dataKey="step" hide />
                    <YAxis domain={['auto', 'auto']} stroke="#52525b" fontSize={10} fontWeight="bold" fontFamily="JetBrains Mono"
                      tickFormatter={(val) => `$${val}`} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '16px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}
                      itemStyle={{ color: '#10b981', fontWeight: 'bold', fontSize: '12px' }} labelStyle={{ display: 'none' }} />
                    <Area type="monotone" dataKey="balance" stroke={showMode === 'ideal' ? '#10b981' : '#f59e0b'} strokeWidth={3}
                      fillOpacity={1} fill="url(#equityGradient)" animationDuration={1500} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Trade Log */}
            <div className="lg:col-span-3 bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col backdrop-blur-sm">
              <div className="px-8 py-6 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h3 className="text-white font-black text-base uppercase tracking-[0.2em] flex items-center gap-3 italic">
                  <Search size={20} className="text-emerald-500" />
                  Trade Log
                </h3>
                <div className="flex items-center gap-4">
                  {lastUpdate && (
                    <span className="text-[10px] text-zinc-600 font-mono font-bold uppercase tracking-widest bg-zinc-950/50 px-3 py-1.5 rounded-xl border border-zinc-800/50">
                      {lastUpdate.toLocaleTimeString()}
                    </span>
                  )}
                  <span className="text-[11px] text-zinc-500 font-bold uppercase tracking-widest">{activeTrades.length} trades</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] bg-zinc-800/20 border-b border-zinc-800/50">
                      <th className="px-8 py-5">Symbol</th>
                      <th className="px-8 py-5">Date</th>
                      <th className="px-8 py-5">Type</th>
                      <th className="px-8 py-5">Entry / Exit</th>
                      <th className="px-8 py-5">PnL</th>
                      <th className="px-8 py-5 text-right">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {activeTrades.slice().reverse()
                      .slice((currentPage - 1) * tradesPerPage, currentPage * tradesPerPage)
                      .map((trade, idx) => (
                      <tr key={`${trade.entryTime}-${idx}`}
                        className="hover:bg-zinc-800/10 transition-all border-l-4 border-l-transparent hover:border-l-emerald-500 group">
                        <td className="px-8 py-6">
                          <span className="font-black text-base tracking-tighter text-white italic">{selectedSymbol}</span>
                        </td>
                        <td className="px-8 py-6">
                          <span className="text-[11px] font-mono text-zinc-300 font-bold">
                            {new Date(trade.entryTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td className="px-8 py-6">
                          <span className={cn("px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border",
                            trade.type === 'long' ? "bg-emerald-500/5 text-emerald-400 border-emerald-500/20" : "bg-rose-500/5 text-rose-400 border-rose-500/20"
                          )}>{trade.type}</span>
                        </td>
                        <td className="px-8 py-6 font-mono">
                          <div className="text-sm text-zinc-100 font-bold">${formatCurrency(trade.entryPrice)}</div>
                          <div className="text-[10px] text-zinc-600 font-bold">OUT: {trade.exitPrice ? `$${formatCurrency(trade.exitPrice)}` : '--'}</div>
                        </td>
                        <td className="px-8 py-6">
                          <span className={cn("font-mono font-black text-lg tracking-tighter", trade.pnl >= 0 ? "text-emerald-400" : "text-rose-500")}>
                            {trade.pnl >= 0 ? '+' : ''}${formatCurrency(trade.pnl)}
                          </span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <span className="text-[9px] text-zinc-500 font-black uppercase tracking-widest bg-zinc-950/50 px-3 py-1.5 rounded-xl border border-zinc-800/50 italic">{trade.reason || '--'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {activeTrades.length > tradesPerPage && (
                  <div className="bg-zinc-800/10 px-8 py-6 border-t border-zinc-800/50 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.2em]">Page {currentPage} / {Math.ceil(activeTrades.length / tradesPerPage)}</span>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                        className="px-6 py-2.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-20 text-zinc-100 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95">Previous</button>
                      <button onClick={() => setCurrentPage(p => Math.min(Math.ceil(activeTrades.length / tradesPerPage), p + 1))}
                        disabled={currentPage === Math.ceil(activeTrades.length / tradesPerPage)}
                        className="px-6 py-2.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 disabled:opacity-20 text-zinc-100 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95">Next</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 px-8 text-center border-2 border-dashed border-zinc-800/50 rounded-[3rem] bg-zinc-950/20 backdrop-blur-sm shadow-inner group transition-all hover:bg-zinc-950/30">
          <div className="w-24 h-24 bg-zinc-900 rounded-[2rem] border border-zinc-800 flex items-center justify-center mb-8 text-zinc-700 shadow-2xl group-hover:scale-110 transition-transform">
            <Activity size={40} className="animate-pulse" />
          </div>
          <h2 className="text-2xl font-black text-white mb-3 uppercase italic tracking-tight">Strategy Idle</h2>
          <p className="text-zinc-500 max-w-sm mx-auto text-sm font-medium leading-relaxed">
            Choose your target asset and execution parameters to initialize the <span className="text-emerald-500 font-bold italic">SMC High-Probability Simulator.</span>
          </p>
          <div className="mt-8 flex gap-4 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-700">
             <span>L2 Orderflow</span>
             <span className="w-1.5 h-1.5 rounded-full bg-zinc-800 self-center" />
             <span>FVG Detection</span>
             <span className="w-1.5 h-1.5 rounded-full bg-zinc-800 self-center" />
             <span>Market Bias</span>
          </div>
        </div>
      )}
    </div>

  );
}

function StatCard({ label, value, icon: Icon, color, className = '' }: any) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-3xl p-6 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center ${color}`}>
          <Icon size={18} />
        </div>
        <span className="text-zinc-500 text-xs font-bold uppercase tracking-wider">{label}</span>
      </div>
    <div className={`text-2xl font-bold font-mono ${color}`}>
        {value}
      </div>
    </div>
  );
}
