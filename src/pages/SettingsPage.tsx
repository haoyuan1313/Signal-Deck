import { useStore } from '../store/useStore';
import React, { useState, useEffect } from 'react';
import { Save, AlertCircle, CheckCircle2, Database, Loader2, XCircle, Send, Globe, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
import { testSupabaseConnection } from '../lib/supabase';
import PasswordGuard from '../components/PasswordGuard';

export default function SettingsPage() {
  const { settings, setPaused, updateSettings } = useStore();
  const [isTogglingMaster, setIsTogglingMaster] = useState(false);
  const [isTogglingPaper, setIsTogglingPaper] = useState(false);

  const toggleMaster = async () => {
    if (!settings) return;
    setIsTogglingMaster(true);
    try {
      await setPaused(!settings.paused);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsTogglingMaster(false);
    }
  };

  const togglePaperTrading = async () => {
    if (!settings) return;
    setIsTogglingPaper(true);
    try {
      const newVal = !formData.paper_trading;
      await updateSettings({
        ...settings,
        paper_trading: newVal
      });
      setFormData(prev => ({ ...prev, paper_trading: newVal }));
    } catch (err: any) {
      alert(`Failed to toggle mode: ${err.message}`);
    } finally {
      setIsTogglingPaper(false);
    }
  };

  const [dbStatus, setDbStatus] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null });
  const [tgStatus, setTgStatus] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null });
  const [bbStatus, setBbStatus] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null });
  const [tgConfig, setTgConfig] = useState<{ configured: boolean; chat_id: string; updated_at: string | null }>({
    configured: false,
    chat_id: '',
    updated_at: null,
  });
  const [tgForm, setTgForm] = useState<{ botToken: string; chatId: string }>({ botToken: '', chatId: '' });
  const [tgShowToken, setTgShowToken] = useState(false);
  const [tgSaving, setTgSaving] = useState(false);
  const [tgSaveError, setTgSaveError] = useState<string | null>(null);
  const [tgSaved, setTgSaved] = useState(false);
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
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');

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
      });
    }
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus('saving');
    
    try {
      const symbolsArray = formData.symbols
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(s => s.length > 0);

      if (symbolsArray.length === 0) {
        throw new Error('At least one trading pair is required.');
      }

      await useStore.getState().updateSettings({
        ...settings!,
        ...formData,
        symbols: symbolsArray,
      });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: any) {
      setSaveStatus('idle');
      const isMissingColumn = err.message?.toLowerCase().includes('column') && err.message?.toLowerCase().includes('does not exist');
      if (isMissingColumn) {
        alert(`Partial Save: Some newer settings (like Confluence Filters) could not be saved because your database schema is outdated. Core settings were saved. Please update your Supabase schema using the provided SQL script.`);
      } else {
        alert(`Failed to save settings: ${err.message || 'Unknown error'}`);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/telegram-config');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setTgConfig({
          configured: !!data.configured,
          chat_id: data.chat_id || '',
          updated_at: data.updated_at || null,
        });
        setTgForm(prev => ({ ...prev, chatId: data.chat_id || '' }));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSaveTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    setTgSaveError(null);
    if (!tgForm.botToken.trim() || !tgForm.chatId.trim()) {
      setTgSaveError('Both bot token and chat ID are required.');
      return;
    }
    setTgSaving(true);
    try {
      const res = await fetch('/api/telegram-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: tgForm.botToken.trim(), chatId: tgForm.chatId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setTgConfig({ configured: true, chat_id: tgForm.chatId.trim(), updated_at: new Date().toISOString() });
      setTgForm({ botToken: '', chatId: tgForm.chatId.trim() });
      setTgSaved(true);
      setTimeout(() => setTgSaved(false), 3000);
    } catch (err: any) {
      setTgSaveError(err.message);
    } finally {
      setTgSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    setTgStatus({ loading: true, result: null });
    try {
      const res = await fetch('/api/test-telegram', { method: 'POST' });
      const data = await res.json();
      setTgStatus({ loading: false, result: data });
    } catch (err: any) {
      setTgStatus({ loading: false, result: { success: false, error: err.message } });
    }
  };

  const handleTestBybit = async () => {
    setBbStatus({ loading: true, result: null });
    try {
      // 1. Basic Ping Test
      const pingRes = await fetch('/api/ping');
      if (!pingRes.ok) throw new Error(`Ping failed: ${pingRes.status}`);
      const pingData = await pingRes.json();
      console.log('Ping test okay:', pingData);

      // 2. Prices Test
      const symbolParam = encodeURIComponent('BTC/USDT');
      const res = await fetch(`/api/prices?symbols=${symbolParam}`);
      
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('text/html')) {
        console.error('Bybit Test Error:', {
          status: res.status,
          statusText: res.statusText,
          contentType,
          url: res.url
        });
        
        if (contentType.includes('text/html')) {
          throw new Error(`Server returned HTML (Status ${res.status}). Content: ${contentType}. This happens if the API route is missed and caught by SPA fallback.`);
        }
        let errorData: any = {};
        try {
          errorData = await res.json();
        } catch (e) {
          throw new Error(`Failed to parse JSON response. Status: ${res.status}, Type: ${contentType}`);
        }
        throw new Error(errorData.details || errorData.error || `HTTP ${res.status}: ${JSON.stringify(errorData)}`);
      }

      const data = await res.json();
      if (!data.error) {
        setBbStatus({ loading: false, result: { success: true, price: data['BTC/USDT'] } });
      } else {
        setBbStatus({ loading: false, result: { success: false, error: data.details || data.error } });
      }
    } catch (err: any) {
      setBbStatus({ loading: false, result: { success: false, error: err.message } });
    }
  };

  return (
    <PasswordGuard>
      <div className="max-w-3xl space-y-8 pb-12">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Bot Configuration</h2>
        <p className="text-zinc-500 text-sm">Control pairs, risk, and trend confluence filters.</p>
      </div>

      {!settings ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex flex-col items-center justify-center gap-4 min-h-[300px]">
          <Loader2 className="animate-spin text-emerald-500" size={32} />
          <div className="text-center">
            <p className="font-bold text-zinc-300">Loading Configuration...</p>
            <p className="text-sm text-zinc-500 max-w-xs mx-auto mt-1">If this takes too long, your Supabase connection might be failing. Check the diagnostics below.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl mb-4 text-[11px] text-rose-400 font-mono">
            <p className="font-bold text-rose-200 mb-1">Database Schema Warning:</p>
            <p>Ensure your <code>bot_settings</code> table has these newer columns: <code>atr_period (int)</code>, <code>allowed_sessions (text[])</code>, and <code>require_4h_align (bool)</code>. If saving fails, you may need to run the updated SQL from the <a href="https://github.com" target="_blank" className="underline decoration-dotted underline-offset-2">repository</a> in your Supabase dashboard.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={cn(
              "p-6 rounded-2xl flex items-center justify-between border-2 transition-colors",
              settings.paused 
                ? "bg-rose-500/10 border-rose-500/20 text-rose-400" 
                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            )}>
              <div className="flex flex-col gap-1">
                <span className="font-bold text-lg tracking-tight">{settings.paused ? 'Master Switch: OFF' : 'Master Switch: ON'}</span>
                <p className="text-xs opacity-80">Overall engine state.</p>
              </div>
              <button 
                onClick={toggleMaster}
                disabled={isTogglingMaster}
                className={cn(
                  "px-4 py-2 rounded-xl font-bold transition-all shadow-lg text-sm flex items-center gap-2",
                  settings.paused 
                    ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400" 
                    : "bg-rose-500 text-white hover:bg-rose-600"
                )}
              >
                {isTogglingMaster && <Loader2 className="animate-spin" size={14} />}
                {settings.paused ? 'Enable Bot' : 'Disable Bot'}
              </button>
            </div>

            <div className={cn(
              "p-6 rounded-2xl flex items-center justify-between border-2 transition-colors",
              formData.paper_trading 
                ? "bg-amber-500/10 border-amber-500/20 text-amber-400" 
                : "bg-purple-500/10 border-purple-500/20 text-purple-400"
            )}>
              <div className="flex flex-col gap-1">
                <span className="font-bold text-lg tracking-tight">{formData.paper_trading ? 'Paper Mode' : 'LIVE Mode'}</span>
                <p className="text-xs opacity-80">{formData.paper_trading ? 'Simulated trading only.' : 'REAL funds on Bybit.'}</p>
              </div>
              <button 
                type="button"
                onClick={togglePaperTrading}
                disabled={isTogglingPaper}
                className={cn(
                  "px-4 py-2 rounded-xl font-bold transition-all shadow-lg text-sm flex items-center gap-2",
                  formData.paper_trading 
                    ? "bg-purple-500 text-white hover:bg-purple-600" 
                    : "bg-amber-500 text-zinc-950 hover:bg-amber-400"
                )}
              >
                {isTogglingPaper && <Loader2 className="animate-spin" size={14} />}
                {formData.paper_trading ? 'Switch to LIVE' : 'Switch to Paper'}
              </button>
              
            </div>
          </div>

          <form onSubmit={handleSave} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800">
            <div className="p-8 space-y-6">
              {/* Symbols */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Trading Pairs (comma separated)</label>
                <input 
                  type="text"
                  value={formData.symbols}
                  onChange={(e) => setFormData({...formData, symbols: e.target.value})}
                  className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-mono text-sm"
                  placeholder="BTC/USDT, ETH/USDT, SOL/USDT"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Execution TF</label>
                  <select 
                    value={formData.timeframe}
                    onChange={(e) => setFormData({...formData, timeframe: e.target.value})}
                    className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none transition-all text-sm"
                  >
                    <option value="1m">1m</option>
                    <option value="5m">5m</option>
                    <option value="15m">15m</option>
                  </select>
                </div>
                <div className="group space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">HTF Trend TF</label>
                  <select 
                     value={formData.htf_timeframe}
                     onChange={(e) => setFormData({...formData, htf_timeframe: e.target.value})}
                     className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none transition-all text-sm"
                  >
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                  </select>
                </div>
                <div className="group space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">HTF2 Regime TF</label>
                  <select 
                     value={formData.htf2_timeframe}
                     onChange={(e) => setFormData({...formData, htf2_timeframe: e.target.value})}
                     className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 appearance-none transition-all text-sm"
                  >
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                    <option value="1d">1d</option>
                  </select>
                </div>
                <div className="group space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Lookback Bars</label>
                  <input 
                    type="number"
                    value={formData.bars}
                    onChange={(e) => setFormData({...formData, bars: parseInt(e.target.value) || 100})}
                    className="w-full bg-zinc-800 border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all text-sm"
                    min="100"
                    max="5000"
                  />
                </div>
              </div>

              {/* RR Slider */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Default Risk/Reward Ratio</label>
                  <span className="text-emerald-400 font-mono font-bold">{formData.rr.toFixed(1)}R</span>
                </div>
                <input 
                  type="range"
                  min="1.0"
                  max="5.0"
                  step="0.1"
                  value={formData.rr}
                  onChange={(e) => setFormData({...formData, rr: parseFloat(e.target.value)})}
                  className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Risk Percentage */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Risk per Trade (%)</label>
                  <span className="text-amber-400 font-mono font-bold">{formData.risk_percent.toFixed(1)}%</span>
                </div>
                <input 
                  type="range"
                  min="0.1"
                  max="10.0"
                  step="0.1"
                  value={formData.risk_percent}
                  onChange={(e) => setFormData({...formData, risk_percent: parseFloat(e.target.value)})}
                  className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <p className="text-[10px] text-zinc-500">Calculates order size based on your current account equity.</p>
              </div>

              {/* Directions */}
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
                       <input 
                         type="checkbox"
                         className="hidden"
                         checked={formData.allowed_directions.includes(dir)}
                         onChange={(e) => {
                           const newDirs = e.target.checked 
                            ? [...formData.allowed_directions, dir]
                            : formData.allowed_directions.filter(d => d !== dir);
                           setFormData({...formData, allowed_directions: newDirs});
                         }}
                       />
                       {dir}
                     </label>
                   ))}
                 </div>
              </div>

              {/* ATR Period */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">ATR Period</label>
                  <span className="text-zinc-400 font-mono font-bold">{formData.atr_period} Bars</span>
                </div>
                <input 
                  type="range"
                  min="5"
                  max="50"
                  step="1"
                  value={formData.atr_period}
                  onChange={(e) => setFormData({...formData, atr_period: parseInt(e.target.value)})}
                  className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-500"
                />
                <p className="text-[10px] text-zinc-500">Defines volatility lookback. Larger = Smoother/Slower, Smaller = Faster/Noisier.</p>
              </div>

              {/* Allowed Sessions */}
              <div className="space-y-4">
                <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Allowed Trading Sessions (UTC)</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'asian', label: 'Asian (0-7h)', color: 'blue' },
                    { id: 'london', label: 'London (7-12h)', color: 'emerald' },
                    { id: 'ny_am', label: 'NY Early (12-17h)', color: 'amber' },
                    { id: 'ny_pm', label: 'NY Late (17-22h)', color: 'rose' },
                    { id: 'late', label: 'Late (22-0h)', color: 'zinc' },
                  ].map(session => (
                    <label key={session.id} className={cn(
                      "flex items-center justify-center p-2 rounded-lg border cursor-pointer transition-all text-[10px] font-bold uppercase tracking-tight text-center",
                      formData.allowed_sessions.includes(session.id)
                        ? `bg-${session.color}-500/10 border-${session.color}-500/50 text-${session.color}-400`
                        : "bg-zinc-800/50 border-transparent text-zinc-600"
                    )}>
                      <input 
                        type="checkbox"
                        className="hidden"
                        checked={formData.allowed_sessions.includes(session.id)}
                        onChange={(e) => {
                          const newSessions = e.target.checked 
                            ? [...formData.allowed_sessions, session.id]
                            : formData.allowed_sessions.filter(s => s !== session.id);
                          setFormData({...formData, allowed_sessions: newSessions});
                        }}
                      />
                      {session.label}
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-500 italic">Displacement is usually strongest/cleanest in London and NY Early.</p>
              </div>

              {/* 4H Alignment Toggle */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Require 4H Trend Alignment</label>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer"
                      checked={formData.require_4h_align}
                      onChange={(e) => setFormData({...formData, require_4h_align: e.target.checked})}
                    />
                    <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                </div>
                <p className="text-[10px] text-zinc-500">Only enters a 1H setup if the 4H trend direction matches. Significantly increases win rate by trading with the macro trend.</p>
              </div>
            </div>

            <div className="p-6 bg-zinc-800/30 flex items-center justify-end px-8">
              <AnimatePresence mode="wait">
                {saveStatus === 'success' ? (
                  <motion.div 
                    key="success"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 text-emerald-400 font-bold"
                  >
                    <CheckCircle2 size={18} />
                    Settings Saved
                  </motion.div>
                ) : (
                  <button 
                    type="submit"
                    disabled={saveStatus === 'saving'}
                    className="flex items-center gap-2 px-8 py-3 bg-zinc-100 hover:bg-white text-zinc-950 rounded-xl font-bold transition-all transform active:scale-95 disabled:opacity-50"
                  >
                    <Save size={18} />
                    Update Bot
                  </button>
                )}
              </AnimatePresence>
            </div>
          </form>

          <div className="flex items-start gap-3 p-4 bg-amber-500/5 rounded-xl border border-amber-500/20 text-amber-500/80 text-xs leading-relaxed">
            <AlertCircle size={32} className="shrink-0" />
            <p>
              <strong>Warning:</strong> Changes saved here will be picked up by the bot engine on its next loop (usually within 30 seconds). 
              Ensure symbols are formatted as 'BTC/USDT'. Invalid symbols may cause loop errors.
            </p>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            <Database className="text-zinc-500" />
            <h3 className="text-lg font-bold">Database Diagnostic</h3>
          </div>
          
          <p className="text-zinc-500 text-sm">
            Verify if your <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are correctly configured.
          </p>

          <div className="flex flex-col gap-4">
            <button 
              onClick={async () => {
                setDbStatus({ loading: true, result: null });
                const res = await testSupabaseConnection();
                setDbStatus({ loading: false, result: res });
              }}
              disabled={dbStatus.loading}
              className="flex items-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold transition-all disabled:opacity-50 w-fit"
            >
              {dbStatus.loading ? <Loader2 className="animate-spin" size={18} /> : <Database size={18} />}
              Test Supabase Connection
            </button>

            <AnimatePresence>
              {dbStatus.result && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "p-4 rounded-xl border flex items-start gap-3",
                    dbStatus.result.success ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                  )}
                >
                  {dbStatus.result.success ? <CheckCircle2 className="shrink-0" /> : <XCircle className="shrink-0" />}
                  <div className="text-sm">
                    <p className="font-bold mb-1">{dbStatus.result.success ? 'Connection Successful!' : 'Connection Failed'}</p>
                    <p className="opacity-80 font-mono text-xs">
                      {dbStatus.result.success ? 'Successfully fetched bot settings from the database.' : dbStatus.result.error}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            <Send className="text-zinc-500" />
            <h3 className="text-lg font-bold">Telegram Notifications</h3>
            {tgConfig.configured && (
              <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Configured
              </span>
            )}
          </div>

          <p className="text-zinc-500 text-sm">
            Enter your bot token and chat ID to receive trade and signal notifications.
            The token is AES-256 encrypted before storage.
          </p>

          <form onSubmit={handleSaveTelegram} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Bot Token
                {tgConfig.configured && <span className="ml-2 text-[10px] text-zinc-600 normal-case font-normal">(stored — enter a new value to overwrite)</span>}
              </label>
              <div className="relative">
                <input
                  type={tgShowToken ? 'text' : 'password'}
                  value={tgForm.botToken}
                  onChange={e => setTgForm({ ...tgForm, botToken: e.target.value })}
                  placeholder={tgConfig.configured ? '••••••••••••••••••••••••••••' : '123456789:ABC-DEF...'}
                  autoComplete="off"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 pr-12 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setTgShowToken(!tgShowToken)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {tgShowToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-[10px] text-zinc-600">Get one from @BotFather on Telegram (/newbot).</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Chat ID</label>
              <input
                type="text"
                value={tgForm.chatId}
                onChange={e => setTgForm({ ...tgForm, chatId: e.target.value })}
                placeholder="e.g. 123456789 or -1001234567890"
                autoComplete="off"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
              />
              <p className="text-[10px] text-zinc-600">DM your bot, then visit https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates to find your chat ID.</p>
            </div>

            <AnimatePresence>
              {tgSaveError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400"
                >
                  <XCircle size={14} />
                  {tgSaveError}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={tgSaving}
              className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-bold rounded-xl transition-all active:scale-95"
            >
              {tgSaving
                ? <><Loader2 size={16} className="animate-spin" /> Saving...</>
                : tgSaved
                ? <><CheckCircle2 size={16} /> Saved</>
                : <><ShieldCheck size={16} /> Save encrypted config</>}
            </button>
          </form>

          <div className="pt-4 border-t border-zinc-800">
            <button
              onClick={handleTestTelegram}
              disabled={tgStatus.loading}
              className="flex items-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold transition-all disabled:opacity-50 w-fit text-sm"
            >
              {tgStatus.loading ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
              Send test message
            </button>

            <AnimatePresence>
              {tgStatus.result && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "mt-4 p-4 rounded-xl border flex items-start gap-3",
                    tgStatus.result.success ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                  )}
                >
                  {tgStatus.result.success ? <CheckCircle2 className="shrink-0" /> : <XCircle className="shrink-0" />}
                  <div className="text-sm">
                    <p className="font-bold mb-1">{tgStatus.result.success ? 'Telegram Success!' : 'Telegram Error'}</p>
                    <p className="opacity-80 font-mono text-xs">
                      {tgStatus.result.success ? 'Sent a test message to your Telegram chat.' : tgStatus.result.error}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            <Globe className="text-zinc-500" />
            <h3 className="text-lg font-bold">Bybit Diagnostic</h3>
          </div>
          
          <p className="text-zinc-500 text-sm">
            Verify if Bybit API is reachable and symbols are valid.
          </p>

          <div className="flex flex-col gap-4">
            <button 
              onClick={handleTestBybit}
              disabled={bbStatus.loading}
              className="flex items-center gap-2 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold transition-all disabled:opacity-50 w-fit"
            >
              {bbStatus.loading ? <Loader2 className="animate-spin" size={18} /> : <Globe size={18} />}
              Test Bybit API
            </button>

            <AnimatePresence>
              {bbStatus.result && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "p-4 rounded-xl border flex items-start gap-3",
                    bbStatus.result.success ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                  )}
                >
                  {bbStatus.result.success ? <CheckCircle2 className="shrink-0" /> : <XCircle className="shrink-0" />}
                  <div className="text-sm">
                    <p className="font-bold mb-1">{bbStatus.result.success ? 'Bybit Success!' : 'Bybit Connection Error'}</p>
                    <p className="opacity-80 font-mono text-xs">
                      {bbStatus.result.success 
                        ? `BTC/USDT Price: ${formatCurrency(bbStatus.result.price)}` 
                        : bbStatus.result.error}
                    </p>
                    {!bbStatus.result.success && bbStatus.result.error.toLowerCase().includes("failed to fetch") && (
                      <p className="mt-3 text-white bg-rose-500/20 p-2 rounded border border-rose-500/30">
                        <strong>Tip:</strong> Try setting <code>BYBIT_HOSTNAME</code> to <code>bytick.com</code> or <code>bybit.com</code> in your Settings -&gt; Environment Variables.
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      </div>
    </PasswordGuard>
  );
}
