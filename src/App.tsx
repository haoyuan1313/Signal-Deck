import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { useRealtime } from './hooks/useRealtime';
import { useUser } from './hooks/useUser';
import { useStore } from './store/useStore';
import { LayoutDashboard, History, Zap, Settings, Menu, X, Clock, Power, Bot, FlaskConical } from 'lucide-react';
import { useState, useEffect, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import ErrorBoundary from './components/ErrorBoundary';
import AuthGate from './components/AuthGate';
import BalanceIndicator from './components/BalanceIndicator';

// Pages
import CommandCenter from './pages/CommandCenter';
import AgentIdentity from './pages/AgentIdentity';
import StrategyLab from './pages/StrategyLab';
import TradeHistory from './pages/TradeHistory';
import Config from './pages/Config';


function PageWrapper({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <ErrorBoundary>
        {children}
      </ErrorBoundary>
    </motion.div>
  );
}

function NavItem({ to, icon: Icon, label, badge, onClick }: { to: string; icon: any; label: string; badge?: string; onClick?: () => void }) {
  const location = useLocation();
  const active = location.pathname === to;

  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
        active
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
      )}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
      {badge && (
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-400 font-bold uppercase tracking-tight border border-violet-500/30">
          {badge}
        </span>
      )}
    </Link>
  );
}

function ClockDisplay({ extended = false }: { extended?: boolean }) {
  const [utcTime, setUtcTime] = useState(new Date().toUTCString());

  useEffect(() => {
    const timer = setInterval(() => setUtcTime(new Date().toUTCString()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (extended) {
    return (
      <div className="hidden md:flex items-center gap-3 px-4 py-1.5 bg-zinc-800/50 rounded-full border border-zinc-700/30">
        <Clock size={12} className="text-zinc-500" />
        <span className="text-[11px] font-mono text-zinc-400 tracking-tight">{utcTime}</span>
      </div>
    );
  }

  return (
    <div className="text-[10px] text-zinc-600 font-mono">
      {utcTime.split(' ').slice(4, 5)} UTC
    </div>
  );
}

function AppInner() {
  const location = useLocation();
  const { userId, loading: userLoading } = useUser();
  useRealtime(userLoading ? undefined : userId);
  const { botLive, settings, setPaused, authUsername, logoutFn } = useStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30 overflow-x-hidden">
      {/* Sidebar Navigation */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 bg-zinc-900 border-r border-zinc-800 transition-all duration-300 ease-in-out lg:translate-x-0",
        isMobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          {/* Sidebar Header */}
          <div className="p-6 pb-0">
            <div className="flex items-center gap-3 mb-8 px-2 justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <Bot className="text-zinc-950" size={24} strokeWidth={3} />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight leading-none">SignalDeck</h1>
                  <span className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">v3.0.0-beta</span>
                </div>
              </div>
              {authUsername && logoutFn && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={logoutFn}
                    className="p-2 text-zinc-500 hover:text-rose-400 hover:bg-rose-400/10 rounded-lg transition-all"
                    title="Log out"
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar">
            <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest px-4 mb-2 mt-4 opacity-50">Core</div>
            <NavItem to="/" icon={LayoutDashboard} label="Command Center" onClick={() => setIsMobileMenuOpen(false)} />
            <NavItem to="/agent" icon={Bot} label="Agent Identity" badge="NEW · Hackathon" onClick={() => setIsMobileMenuOpen(false)} />

            <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest px-4 mb-2 mt-6 opacity-50">Operations</div>
            <NavItem to="/lab" icon={FlaskConical} label="Strategy Lab" onClick={() => setIsMobileMenuOpen(false)} />
            <NavItem to="/trades" icon={History} label="Trade History" onClick={() => setIsMobileMenuOpen(false)} />

            <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest px-4 mb-2 mt-6 opacity-50">System</div>
            <NavItem to="/settings" icon={Settings} label="Config" onClick={() => setIsMobileMenuOpen(false)} />
          </nav>

          {/* Sidebar Footer */}
          <div className="p-6 bg-zinc-900/50 border-t border-zinc-800">
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", botLive ? "bg-emerald-500 animate-pulse" : "bg-zinc-600")} />
                  <span className="text-[11px] font-bold text-zinc-400 tracking-wide">{botLive ? 'BOT LIVE' : 'BOT OFFLINE'}</span>
                </div>
                <ClockDisplay />
              </div>
              <button
                onClick={() => setPaused(!settings?.paused)}
                className={cn(
                  "p-2.5 rounded-xl transition-all shadow-lg active:scale-95",
                  settings?.paused
                    ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                    : "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                )}
              >
                <Power size={18} />
              </button>
            </div>

            <BalanceIndicator size="sm" />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="lg:ml-72 min-h-screen flex flex-col">
        {/* Responsive Header / Top Bar */}
        <header className="flex items-center justify-between h-16 md:h-20 px-4 md:px-8 bg-zinc-900/80 border-b border-zinc-800/50 backdrop-blur-xl sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <div className="lg:hidden flex items-center gap-3">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                <Bot className="text-zinc-950" size={18} strokeWidth={3} />
              </div>
              <h1 className="text-lg font-bold tracking-tight">SignalDeck</h1>
            </div>
            <ClockDisplay extended />
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden sm:block">
              <BalanceIndicator hideLabel />
            </div>
            <button
              className="lg:hidden p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-all border border-zinc-700/50"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <div className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="h-full"
            >
              <Routes location={location}>
                <Route path="/" element={<PageWrapper><CommandCenter /></PageWrapper>} />
                <Route path="/agent" element={<PageWrapper><AgentIdentity /></PageWrapper>} />
                <Route path="/lab" element={<PageWrapper><StrategyLab /></PageWrapper>} />
                <Route path="/trades" element={<PageWrapper><TradeHistory /></PageWrapper>} />
                <Route path="/settings" element={<PageWrapper><Config /></PageWrapper>} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>


      {/* Mobile Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <AppInner />
      </AuthGate>
    </BrowserRouter>
  );
}
