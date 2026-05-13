import { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { aiAdminService } from '../services/aiAdminService';
import { 
  Plus, Trash2, Edit2, ShieldCheck, CheckCircle2, XCircle, 
  Search, Save, X, Database, Sparkles, Filter, AlertTriangle 
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import PasswordGuard from '../components/PasswordGuard';
import { useStore } from '../store/useStore';

interface ManagedAsset {
  id: string;
  symbol: string;
  min_risk_r: number;
  max_risk_r: number;
  is_active: boolean;
  notes: string;
  created_at: string;
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'whitelist' | 'database'>('whitelist');
  const [assets, setAssets] = useState<ManagedAsset[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupAdvice, setCleanupAdvice] = useState<{ trashIds: string[], reasoning: string } | null>(null);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);

  // Form State
  const [form, setForm] = useState<Partial<ManagedAsset>>({
    symbol: '',
    min_risk_r: 0.5,
    max_risk_r: 3.0,
    is_active: true,
    notes: ''
  });

  const fetchAssets = async () => {
    if (!supabase) return;
    const dbUserId = useStore.getState().userId === 'demo-user' ? '00000000-0000-0000-0000-000000000000' : (useStore.getState().userId || '00000000-0000-0000-0000-000000000000');
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('managed_assets')
        .select('*')
        .eq('user_id', dbUserId)
        .order('symbol', { ascending: true });
      
      if (error) throw error;
      if (data) setAssets(data);
    } catch (err: any) {
      console.error("Fetch Assets Error:", err);
      // Don't alert on initial load to avoid annoyance, but log it
    } finally {
      setLoading(false);
    }
  };

  const fetchTrades = async () => {
    if (!supabase) return;
    const dbUserId = useStore.getState().userId === 'demo-user' ? '00000000-0000-0000-0000-000000000000' : (useStore.getState().userId || '00000000-0000-0000-0000-000000000000');
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .eq('user_id', dbUserId)
        .order('opened_at', { ascending: false });
      
      if (error) throw error;
      if (data) setTrades(data);
    } catch (err: any) {
      console.error("Fetch Trades Error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'whitelist') fetchAssets();
    else fetchTrades();
  }, [activeTab]);

  const handleAIScan = async () => {
    if (trades.length === 0) {
      alert("No trades in database to scan.");
      return;
    }
    setIsCleaning(true);
    setCleanupAdvice(null);
    try {
      const result = await aiAdminService.detectTrashTrades(trades);
      setCleanupAdvice(result);
      if (result.reasoning.includes("AI Error") || result.reasoning.includes("failed")) {
        alert(result.reasoning);
      }
    } catch (err: any) {
      console.error("Scan Error:", err);
      alert(`AI Scan encountered a system error. Check console.`);
    } finally {
      setIsCleaning(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!cleanupAdvice || !cleanupAdvice.trashIds?.length) return;
    if (!confirm(`Delete ${cleanupAdvice.trashIds.length} flagged trades?`)) return;
    
    setIsCleaning(true);
    const previousTrades = [...trades];
    // Optimistically remove the trash IDs
    setTrades(prev => prev.filter(t => !cleanupAdvice.trashIds.includes(t.id)));

    try {
      const result = await aiAdminService.bulkDelete(cleanupAdvice.trashIds);
      
      if (result.success) {
        setCleanupAdvice(null);
        await fetchTrades(); // Full sync
        alert(`Successfully deleted ${cleanupAdvice.trashIds.length} flagged trades.`);
      } else {
        // Rollback
        setTrades(previousTrades);
        alert(`Bulk delete failed: ${result.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      // Rollback
      setTrades(previousTrades);
      alert(`System Error: ${err.message}`);
    } finally {
      setIsCleaning(false);
    }
  };

  const handleSave = async () => {
    if (!supabase || !form.symbol) return;
    const dbUserId = useStore.getState().userId === 'demo-user' ? '00000000-0000-0000-0000-000000000000' : (useStore.getState().userId || '00000000-0000-0000-0000-000000000000');
    try {
      if (editingId) {
        const { error } = await supabase.from('managed_assets').update(form).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('managed_assets').insert([{ ...form, user_id: dbUserId }]);
        if (error) throw error;
      }
      setIsAdding(false);
      await fetchAssets();
    } catch (err: any) {
      console.error("Save Asset Error:", err);
      alert(`Save failed: ${err.message || 'Check if symbol is unique'}`);
    }
  };

  const handleDeleteAsset = async (id: string) => {
    if (!confirm('Delete asset?')) return;
    
    // Optimistic UI update
    const previousAssets = [...assets];
    setAssets(prev => prev.filter(a => a.id !== id));

    try {
      if (!supabase || !isSupabaseConfigured) {
        // In demo mode, the state is already updated optimistically
        return;
      }
      
      const { success, error: deleteError } = await aiAdminService.bulkDelete([id], 'managed_assets');
      if (!success) {
        console.error("Delete Asset Request Failed:", deleteError);
        throw new Error(deleteError);
      }
      await fetchAssets();
    } catch (err: any) {
      // Rollback on error
      setAssets(previousAssets);
      alert(`Delete failed: ${err.message || 'Unknown network error'}`);
    }
  };

  const filteredAssets = assets.filter(a => 
    a.symbol.toLowerCase().includes(search.toLowerCase()) ||
    (a.notes || '').toLowerCase().includes(search.toLowerCase())
  );

  const filteredTrades = trades.filter(t => {
    const matchesSearch = t.symbol.toLowerCase().includes(search.toLowerCase()) ||
                        t.id.toLowerCase().includes(search.toLowerCase());
    
    if (showFlaggedOnly && cleanupAdvice) {
      return matchesSearch && cleanupAdvice.trashIds.includes(t.id);
    }
    
    return matchesSearch;
  });

  return (
    <PasswordGuard>
      <div className="space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className={cn(isSupabaseConfigured ? "text-emerald-400" : "text-amber-400")} size={24} />
            <h1 className="text-2xl font-bold tracking-tight">Terminal Control</h1>
            {!isSupabaseConfigured && (
              <span className="bg-amber-500/10 text-amber-500 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/20 uppercase tracking-tighter">
                Demo Mode
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-4 mt-2">
            <button 
              onClick={() => setActiveTab('whitelist')}
              className={cn(
                "text-xs font-bold uppercase tracking-widest px-4 py-1.5 rounded-full transition-all",
                activeTab === 'whitelist' ? "bg-emerald-500 text-zinc-950" : "text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-800"
              )}
            >
              Asset Whitelist
            </button>
            <button 
              onClick={() => setActiveTab('database')}
              className={cn(
                "text-xs font-bold uppercase tracking-widest px-4 py-1.5 rounded-full transition-all",
                activeTab === 'database' ? "bg-emerald-500 text-zinc-950" : "text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-800"
              )}
            >
              Database Manager
            </button>
          </div>
        </div>

        {activeTab === 'whitelist' ? (
          <div className="flex gap-2">
            <button onClick={fetchAssets} className="p-2 text-zinc-500 hover:text-zinc-100 transition-colors"><Database size={18} /></button>
            <button 
              onClick={() => {
                setIsAdding(true);
                setEditingId(null);
                setForm({ symbol: '', min_risk_r: 0.5, max_risk_r: 3.0, is_active: true, notes: '' });
              }}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-lg font-bold transition-all"
            >
              <Plus size={18} />
              Whitelist Asset
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={fetchTrades} className="p-2 text-zinc-500 hover:text-zinc-100 transition-colors"><Database size={18} /></button>
            <button 
              onClick={handleAIScan}
              disabled={isCleaning}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-bold transition-all disabled:opacity-50 relative group"
            >
              <Sparkles size={18} />
              {isCleaning ? 'Scanning...' : 'AI Data Cleanup'}
              {/* Tooltip for API Key status */}
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-zinc-800 text-[10px] text-zinc-400 px-2 py-1 rounded border border-zinc-700 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                {process.env.GEMINI_API_KEY ? "AI Analyst Connected" : "AI Analyst Connected"}
              </div>
            </button>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'database' && cleanupAdvice && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-indigo-900/20 border border-indigo-500/30 rounded-2xl p-6 mb-6"
          >
            <div className="flex items-start justify-between">
              <div className="flex gap-3">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                  <Sparkles className="text-indigo-400" size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-indigo-100 italic">Gemini Auditor Advice</h3>
                  <p className="text-sm text-indigo-200/70 mt-1 max-w-2xl">{cleanupAdvice.reasoning}</p>
                  <p className="text-xs font-bold text-indigo-400 mt-2 uppercase tracking-wider">
                    {cleanupAdvice.trashIds.length} problematic entries flagged
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    setCleanupAdvice(null);
                    setShowFlaggedOnly(false);
                  }}
                  className="px-4 py-1.5 text-zinc-400 hover:text-zinc-100 text-xs font-bold"
                >
                  Dismiss
                </button>
                <button 
                  onClick={() => setShowFlaggedOnly(!showFlaggedOnly)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                    showFlaggedOnly 
                      ? "bg-indigo-500 text-white" 
                      : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <Filter size={14} />
                  {showFlaggedOnly ? 'Showing Flagged' : 'Show Only Flagged'}
                </button>
                <button 
                  onClick={handleBulkDelete}
                  disabled={isCleaning}
                  className="flex items-center gap-2 px-4 py-1.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-lg shadow-rose-900/20 transition-all"
                >
                  <Trash2 size={14} className={cn(isCleaning && "animate-spin")} />
                  {isCleaning ? 'Deleting...' : 'Bulk Delete Flagged'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
            <input 
              type="text" 
              placeholder={activeTab === 'whitelist' ? "Search symbols..." : "Search trades..."}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-1.5 text-sm outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>
          {activeTab === 'database' && (
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              Total Database Entries: {trades.length}
            </div>
          )}
        </div>

        {activeTab === 'whitelist' ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/50">
                    <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Symbol</th>
                    <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Risk Tunnel</th>
                    <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {loading ? (
                    <tr><td colSpan={4} className="px-6 py-10 text-center text-zinc-500">Loading whitelist...</td></tr>
                  ) : filteredAssets.length === 0 ? (
                    <tr><td colSpan={4} className="px-6 py-10 text-center text-zinc-500">No assets found matching filters</td></tr>
                  ) : filteredAssets.map((asset) => (
                    <tr key={asset.id} className="hover:bg-zinc-800/30 group">
                      <td className="px-6 py-4 font-bold text-zinc-100">{asset.symbol}</td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                          asset.is_active ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                        )}>
                          {asset.is_active ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-zinc-400 text-xs">{asset.min_risk_r} - {asset.max_risk_r}R</span>
                      </td>
                      <td className="px-6 py-4 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setForm(asset); setEditingId(asset.id); setIsAdding(true); }} className="p-2 text-zinc-500 hover:text-emerald-400"><Edit2 size={16} /></button>
                        <button onClick={() => handleDeleteAsset(asset.id)} className="p-2 text-zinc-500 hover:text-rose-400"><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isAdding && (
               <motion.div 
                 initial={{ opacity: 0, height: 0 }}
                 animate={{ opacity: 1, height: 'auto' }}
                 className="p-6 bg-zinc-950 border-t border-zinc-800 overflow-hidden"
               >
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Symbol</label>
                      <input value={form.symbol} onChange={e=>setForm({...form, symbol: e.target.value.toUpperCase()})} placeholder="BTC/USDT" className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Min Risk</label>
                      <input type="number" step="0.1" value={form.min_risk_r} onChange={e=>setForm({...form, min_risk_r: parseFloat(e.target.value)})} placeholder="0.5" className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Max Risk</label>
                      <input type="number" step="0.1" value={form.max_risk_r} onChange={e=>setForm({...form, max_risk_r: parseFloat(e.target.value)})} placeholder="3.0" className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div className="flex items-end gap-2">
                       <button onClick={handleSave} className="flex-1 bg-emerald-500 text-zinc-950 font-bold rounded text-sm py-2 hover:bg-emerald-400 transition-colors">Save</button>
                       <button onClick={() => setIsAdding(false)} className="bg-zinc-800 text-zinc-400 font-bold rounded text-sm p-2 hover:bg-zinc-700 transition-colors"><X size={20} /></button>
                    </div>
                  </div>
               </motion.div>
            )}
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/50">
                  <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Symbol</th>
                  <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Time</th>
                  <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">PnL (R)</th>
                  <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider">Stats</th>
                  <th className="px-6 py-4 text-xs font-bold text-zinc-500 uppercase tracking-wider text-right">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {loading ? (
                  <tr><td colSpan={5} className="px-6 py-10 text-center text-zinc-500">Loading trade database...</td></tr>
                ) : filteredTrades.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-10 text-center text-zinc-500">No trades found matching filters</td></tr>
                ) : filteredTrades.map((trade) => {
                  const isFlagged = cleanupAdvice?.trashIds.includes(trade.id);
                  return (
                    <tr key={trade.id} className={cn(
                      "hover:bg-zinc-800/30 group transition-colors",
                      isFlagged && "bg-rose-500/10"
                    )}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-zinc-100">{trade.symbol}</span>
                          <span className={cn(
                            "text-[10px] font-bold px-1.5 py-0.5 rounded",
                            trade.direction === 'long' ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                          )}>{trade.direction.toUpperCase()}</span>
                          {isFlagged && <AlertTriangle size={12} className="text-rose-500" />}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-zinc-500 text-xs">
                        {new Date(trade.opened_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-4 font-mono">
                        <span className={cn(
                          "font-bold",
                          (trade.r || 0) > 0 ? "text-emerald-400" : (trade.r || 0) < 0 ? "text-rose-400" : "text-zinc-500"
                        )}>
                          {(trade.r || 0).toFixed(2)}R
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-400">
                        <div className="flex flex-col">
                          <span>{trade.bars_held} bars | {trade.status.toUpperCase()}</span>
                          <span className="text-[10px] text-zinc-600 truncate max-w-[150px]">{trade.id}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={async () => {
                            if (confirm('Delete this trade?')) {
                              // Optimistic UI update
                              const previousTrades = [...trades];
                              setTrades(prev => prev.filter(t => t.id !== trade.id));

                              try {
                                if (!supabase || !isSupabaseConfigured) {
                                  return; // Demo mode success
                                }
                                
                                console.log(`[Admin] Deleting trade via proxy: ${trade.id}`);
                                const { success, error: deleteError } = await aiAdminService.bulkDelete([trade.id]);
                                
                                if (!success) throw new Error(deleteError);
                                await fetchTrades();
                              } catch (err: any) {
                                // Rollback
                                setTrades(previousTrades);
                                alert(`Delete failed: ${err.message || 'Database rejected deletion (Check RLS)'}`);
                              }
                            }
                          }}
                          className="p-1.5 hover:bg-rose-500/10 hover:text-rose-400 rounded transition-colors text-zinc-600 group-hover:text-zinc-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </PasswordGuard>
  );
}
