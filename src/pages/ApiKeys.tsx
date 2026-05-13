import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Key, Eye, EyeOff, CheckCircle2, XCircle, Loader2,
  ShieldCheck, AlertTriangle, ExternalLink, Copy, Check,
  Trash2, RefreshCcw, Wifi
} from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { useUser } from '../hooks/useUser';

interface ApiKeyRecord {
  id: string;
  user_id: string;
  label: string;
  bybit_api_key_hint: string; // only last 4 chars stored for display
  bybit_testnet: boolean;
  is_active: boolean;
  created_at: string;
  last_verified_at: string | null;
  account_type: string;
}

interface FormState {
  label: string;
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  accountType: string;
}

const STEPS = [
  { n: 1, label: 'Log in to Bybit' },
  { n: 2, label: 'Create API key' },
  { n: 3, label: 'Set permissions' },
  { n: 4, label: 'Whitelist server IP' },
  { n: 5, label: 'Paste keys here' },
];

const SERVER_IP = '0.0.0.0'; // Replace with your actual Cloud Run static IP

export default function ApiKeysPage() {
  const { userId } = useUser();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    label: 'My Bybit Account',
    apiKey: '',
    apiSecret: '',
    testnet: true,
    accountType: 'swap',
  });

  useEffect(() => {
    if (userId) fetchKeys();
  }, [userId]);

  const fetchKeys = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user/api-keys', {
        headers: {
          'x-user-id': userId || 'demo-user'
        }
      });
      const data = await res.json();
      if (res.ok) setKeys(data);
    } catch (e) {
      console.error('Failed to fetch keys:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.apiKey.trim() || !form.apiSecret.trim()) {
      setSaveError('Both API key and secret are required.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/user/api-keys', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId || 'demo-user'
        },
        body: JSON.stringify({
          label: form.label,
          apiKey: form.apiKey.trim(),
          apiSecret: form.apiSecret.trim(),
          testnet: form.testnet,
          accountType: form.accountType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setShowForm(false);
      setForm({ label: 'My Bybit Account', apiKey: '', apiSecret: '', testnet: true, accountType: 'swap' });
      fetchKeys();
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (keyId: string) => {
    setTesting(keyId);
    setTestResult(null);
    try {
      const res = await fetch(`/api/user/api-keys/${keyId}/test`, { 
        method: 'POST',
        headers: {
          'x-user-id': userId || 'demo-user'
        }
      });
      const data = await res.json();
      setTestResult({
        id: keyId,
        ok: data.success,
        msg: data.success
          ? `Connected — equity: $${Number(data.equity || 0).toFixed(2)}`
          : data.error || 'Connection failed',
      });
    } catch (err: any) {
      setTestResult({ id: keyId, ok: false, msg: err.message });
    } finally {
      setTesting(null);
    }
  };

  const handleDelete = async (keyId: string) => {
    try {
      await fetch(`/api/user/api-keys/${keyId}`, { 
        method: 'DELETE',
        headers: {
          'x-user-id': userId || 'demo-user'
        }
      });
      setDeleteConfirm(null);
      fetchKeys();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const handleToggleActive = async (keyId: string, current: boolean) => {
    try {
      await fetch(`/api/user/api-keys/${keyId}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-id': userId || 'demo-user'
        },
        body: JSON.stringify({ is_active: !current }),
      });
      fetchKeys();
    } catch (e) {
      console.error('Toggle failed:', e);
    }
  };

  const copyIp = () => {
    navigator.clipboard.writeText(SERVER_IP);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 2000);
  };

  return (
    <div className="max-w-3xl space-y-8 pb-20">

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
            <Key className="text-emerald-400" size={20} />
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Exchange API Keys</h2>
        </div>
        <p className="text-zinc-500 text-sm">
          Connect your Bybit account so the bot can trade on your behalf.
          Keys are encrypted before storage and never shared.
        </p>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <ShieldCheck size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-300/80 leading-relaxed space-y-1">
          <p className="font-bold text-amber-400">Before you add keys — critical security steps</p>
          <p>1. Create a <strong>trade-only</strong> API key on Bybit. Never enable withdrawal permission.</p>
          <p>2. Whitelist only our server IP: <code className="bg-amber-500/10 px-1.5 py-0.5 rounded font-mono text-amber-300">{SERVER_IP}</code>
            <button onClick={copyIp} className="ml-2 text-amber-400 hover:text-amber-300 transition-colors">
              {copiedIp ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </p>
          <p>3. With IP whitelisting, your key is useless even if stolen.</p>
        </div>
      </div>

      {/* How-to guide */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-300">How to create your Bybit API key</span>
          <a
            href="https://www.bybit.com/en/user/api-management"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            Open Bybit <ExternalLink size={12} />
          </a>
        </div>
        <div className="p-5">
          <div className="flex flex-col gap-4">
            {[
              { n: 1, title: 'Go to Bybit API Management', desc: 'Account → API → Create New Key' },
              { n: 2, title: 'Select "System-generated API Keys"', desc: 'Choose the API key type' },
              { n: 3, title: 'Set permissions', desc: 'Enable: Unified Trading (Read + Trade). Disable: Asset transfer, Withdrawal — everything else.' },
              { n: 4, title: 'Whitelist our server IP', desc: `Enter exactly: ${SERVER_IP} — this locks the key to our server only.` },
              { n: 5, title: 'Copy your API key and secret', desc: 'The secret is shown only once. Save it immediately.' },
            ].map(step => (
              <div key={step.n} className="flex items-start gap-4">
                <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">
                  {step.n}
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200">{step.title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Existing keys */}
      {loading ? (
        <div className="flex items-center gap-3 text-zinc-500 text-sm py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading keys...
        </div>
      ) : keys.length > 0 ? (
        <div className="space-y-3">
          <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Connected accounts ({keys.length})</div>
          {keys.map(key => (
            <motion.div
              key={key.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center border',
                    key.is_active
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-600'
                  )}>
                    <Key size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-zinc-100">{key.label}</span>
                      <span className={cn(
                        'text-[9px] px-2 py-0.5 rounded-full font-bold uppercase border',
                        key.bybit_testnet
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                      )}>
                        {key.bybit_testnet ? 'Testnet' : 'Mainnet'}
                      </span>
                      {key.is_active && (
                        <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 font-mono mt-0.5">
                      ••••••••••••{key.bybit_api_key_hint}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      Added {new Date(key.created_at).toLocaleDateString()}
                      {key.last_verified_at && ` · Verified ${new Date(key.last_verified_at).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Test connection */}
                  <button
                    onClick={() => handleTest(key.id)}
                    disabled={testing === key.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-all border border-zinc-700"
                  >
                    {testing === key.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Wifi size={12} />}
                    Test
                  </button>

                  {/* Toggle active */}
                  <button
                    onClick={() => handleToggleActive(key.id, key.is_active)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-bold rounded-lg transition-all border',
                      key.is_active
                        ? 'text-rose-400 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20'
                        : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20'
                    )}
                  >
                    {key.is_active ? 'Pause' : 'Activate'}
                  </button>

                  {/* Delete */}
                  {deleteConfirm === key.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(key.id)}
                        className="px-3 py-1.5 text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 rounded-lg transition-all"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(key.id)}
                      className="p-1.5 text-zinc-600 hover:text-rose-400 transition-colors rounded-lg hover:bg-rose-500/10"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Test result */}
              <AnimatePresence>
                {testResult?.id === key.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={cn(
                      'mt-4 flex items-center gap-2 p-3 rounded-xl text-xs font-medium border',
                      testResult.ok
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/5 border-rose-500/20 text-rose-400'
                    )}
                  >
                    {testResult.ok
                      ? <CheckCircle2 size={14} />
                      : <XCircle size={14} />}
                    {testResult.msg}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-zinc-800 rounded-2xl text-zinc-600 gap-3">
          <Key size={32} />
          <p className="text-sm font-medium">No API keys connected yet</p>
          <p className="text-xs">Add your first Bybit API key to start trading</p>
        </div>
      )}

      {/* Add key button / form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
        >
          <Key size={16} />
          Add Bybit API Key
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
            <span className="font-bold text-sm text-zinc-200">Add new API key</span>
            <button
              onClick={() => { setShowForm(false); setSaveError(null); }}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <XCircle size={18} />
            </button>
          </div>

          <form onSubmit={handleSave} className="p-6 space-y-5">
            {/* Label */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Label
              </label>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. My Bybit Main"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
              />
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                API Key
              </label>
              <input
                type="text"
                value={form.apiKey}
                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder="Paste your Bybit API key"
                autoComplete="off"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
              />
            </div>

            {/* API Secret */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                API Secret
              </label>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={form.apiSecret}
                  onChange={e => setForm({ ...form, apiSecret: e.target.value })}
                  placeholder="Paste your API secret"
                  autoComplete="off"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 pr-12 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-[10px] text-zinc-600">
                The secret is encrypted with AES-256 before saving. We never store it in plaintext.
              </p>
            </div>

            {/* Options row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Network
                </label>
                <div className="flex gap-2">
                  {[
                    { val: true, label: 'Testnet' },
                    { val: false, label: 'Mainnet' },
                  ].map(opt => (
                    <button
                      key={String(opt.val)}
                      type="button"
                      onClick={() => setForm({ ...form, testnet: opt.val })}
                      className={cn(
                        'flex-1 py-2 text-xs font-bold rounded-lg border transition-all',
                        form.testnet === opt.val
                          ? opt.val
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                            : 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-500'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Account type
                </label>
                <select
                  value={form.accountType}
                  onChange={e => setForm({ ...form, accountType: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                >
                  <option value="swap">Derivatives (Swap)</option>
                  <option value="spot">Spot</option>
                </select>
              </div>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 p-3 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
              <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Make sure you have whitelisted <span className="text-zinc-300 font-mono">{SERVER_IP}</span> on
                Bybit before saving. Keys without IP whitelisting are a security risk.
              </p>
            </div>

            {/* Error */}
            <AnimatePresence>
              {saveError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400"
                >
                  <XCircle size={14} />
                  {saveError}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button
              type="submit"
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-bold rounded-xl transition-all active:scale-95"
            >
              {saving
                ? <><Loader2 size={16} className="animate-spin" /> Encrypting & saving...</>
                : <><ShieldCheck size={16} /> Save encrypted key</>}
            </button>
          </form>
        </motion.div>
      )}
    </div>
  );
}