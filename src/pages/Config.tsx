import { useStore } from '../store/useStore';
import React, { useState, useEffect } from 'react';
import { Save, AlertCircle, CheckCircle2, Database, Loader2, XCircle, Send, Globe, Eye, EyeOff, ShieldCheck, Wallet, Bot, Trash2, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
import { testSupabaseConnection, supabase } from '../lib/supabase';
import PasswordGuard from '../components/PasswordGuard';
import { MANTLE_CHAIN_ID, MANTLE_EXPLORER, ERC8004_IDENTITY_REGISTRY } from '../lib/constants';

type ConfigTab = 'bot' | 'mantle' | 'database';

export default function Config() {
  const { settings, setPaused, updateSettings } = useStore();
  const [activeTab, setActiveTab] = useState<ConfigTab>('bot');
  const [isTogglingMaster, setIsTogglingMaster] = useState(false);
  const [isTogglingPaper, setIsTogglingPaper] = useState(false);

  // Bot Config form
  const [formData, setFormData] = useState({
    symbols: '',
    timeframe: '5m',
    htf_timeframe: '1h',
    htf2_timeframe: '4h',
    rr: 2.0,
    bars: 500,
    paper_trading: true,
    risk_percent: 1.0,
    allowed_directions: ['long', 'short'] as string[],
    atr_period: 14,
    allowed_sessions: ['london', 'ny_am', 'ny_pm'] as string[],
    require_4h_align: true,
    edge_filter: { enableEdgeFilter: false, allowedSymbols: [], blockedSymbols: [], allowedSessions: [], allowedDirections: [], minAIConfidence: null, maxAIConfidence: null, requireAIConfidence: false } as any,
    displacement_filter: { enableDisplacementFilter: false, minDisplacementBodyATR: 1.2, minImpulseRangeATR: 1.5, requireDirectionalClose: true, requireHTFAlignment: false, allowedDisplacementSessions: [] } as any,
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');

  // Mantle form
  const [mantlePrivateKey, setMantlePrivateKey] = useState('');
  const [mantleStatus, setMantleStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [mantleError, setMantleError] = useState<string | null>(null);
  const [mantleWallet, setMantleWallet] = useState<{ address: string; network: string; chainId: number; isTestnet: boolean } | null>(null);
  const [nftStatus, setNftStatus] = useState<{ minted: boolean; tokenId?: string; txHash?: string } | null>(null);
  const [retryPending, setRetryPending] = useState(0);
  const [mintLoading, setMintLoading] = useState(false);

  // Database
  const [trades, setTrades] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Telegram
  const [tgConfig, setTgConfig] = useState<{ configured: boolean; chat_id: string; updated_at: string | null }>({
    configured: false, chat_id: '', updated_at: null,
  });
  const [tgForm, setTgForm] = useState<{ botToken: string; chatId: string }>({ botToken: '', chatId: '' });
  const [tgShowToken, setTgShowToken] = useState(false);
  const [tgSaving, setTgSaving] = useState(false);
  const [tgSaveError, setTgSaveError] = useState<string | null>(null);
  const [tgSaved, setTgSaved] = useState(false);
  const [tgStatus, setTgStatus] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null });
  const [dbStatus, setDbStatus] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null });
  const [bbStatus, setBbStatus] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null });

  useEffect(() => {
    if (settings) {
      setFormData({
        symbols: settings.symbols.join(', '),
        timeframe: settings.timeframe,
        htf_timeframe: settings.htf_timeframe,
        htf2_timeframe: settings.htf2_timeframe || '4h',
        rr: settings.rr,
        bars: settings.bars || 500,
        risk_percent: settings.risk_percent || 1.0,
        paper_trading: settings.paper_trading ?? true,
        allowed_directions: settings.allowed_directions,
        atr_period: settings.atr_period || 14,
        allowed_sessions: settings.allowed_sessions || ['london', 'ny_am', 'ny_pm'],
        require_4h_align: settings.require_4h_align ?? true,
        edge_filter: (settings as any).edge_filter || { enableEdgeFilter: false, allowedSymbols: [], blockedSymbols: [], allowedSessions: [], allowedDirections: [], minAIConfidence: null, maxAIConfidence: null, requireAIConfidence: false },
        displacement_filter: (settings as any).displacement_filter || { enableDisplacementFilter: false, minDisplacementBodyATR: 1.2, minImpulseRangeATR: 1.5, requireDirectionalClose: true, requireHTFAlignment: false, allowedDisplacementSessions: [] },
      });
    }
  }, [settings]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/telegram-config');
        if (!res.ok) return;
        const data = await res.json();
        setTgConfig({ configured: !!data.configured, chat_id: data.chat_id || '', updated_at: data.updated_at || null });
        setTgForm(prev => ({ ...prev, chatId: data.chat_id || '' }));
      } catch {}
    })();
  }, []);

  const toggleMaster = async () => {
    if (!settings) return;
    setIsTogglingMaster(true);
    try { await setPaused(!settings.paused); }
    catch (err: any) { alert(err.message); }
    finally { setIsTogglingMaster(false); }
  };

  const togglePaperTrading = async () => {
    if (!settings) return;
    setIsTogglingPaper(true);
    try {
      const newVal = !formData.paper_trading;
      await updateSettings({ ...settings, paper_trading: newVal });
      setFormData(prev => ({ ...prev, paper_trading: newVal }));
    } catch (err: any) { alert(`Failed to toggle mode: ${err.message}`); }
    finally { setIsTogglingPaper(false); }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('saving');
    try {
      const symbolsArray = formData.symbols.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
      if (symbolsArray.length === 0) throw new Error('At least one trading pair is required.');
      await useStore.getState().updateSettings({ ...settings!, ...formData, symbols: symbolsArray });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: any) {
      setSaveStatus('idle');
      alert(`Failed to save: ${err.message || 'Unknown error'}`);
    }
  };

  const handleSaveTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    setTgSaveError(null);
    if (!tgForm.botToken.trim() || !tgForm.chatId.trim()) { setTgSaveError('Both bot token and chat ID are required.'); return; }
    setTgSaving(true);
    try {
      const res = await fetch('/api/telegram-config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: tgForm.botToken.trim(), chatId: tgForm.chatId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setTgConfig({ configured: true, chat_id: tgForm.chatId.trim(), updated_at: new Date().toISOString() });
      setTgForm({ botToken: '', chatId: tgForm.chatId.trim() });
      setTgSaved(true);
      setTimeout(() => setTgSaved(false), 3000);
    } catch (err: any) { setTgSaveError(err.message); }
    finally { setTgSaving(false); }
  };

  const handleTestTelegram = async () => {
    setTgStatus({ loading: true, result: null });
    try {
      const res = await fetch('/api/test-telegram', { method: 'POST' });
      const data = await res.json();
      setTgStatus({ loading: false, result: data });
    } catch (err: any) { setTgStatus({ loading: false, result: { success: false, error: err.message } }); }
  };

  const handleTestBybit = async () => {
    setBbStatus({ loading: true, result: null });
    try {
      const symbolParam = encodeURIComponent('BTC/USDT');
      const res = await fetch(`/api/prices?symbols=${symbolParam}`);
      const data = await res.json();
      if (!data.error) {
        setBbStatus({ loading: false, result: { success: true, price: data['BTC/USDT'] } });
      } else {
        setBbStatus({ loading: false, result: { success: false, error: data.error } });
      }
    } catch (err: any) { setBbStatus({ loading: false, result: { success: false, error: err.message } }); }
  };

  const fetchMantleStatus = async () => {
    try {
      const res = await fetch('/api/mantle/status');
      if (!res.ok) return;
      const d = await res.json();
      if (d.wallet?.connected) { setMantleStatus('connected'); setMantleWallet(d.wallet); }
      else { setMantleStatus('disconnected'); setMantleWallet(null); }
      setNftStatus(d.nft || null);
      setRetryPending(d.retryQueue?.pending || 0);
    } catch {}
  };

  useEffect(() => { fetchMantleStatus(); }, []);

  const handleConnectMantle = async () => {
    if (!mantlePrivateKey.trim() || mantlePrivateKey.trim().length < 64) {
      setMantleError('Private key must be 64+ hex characters.'); return;
    }
    setMantleStatus('connecting'); setMantleError(null);
    try {
      const res = await fetch('/api/mantle/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privateKey: mantlePrivateKey.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Connect failed');
      setMantlePrivateKey('');
      fetchMantleStatus();
    } catch (err: any) {
      setMantleStatus('disconnected'); setMantleError(err.message);
    }
  };

  const handleMintNFT = async () => {
    setMintLoading(true); setMantleError(null);
    try {
      const res = await fetch('/api/mantle/mint-nft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SignalDeck Agent', strategy: 'SMC FVG + HTF Trend', metadataURI: 'https://signaldeck-beta.vercel.app/api/agent/metadata' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Mint failed');
      fetchMantleStatus();
    } catch (err: any) { setMantleError(err.message); }
    finally { setMintLoading(false); }
  };

  const fetchTrades = async () => {
    if (!supabase) return;
    setDbLoading(true);
    try {
      const { data, error } = await supabase.from('trades').select('*').order('opened_at', { ascending: false }).limit(200);
      if (error) throw error;
      if (data) setTrades(data);
    } catch (err: any) { console.error("Fetch trades error:", err); }
    finally { setDbLoading(false); }
  };

  useEffect(() => {
    if (activeTab === 'database') fetchTrades();
  }, [activeTab]);

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected trades?`)) return;
    try {
      const res = await fetch('/api/admin/bulk-delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], table: 'trades' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSelectedIds(new Set());
      fetchTrades();
    } catch (err: any) { alert(`Delete failed: ${err.message}`); }
  };

  const tabs: { id: ConfigTab; label: string; icon: any }[] = [
    { id: 'bot', label: 'Bot Config', icon: Settings },
    { id: 'mantle', label: 'Mantle Connection', icon: Bot },
    { id: 'database', label: 'Database', icon: Database },
  ];

  return (
    <PasswordGuard>
      <div className="max-w-3xl space-y-8 pb-12">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Config</h2>
          <p className="text-zinc-500 text-sm">Bot settings, Mantle integration, and database management.</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-xl border border-zinc-800/50">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all flex-1 justify-center',
                activeTab === id ? 'bg-zinc-800 text-zinc-100 shadow-xl' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            {/* ── Bot Config Tab ── */}
            {activeTab === 'bot' && (
              !settings ? (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 min-h-[300px]">
                  <Loader2 className="animate-spin text-emerald-500" size={32} />
                  <p className="font-bold text-zinc-300">Loading Configuration...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Master + Paper switches */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className={cn(
                      "p-6 rounded-2xl flex items-center justify-between border-2 transition-colors",
                      settings.paused ? "bg-rose-500/10 border-rose-500/20 text-rose-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    )}>
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-lg tracking-tight">{settings.paused ? 'Master Switch: OFF' : 'Master Switch: ON'}</span>
                        <p className="text-xs opacity-80">Overall engine state.</p>
                      </div>
                      <button onClick={toggleMaster} disabled={isTogglingMaster}
                        className={cn("px-4 py-2 rounded-xl font-bold transition-all shadow-lg text-sm", settings.paused ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400" : "bg-rose-500 text-white hover:bg-rose-600")}>
                        {settings.paused ? 'Enable Bot' : 'Disable Bot'}
                      </button>
                    </div>
                    <div className={cn(
                      "p-6 rounded-2xl flex items-center justify-between border-2 transition-colors",
                      formData.paper_trading ? "bg-amber-500/10 border-amber-500/20 text-amber-400" : "bg-purple-500/10 border-purple-500/20 text-purple-400"
                    )}>
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-lg tracking-tight">{formData.paper_trading ? 'Paper Mode' : 'LIVE Mode'}</span>
                        <p className="text-xs opacity-80">{formData.paper_trading ? 'Simulated trading only.' : 'REAL funds on Bybit.'}</p>
                      </div>
                      <button onClick={togglePaperTrading} disabled={isTogglingPaper}
                        className={cn("px-4 py-2 rounded-xl font-bold transition-all shadow-lg text-sm", formData.paper_trading ? "bg-purple-500 text-white hover:bg-purple-600" : "bg-amber-500 text-zinc-950 hover:bg-amber-400")}>
                        {formData.paper_trading ? 'Switch to LIVE' : 'Switch to Paper'}
                      </button>
                    </div>
                  </div>

                  {/* Settings form */}
                  <form onSubmit={handleSave} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800">
                    <div className="p-8 space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Trading Pairs (comma separated)</label>
                        <input type="text" value={formData.symbols} onChange={(e) => setFormData({...formData, symbols: e.target.value})}
                          className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-mono text-sm"
                          placeholder="BTC/USDT, ETH/USDT, SOL/USDT" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Execution TF</label>
                          <select value={formData.timeframe} onChange={(e) => setFormData({...formData, timeframe: e.target.value})}
                            className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm">
                            <option value="1m">1m</option><option value="5m">5m</option><option value="15m">15m</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">HTF Trend TF</label>
                          <select value={formData.htf_timeframe} onChange={(e) => setFormData({...formData, htf_timeframe: e.target.value})}
                            className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm">
                            <option value="15m">15m</option><option value="1h">1h</option><option value="4h">4h</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">HTF2 Regime TF</label>
                          <select value={formData.htf2_timeframe} onChange={(e) => setFormData({...formData, htf2_timeframe: e.target.value})}
                            className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm">
                            <option value="1h">1h</option><option value="4h">4h</option><option value="1d">1d</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Lookback Bars</label>
                          <input type="number" value={formData.bars} onChange={(e) => setFormData({...formData, bars: parseInt(e.target.value) || 100})}
                            className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm" min="100" max="5000" />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Default Risk/Reward Ratio</label>
                          <span className="text-emerald-400 font-mono font-bold">{formData.rr.toFixed(1)}R</span>
                        </div>
                        <input type="range" min="1.0" max="5.0" step="0.1" value={formData.rr}
                          onChange={(e) => setFormData({...formData, rr: parseFloat(e.target.value)})}
                          className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                      </div>

                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Risk per Trade (%)</label>
                          <span className="text-amber-400 font-mono font-bold">{formData.risk_percent.toFixed(1)}%</span>
                        </div>
                        <input type="range" min="0.1" max="10.0" step="0.1" value={formData.risk_percent}
                          onChange={(e) => setFormData({...formData, risk_percent: parseFloat(e.target.value)})}
                          className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500" />
                      </div>

                      <div className="space-y-4">
                        <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Market Sessions</label>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { id: 'asian', label: 'Asian', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
                            { id: 'london', label: 'London', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
                            { id: 'ny_am', label: 'NY Early', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
                            { id: 'ny_pm', label: 'NY Late', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
                            { id: 'late', label: 'Late', color: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
                          ] as const).map(({ id, label, color }) => (
                            <label key={id} className={cn(
                              "flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all text-xs font-bold",
                              formData.allowed_sessions.includes(id) ? color : "bg-zinc-800 border-transparent text-zinc-600"
                            )}>
                              <input type="checkbox" className="hidden" checked={formData.allowed_sessions.includes(id)}
                                onChange={(e) => {
                                  const newSessions = e.target.checked
                                    ? [...formData.allowed_sessions, id]
                                    : formData.allowed_sessions.filter(s => s !== id);
                                  setFormData({...formData, allowed_sessions: newSessions});
                                }} />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Allowed Directions</label>
                        <div className="flex gap-4">
                          {['long', 'short'].map(dir => (
                            <label key={dir} className={cn(
                              "flex-1 flex items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all uppercase font-bold text-sm tracking-widest",
                              formData.allowed_directions.includes(dir)
                                ? (dir === 'long' ? "bg-emerald-500/10 border-emerald-500 text-emerald-400" : "bg-rose-500/10 border-rose-500 text-rose-400")
                                : "bg-zinc-800 border-transparent text-zinc-500"
                            )}>
                              <input type="checkbox" className="hidden" checked={formData.allowed_directions.includes(dir)}
                                onChange={(e) => {
                                  const newDirs = e.target.checked ? [...formData.allowed_directions, dir] : formData.allowed_directions.filter(d => d !== dir);
                                  setFormData({...formData, allowed_directions: newDirs});
                                }} />
                              {dir}
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* ── Edge Filter v1 ────────────────────────────────── */}
                      <div className="space-y-4 pt-2 border-t border-zinc-800/50">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Edge Filter v1</label>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer"
                              checked={formData.edge_filter?.enableEdgeFilter || false}
                              onChange={(e) => setFormData({...formData, edge_filter: {...(formData.edge_filter || {}), enableEdgeFilter: e.target.checked}})} />
                            <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-violet-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                          </label>
                        </div>
                        <p className="text-[10px] text-zinc-500 italic">
                          Reduce bad trades by filtering symbols, sessions, directions, and AI confidence. Default: OFF.
                        </p>

                        {formData.edge_filter?.enableEdgeFilter && (
                          <div className="space-y-3 bg-zinc-800/30 rounded-xl p-4">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Allowed Symbols</label>
                                <button onClick={() => {
                                  const ef = formData.edge_filter || {};
                                  const cur = ef.allowedSymbols || [];
                                  const preset = ['XRP/USDT', 'ONDO/USDT', 'SOL/USDT'];
                                  setFormData({...formData, edge_filter: {...ef, allowedSymbols: cur.length > 0 ? [] : preset, enableEdgeFilter: true}});
                                }}
                                className="w-full mt-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white transition-colors text-left">
                                  {(formData.edge_filter?.allowedSymbols?.length || 0) > 0
                                    ? formData.edge_filter?.allowedSymbols?.join(', ')
                                    : 'Click for conservative preset'}
                                </button>
                              </div>
                              <div>
                                <label className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Blocked Symbols</label>
                                <button onClick={() => {
                                  const ef = formData.edge_filter || {};
                                  const cur = ef.blockedSymbols || [];
                                  const preset = ['DOGE/USDT', 'ETH/USDT'];
                                  setFormData({...formData, edge_filter: {...ef, blockedSymbols: cur.length > 0 ? [] : preset, enableEdgeFilter: true}});
                                }}
                                className="w-full mt-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white transition-colors text-left">
                                  {(formData.edge_filter?.blockedSymbols?.length || 0) > 0
                                    ? formData.edge_filter?.blockedSymbols?.join(', ')
                                    : 'Click for conservative preset'}
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Allowed Sessions</label>
                                <button onClick={() => {
                                  const ef = formData.edge_filter || {};
                                  const cur = ef.allowedSessions || [];
                                  const preset = ['London'];
                                  setFormData({...formData, edge_filter: {...ef, allowedSessions: cur.length > 0 ? [] : preset, enableEdgeFilter: true}});
                                }}
                                className="w-full mt-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white transition-colors text-left">
                                  {(formData.edge_filter?.allowedSessions?.length || 0) > 0
                                    ? formData.edge_filter?.allowedSessions?.join(', ')
                                    : 'Click for conservative preset'}
                                </button>
                              </div>
                              <div>
                                <label className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Allowed Directions</label>
                                <button onClick={() => {
                                  const ef = formData.edge_filter || {};
                                  const cur = ef.allowedDirections || [];
                                  const preset = ['long'];
                                  setFormData({...formData, edge_filter: {...ef, allowedDirections: cur.length > 0 ? [] : preset, enableEdgeFilter: true}});
                                }}
                                className="w-full mt-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white transition-colors text-left">
                                  {(formData.edge_filter?.allowedDirections?.length || 0) > 0
                                    ? formData.edge_filter?.allowedDirections?.join(', ')
                                    : 'Click for conservative preset'}
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Min AI Confidence</label>
                                <input type="number" placeholder="e.g. 6000"
                                  value={formData.edge_filter?.minAIConfidence || ''}
                                  onChange={(e) => setFormData({...formData, edge_filter: {...(formData.edge_filter || {}), minAIConfidence: e.target.value ? parseInt(e.target.value) : null}})}
                                  className="w-full mt-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-[10px] font-bold text-white outline-none" />
                              </div>
                              <div>
                                <label className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Max AI Confidence</label>
                                <input type="number" placeholder="e.g. 8000"
                                  value={formData.edge_filter?.maxAIConfidence || ''}
                                  onChange={(e) => setFormData({...formData, edge_filter: {...(formData.edge_filter || {}), maxAIConfidence: e.target.value ? parseInt(e.target.value) : null}})}
                                  className="w-full mt-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-[10px] font-bold text-white outline-none" />
                              </div>
                            </div>

                            <div>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={formData.edge_filter?.requireAIConfidence || false}
                                  onChange={(e) => setFormData({...formData, edge_filter: {...(formData.edge_filter || {}), requireAIConfidence: e.target.checked}})} />
                                <span className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Require AI Confidence</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── Displacement Impulse Filter ──────────────────── */}
                      <div className="space-y-4 pt-2 border-t border-zinc-800/50">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Displacement Impulse Filter</label>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer"
                              checked={formData.displacement_filter?.enableDisplacementFilter || false}
                              onChange={(e) => setFormData({...formData, displacement_filter: {...(formData.displacement_filter || {}), enableDisplacementFilter: e.target.checked}})} />
                            <div className="w-9 h-5 bg-zinc-800 rounded-full peer peer-checked:bg-amber-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                          </label>
                        </div>
                        <p className="text-[10px] text-zinc-500 italic">
                          Only allow trades when displacement impulse is detected (large body, range expansion, directional close). Default: OFF.
                        </p>

                        {formData.displacement_filter?.enableDisplacementFilter && (
                          <div className="space-y-3 bg-zinc-800/30 rounded-xl p-4">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Min Body ATR</label>
                                <input type="number" step="0.1" placeholder="1.2"
                                  value={formData.displacement_filter?.minDisplacementBodyATR ?? ''}
                                  onChange={(e) => setFormData({...formData, displacement_filter: {...(formData.displacement_filter || {}), minDisplacementBodyATR: parseFloat(e.target.value) || 1.2}})}
                                  className="w-full mt-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-[10px] font-bold text-white outline-none" />
                              </div>
                              <div>
                                <label className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Min Range ATR</label>
                                <input type="number" step="0.1" placeholder="1.5"
                                  value={formData.displacement_filter?.minImpulseRangeATR ?? ''}
                                  onChange={(e) => setFormData({...formData, displacement_filter: {...(formData.displacement_filter || {}), minImpulseRangeATR: parseFloat(e.target.value) || 1.5}})}
                                  className="w-full mt-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-[10px] font-bold text-white outline-none" />
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={formData.displacement_filter?.requireDirectionalClose ?? true}
                                  onChange={(e) => setFormData({...formData, displacement_filter: {...(formData.displacement_filter || {}), requireDirectionalClose: e.target.checked}})} />
                                <span className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Require Directional Close</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={formData.displacement_filter?.requireHTFAlignment || false}
                                  onChange={(e) => setFormData({...formData, displacement_filter: {...(formData.displacement_filter || {}), requireHTFAlignment: e.target.checked}})} />
                                <span className="text-[9px] font-bold uppercase text-zinc-500 tracking-wider">Require HTF Align</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="p-6 bg-zinc-800/30 flex items-center justify-end px-8">
                      <AnimatePresence mode="wait">
                        {saveStatus === 'success' ? (
                          <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                            className="flex items-center gap-2 text-emerald-400 font-bold">
                            <CheckCircle2 size={18} />Settings Saved
                          </motion.div>
                        ) : (
                          <button type="submit" disabled={saveStatus === 'saving'}
                            className="flex items-center gap-2 px-8 py-3 bg-zinc-100 hover:bg-white text-zinc-950 rounded-xl font-bold transition-all transform active:scale-95 disabled:opacity-50">
                            <Save size={18} />Update Bot
                          </button>
                        )}
                      </AnimatePresence>
                    </div>
                  </form>

                  {/* Diagnostics */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
                      <div className="flex items-center gap-2"><Database className="text-zinc-500" size={16} /><h3 className="font-bold text-sm">Supabase</h3></div>
                      <button onClick={async () => { setDbStatus({ loading: true, result: null }); const res = await testSupabaseConnection(); setDbStatus({ loading: false, result: res }); }}
                        disabled={dbStatus.loading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50">
                        {dbStatus.loading ? <Loader2 className="animate-spin" size={14} /> : <Database size={14} />}Test
                      </button>
                      {dbStatus.result && (
                        <div className={cn("text-xs p-2 rounded-lg", dbStatus.result.success ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10")}>
                          {dbStatus.result.success ? 'Connected' : dbStatus.result.error}
                        </div>
                      )}
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
                      <div className="flex items-center gap-2"><Globe className="text-zinc-500" size={16} /><h3 className="font-bold text-sm">Bybit</h3></div>
                      <button onClick={handleTestBybit} disabled={bbStatus.loading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50">
                        {bbStatus.loading ? <Loader2 className="animate-spin" size={14} /> : <Globe size={14} />}Test
                      </button>
                      {bbStatus.result && (
                        <div className={cn("text-xs p-2 rounded-lg", bbStatus.result.success ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10")}>
                          {bbStatus.result.success ? `BTC: ${formatCurrency(bbStatus.result.price)}` : bbStatus.result.error}
                        </div>
                      )}
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
                      <div className="flex items-center gap-2"><Send className="text-zinc-500" size={16} /><h3 className="font-bold text-sm">Telegram</h3></div>
                      <button onClick={handleTestTelegram} disabled={tgStatus.loading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50">
                        {tgStatus.loading ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}Test
                      </button>
                      {tgStatus.result && (
                        <div className={cn("text-xs p-2 rounded-lg", tgStatus.result.success ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10")}>
                          {tgStatus.result.success ? 'Sent' : tgStatus.result.error}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Telegram config */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2"><Send className="text-zinc-500" size={16} /><h3 className="font-bold text-sm">Telegram Notifications</h3>
                      {tgConfig.configured && <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Configured</span>}
                    </div>
                    <form onSubmit={handleSaveTelegram} className="space-y-3">
                      <div className="relative">
                        <input type={tgShowToken ? 'text' : 'password'} value={tgForm.botToken}
                          onChange={e => setTgForm({ ...tgForm, botToken: e.target.value })}
                          placeholder={tgConfig.configured ? '••••••••••••••••' : 'Bot token from @BotFather'}
                          autoComplete="off"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 pr-12 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all" />
                        <button type="button" onClick={() => setTgShowToken(!tgShowToken)} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                          {tgShowToken ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <input type="text" value={tgForm.chatId} onChange={e => setTgForm({ ...tgForm, chatId: e.target.value })}
                        placeholder="Chat ID" autoComplete="off"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all" />
                      {tgSaveError && <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400"><XCircle size={14} />{tgSaveError}</div>}
                      <button type="submit" disabled={tgSaving}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-bold rounded-xl transition-all active:scale-95">
                        {tgSaving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : tgSaved ? <><CheckCircle2 size={16} /> Saved</> : <><ShieldCheck size={16} /> Save encrypted config</>}
                      </button>
                    </form>
                  </div>
                </div>
              )
            )}

            {/* ── Mantle Connection Tab ── */}
            {activeTab === 'mantle' && (
              <div className="space-y-6">
                <div className="bg-gradient-to-br from-violet-950/30 to-zinc-900 border border-violet-500/20 rounded-2xl p-8 space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-violet-500/20 rounded-lg"><Bot className="text-violet-400" size={24} /></div>
                    <div>
                      <h3 className="font-bold text-lg">Mantle Network Connection</h3>
                      <p className="text-zinc-500 text-sm">Chain ID: {MANTLE_CHAIN_ID} · Explorer: {MANTLE_EXPLORER}</p>
                    </div>
                  </div>

                  {mantleWallet ? (
                    <div className="bg-zinc-800/50 rounded-xl p-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Address</span>
                        <span className="font-mono text-white text-xs truncate max-w-[260px]">{mantleWallet.address}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Network</span>
                        <span className="text-white">{mantleWallet.network}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Chain ID</span>
                        <span className="text-white font-mono">{mantleWallet.chainId}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Mantle Private Key</label>
                      <input type="password" value={mantlePrivateKey} onChange={e => setMantlePrivateKey(e.target.value)}
                        placeholder="0x..." className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/50 transition-all" />
                      <p className="text-[10px] text-zinc-600">Private key never leaves your server. Stored in process memory only.</p>
                    </div>
                  )}

                  <div className="flex items-center gap-4 flex-wrap">
                    <div className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold",
                      mantleStatus === 'connected' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                      mantleStatus === 'connecting' ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                      "bg-zinc-800 text-zinc-500"
                    )}>
                      <div className={cn("w-2 h-2 rounded-full", mantleStatus === 'connected' ? "bg-emerald-500" : mantleStatus === 'connecting' ? "bg-amber-500 animate-pulse" : "bg-zinc-600")} />
                      {mantleStatus === 'connected' ? 'Connected' : mantleStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
                    </div>
                    {!mantleWallet ? (
                      <button onClick={handleConnectMantle} disabled={mantleStatus === 'connecting'}
                        className="flex items-center gap-2 px-6 py-2.5 bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl font-bold text-sm transition-all">
                        <Wallet size={16} />Connect
                      </button>
                    ) : (
                      <button onClick={handleMintNFT} disabled={mintLoading || mantleStatus === 'connecting' || nftStatus?.minted}
                        className="flex items-center gap-2 px-6 py-2.5 bg-violet-500 hover:bg-violet-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl font-bold text-sm transition-all">
                        <Bot size={16} />{mintLoading ? 'Minting...' : nftStatus?.minted ? 'NFT Minted' : 'Mint Agent NFT'}
                      </button>
                    )}
                    {retryPending > 0 && (
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-1 rounded">
                        {retryPending} retry pending
                      </span>
                    )}
                  </div>
                  {mantleError && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400">{mantleError}</div>}
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-4"><Wallet className="text-zinc-500" size={16} /><h3 className="font-bold text-sm">ERC-8004 Agent NFT</h3></div>
                  <p className="text-zinc-500 text-sm mb-4">
                    Mint an ERC-8004 Agent Identity NFT on Mantle to register your bot on-chain. This proves your agent's decisions are verifiable and tamper-evident.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-3 bg-zinc-800/50 rounded-xl">
                      <span className="text-zinc-500 text-xs">Contract</span>
                      <div className="font-mono text-zinc-300 text-xs mt-1 truncate">{ERC8004_IDENTITY_REGISTRY}</div>
                    </div>
                    <div className="p-3 bg-zinc-800/50 rounded-xl">
                      <span className="text-zinc-500 text-xs">Network</span>
                      <div className="font-mono text-zinc-300 text-xs mt-1">Mantle Mainnet (5000)</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Database Tab ── */}
            {activeTab === 'database' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-lg">Trade Database</h3>
                    <p className="text-zinc-500 text-sm">{trades.length} records loaded</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={fetchTrades} disabled={dbLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all">
                      <Database size={14} />Refresh
                    </button>
                    <button onClick={handleBulkDelete} disabled={selectedIds.size === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl text-xs font-bold transition-all">
                      <Trash2 size={14} />Delete ({selectedIds.size})
                    </button>
                  </div>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto max-h-[500px]">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-zinc-800/30 text-zinc-500 text-[10px] uppercase tracking-widest font-bold sticky top-0">
                          <th className="px-4 py-3 w-10"></th>
                          <th className="px-4 py-3">Symbol</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">R</th>
                          <th className="px-4 py-3">Mode</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50">
                        {trades.map(trade => (
                          <tr key={trade.id} className="hover:bg-zinc-800/20 transition-all">
                            <td className="px-4 py-3">
                              <input type="checkbox" checked={selectedIds.has(trade.id)}
                                onChange={e => {
                                  const next = new Set(selectedIds);
                                  e.target.checked ? next.add(trade.id) : next.delete(trade.id);
                                  setSelectedIds(next);
                                }}
                                className="rounded accent-rose-500" />
                            </td>
                            <td className="px-4 py-3 text-sm font-bold text-white">{trade.symbol}</td>
                            <td className="px-4 py-3 text-xs text-zinc-500 font-mono">{new Date(trade.opened_at).toLocaleDateString()}</td>
                            <td className="px-4 py-3"><span className={cn("text-[10px] font-bold uppercase px-2 py-0.5 rounded", trade.status === 'open' ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-500")}>{trade.status}</span></td>
                            <td className={cn("px-4 py-3 text-sm font-bold font-mono", (trade.r || 0) >= 0 ? "text-emerald-400" : "text-rose-500")}>{(trade.r || 0).toFixed(2)}R</td>
                            <td className="px-4 py-3 text-xs text-zinc-500">{trade.is_paper ? 'Paper' : 'Live'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </PasswordGuard>
  );
}
