import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { FlaskConical, BarChart2, Brain, PieChart, ChevronDown } from 'lucide-react';
import BacktestPage from './BacktestPage';
import AIAnalystPage from './AIAnalyst';
import SignalDiagnostics from './SignalDiagnostics';

const PROTOCOLS = [
  { value: 'bybit', label: 'Bybit (Off-Chain)' },
  { value: 'merchant_moe', label: 'Merchant Moe' },
  { value: 'agni_finance', label: 'Agni Finance' },
  { value: 'fluxion', label: 'Fluxion' },
];

type Tab = 'backtest' | 'axiom' | 'diagnostics';

export default function StrategyLab() {
  const [activeTab, setActiveTab] = useState<Tab>('backtest');
  const [protocol, setProtocol] = useState('bybit');
  const [protocolOpen, setProtocolOpen] = useState(false);

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'backtest', label: 'Backtester', icon: BarChart2 },
    { id: 'axiom', label: 'AXIOM AI Analyst', icon: Brain },
    { id: 'diagnostics', label: 'Signal Diagnostics', icon: PieChart },
  ];

  return (
    <div className="space-y-6 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical className="text-emerald-400" size={28} />
            <h2 className="text-3xl font-bold tracking-tight">Strategy Lab</h2>
          </div>
          <p className="text-zinc-500 text-sm">Backtest, analyze, and optimize your SMC strategy.</p>
        </div>

        {/* Protocol Selector */}
        <div className="relative">
          <button
            onClick={() => setProtocolOpen(!protocolOpen)}
            className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-bold text-zinc-300 hover:border-zinc-700 transition-all"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {PROTOCOLS.find(p => p.value === protocol)?.label || 'Select Protocol'}
            <ChevronDown size={14} className={cn("transition-transform", protocolOpen && "rotate-180")} />
          </button>
          <AnimatePresence>
            {protocolOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute right-0 mt-2 w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50"
              >
                {PROTOCOLS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => { setProtocol(p.value); setProtocolOpen(false); }}
                    className={cn(
                      "w-full text-left px-4 py-3 text-sm font-medium hover:bg-zinc-800 transition-all flex items-center gap-2",
                      protocol === p.value ? "text-emerald-400 bg-emerald-500/5" : "text-zinc-400"
                    )}
                  >
                    <span className={cn(
                      "w-2 h-2 rounded-full",
                      p.value === 'bybit' ? 'bg-emerald-500' : 'bg-violet-500'
                    )} />
                    {p.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-xl border border-zinc-800/50 backdrop-blur-sm">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all flex-1 justify-center',
              activeTab === id
                ? 'bg-zinc-800 text-zinc-100 shadow-xl border border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'backtest' && <BacktestPage />}
          {activeTab === 'axiom' && <AIAnalystPage />}
          {activeTab === 'diagnostics' && <SignalDiagnostics />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
