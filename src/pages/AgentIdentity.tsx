import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Bot, ExternalLink, Radio, Maximize2, Activity, TrendingUp,
  BarChart2, Clock, Wallet, ShieldCheck, AlertTriangle,
  RefreshCw, Copy, Check, X, Zap, Hash, Coins
} from 'lucide-react';
import { cn } from '../lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────

interface WalletInfo {
  connected: boolean;
  address: string | null;
  network: string;
  chainId: number;
  isTestnet: boolean;
  rpcUrl: string;
}

interface NFTStatus {
  minted: boolean;
  tokenId?: string;
  txHash?: string;
}

interface RetryEntry {
  tradeId: string;
  action: string;
  symbol: string;
  attempts: number;
  lastAttempt: string;
}

interface MantleStatus {
  wallet: WalletInfo;
  nft: NFTStatus;
  retryQueue: { pending: number; entries: RetryEntry[] };
}

interface OnChainDecision {
  symbol: string;
  action: 'open' | 'close';
  entry: number;
  sl: number;
  tp: number;
  direction: 'long' | 'short';
  tradeId: string;
  aiConfidence?: number;
}

interface HistoryRecord {
  txHash: string;
  blockNumber: number;
  timestamp: string;
  decision: OnChainDecision | null;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function AgentIdentity() {
  const [demoMode, setDemoMode] = useState(false);
  const [status, setStatus] = useState<MantleStatus | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [historyMaxBlocks, setHistoryMaxBlocks] = useState(300000);

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        fetch('/api/mantle/status'),
        fetch(`/api/mantle/history?maxBlocks=${historyMaxBlocks}`),
      ]);
      const statusData = await statusRes.json();
      const historyData = await historyRes.json();
      setStatus(statusData);
      setHistory(historyData.history || []);
    } catch (err) {
      console.error('AgentIdentity: fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, [historyMaxBlocks]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleMintNFT = async () => {
    setMinting(true);
    setMintError(null);
    try {
      const res = await fetch('/api/mantle/mint-nft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'SignalDeck Agent',
          strategy: 'SMC FVG + HTF Trend',
          metadataURI: 'https://signaldeck-beta.vercel.app/api/agent/metadata',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Mint failed');
      }
      await fetchAll(); // refresh status
    } catch (err: any) {
      setMintError(err.message);
    } finally {
      setMinting(false);
    }
  };

  const copyAddress = () => {
    if (status?.wallet.address) {
      navigator.clipboard.writeText(status.wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ─── Computed stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const validDecisions = history
      .filter(h => h.decision !== null)
      .map(h => h.decision!);

    const totalDecisions = validDecisions.length;
    const openDecisions = validDecisions.filter(d => d.action === 'open');
    const avgConfidence = openDecisions.length > 0
      ? openDecisions.reduce((sum, d) => sum + (d.aiConfidence || 0), 0) / openDecisions.length
      : 0;

    // Estimate total volume from open decisions (entry × direction)
    const totalVolume = openDecisions
      .reduce((sum, d) => sum + (d.entry || 0), 0);

    // Win rate: for this we need trades table data — estimate from direction vs price
    const closedDecisions = validDecisions.filter(d => d.action === 'close');
    const onChainWinRate = '—'; // requires outcome data from Supabase

    return {
      totalDecisions,
      avgConfidence: (avgConfidence / 100).toFixed(1),
      totalVolume: totalVolume > 0 ? `$${(totalVolume).toFixed(0)}` : '—',
      onChainWinRate,
      lastBlock: history.length > 0 ? history[0].blockNumber : null,
    };
  }, [history]);

  // ─── Loading skeleton ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-8 pb-20">
        <header className="flex items-center gap-2 mb-1">
          <Bot className="text-violet-400" size={28} />
          <h2 className="text-3xl font-bold tracking-tight">Agent Identity</h2>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-zinc-900 border border-zinc-800 rounded-3xl p-8 animate-pulse">
            <div className="w-24 h-24 bg-zinc-800 rounded-full mx-auto mb-6" />
            <div className="h-6 bg-zinc-800 rounded w-48 mx-auto mb-2" />
            <div className="h-4 bg-zinc-800 rounded w-32 mx-auto" />
          </div>
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 animate-pulse">
                  <div className="h-4 bg-zinc-800 rounded w-24 mb-3" />
                  <div className="h-8 bg-zinc-800 rounded w-16" />
                </div>
              ))}
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 animate-pulse">
              <div className="h-64 bg-zinc-800 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const wallet = status?.wallet;
  const nft = status?.nft;
  const retry = status?.retryQueue;

  return (
    <div className={cn("space-y-8 pb-20", demoMode && "fixed inset-0 z-50 bg-zinc-950 p-8 overflow-auto")}>
      {/* Header */}
      {!demoMode && (
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Bot className="text-violet-400" size={28} />
              <h2 className="text-3xl font-bold tracking-tight">Agent Identity</h2>
              {wallet?.connected && (
                <span className={cn(
                  "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ml-2",
                  wallet.isTestnet
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                )}>
                  {wallet.isTestnet ? 'Testnet' : 'Mainnet'}
                </span>
              )}
            </div>
            <p className="text-zinc-500 text-sm">Mantle ERC-8004 on-chain agent verification and decision log.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchAll}
              className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => setDemoMode(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-violet-500/10 border border-violet-500/20 text-violet-400 rounded-xl font-bold text-sm hover:bg-violet-500/20 transition-all"
            >
              <Maximize2 size={16} />
              Demo Day Mode
            </button>
          </div>
        </header>
      )}

      {demoMode && (
        <button
          onClick={() => setDemoMode(false)}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white p-2 bg-zinc-900 rounded-lg border border-zinc-800 z-10"
        >
          <X size={16} className="mr-1 inline" /> Exit Demo Mode
        </button>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column — Wallet + NFT + Retry */}
        <div className="lg:col-span-1 space-y-4">
          {/* Wallet Info Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Wallet size={16} className="text-violet-400" />
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Wallet</h3>
            </div>

            {wallet?.connected ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-emerald-400 font-bold uppercase">Connected</span>
                </div>
                <div className="bg-zinc-950 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-zinc-400 truncate max-w-[200px]">
                      {wallet.address}
                    </span>
                    <button onClick={copyAddress} className="p-1 hover:bg-zinc-800 rounded transition-all">
                      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-zinc-500" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Network</span>
                    <span className="text-white font-mono">{wallet.network}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Chain ID</span>
                    <span className="text-white font-mono">{wallet.chainId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Environment</span>
                    <span className={cn(
                      "font-bold uppercase text-[10px] px-2 py-0.5 rounded",
                      wallet.isTestnet
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-emerald-500/10 text-emerald-400"
                    )}>
                      {wallet.isTestnet ? 'Testnet' : 'Mainnet'}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Radio size={20} className="text-zinc-500" />
                </div>
                <p className="text-sm text-zinc-400 mb-1">Wallet not connected</p>
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest">
                  Connect in Settings → Mantle
                </p>
              </div>
            )}
          </motion.div>

          {/* ERC-8004 NFT Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-gradient-to-br from-violet-950/30 to-zinc-900 border border-violet-500/20 rounded-3xl p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-violet-400" />
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">ERC-8004 NFT</h3>
            </div>

            {nft?.minted ? (
              <>
                <div className="text-center py-4">
                  <div className="w-16 h-16 bg-violet-500/20 rounded-full flex items-center justify-center border-2 border-violet-500/30 mx-auto mb-3">
                    <Hash size={28} className="text-violet-400" />
                  </div>
                  <p className="text-sm text-white font-bold">
                    {nft.tokenId && nft.tokenId !== 'unknown'
                      ? `Token #${nft.tokenId}`
                      : 'Agent Registered'}
                  </p>
                  {nft.txHash && (
                    <a
                      href={`https://explorer.mantle.xyz/tx/${nft.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-violet-400 hover:underline flex items-center justify-center gap-1 mt-1"
                    >
                      {nft.txHash.slice(0, 14)}... <ExternalLink size={10} />
                    </a>
                  )}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Name</span>
                    <span className="text-white font-mono">SignalDeck Agent</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Strategy</span>
                    <span className="text-white font-mono">SMC · FVG</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Standard</span>
                    <span className="text-violet-400 font-mono text-[10px]">ERC-8004</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-violet-500/10 rounded-full flex items-center justify-center border border-violet-500/20 mx-auto mb-3">
                  <Zap size={28} className="text-violet-400/50" />
                </div>
                <p className="text-sm text-zinc-400 mb-3">
                  {mintError?.includes('not configured')
                    ? 'ERC-8004 address not set'
                    : 'Agent NFT not yet minted'}
                </p>
                {mintError && (
                  <p className="text-xs text-amber-400 mb-3 bg-amber-500/10 rounded-lg py-1 px-2">
                    {mintError.includes('not configured')
                      ? 'Set ERC8004_IDENTITY_REGISTRY in environment to enable minting.'
                      : mintError}
                  </p>
                )}
                <button
                  onClick={handleMintNFT}
                  disabled={minting || !wallet?.connected || mintError?.includes('not configured')}
                  className={cn(
                    "w-full py-2.5 rounded-xl font-bold text-sm transition-all",
                    !wallet?.connected
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                      : mintError?.includes('not configured')
                        ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                        : "bg-violet-500 text-white hover:bg-violet-400"
                  )}
                >
                  {minting ? 'Minting...'
                    : mintError?.includes('not configured') ? 'Address Pending'
                    : 'Mint Agent NFT'}
                </button>
                {!wallet?.connected && (
                  <p className="text-[10px] text-zinc-600 mt-2">Connect wallet first</p>
                )}
              </div>
            )}
          </motion.div>

          {/* Retry Queue Status */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-3"
          >
            <div className="flex items-center gap-2">
              {retry && retry.pending > 0 ? (
                <AlertTriangle size={16} className="text-amber-400" />
              ) : (
                <Activity size={16} className="text-emerald-400" />
              )}
              <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Retry Queue</h3>
              {retry && (
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto",
                  retry.pending > 0
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-emerald-500/10 text-emerald-400"
                )}>
                  {retry.pending > 0 ? `${retry.pending} pending` : 'Clear'}
                </span>
              )}
            </div>

            {retry && retry.entries.length > 0 ? (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {retry.entries.map((entry, i) => (
                  <div key={i} className="bg-zinc-950 rounded-lg p-2 text-[10px] flex items-center justify-between">
                    <div>
                      <span className={cn(
                        "font-bold uppercase mr-2",
                        entry.action === 'open' ? 'text-emerald-400' : 'text-rose-400'
                      )}>{entry.action}</span>
                      <span className="text-zinc-400">{entry.symbol}</span>
                    </div>
                    <div className="text-zinc-500">
                      Attempt {entry.attempts}/3 · {new Date(entry.lastAttempt).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-600 text-center py-2">No pending retries</p>
            )}
          </motion.div>
        </div>

        {/* Right Column — Stats + Decision Log */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stats Row */}
          <div className={cn(
            "grid gap-4",
            demoMode ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"
          )}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Activity size={16} className="text-violet-400" />
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Decisions</span>
              </div>
              <span className="text-3xl font-bold font-mono tracking-tight text-violet-400">
                {stats.totalDecisions}
              </span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Zap size={16} className="text-amber-400" />
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Avg AI Score</span>
              </div>
              <span className="text-3xl font-bold font-mono tracking-tight text-amber-400">
                {stats.avgConfidence}%
              </span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Coins size={16} className="text-emerald-400" />
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Volume</span>
              </div>
              <span className="text-3xl font-bold font-mono tracking-tight text-emerald-400">
                {stats.totalVolume}
              </span>
            </motion.div>

            {demoMode && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Hash size={16} className="text-zinc-400" />
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Last Block</span>
                </div>
                <span className="text-3xl font-bold font-mono tracking-tight text-white">
                  {stats.lastBlock?.toLocaleString() || '—'}
                </span>
              </motion.div>
            )}
          </div>

          {/* Decision Log Table */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
          >
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-zinc-500" />
                <h3 className="font-bold text-sm uppercase tracking-widest text-zinc-400">On-Chain Decision Log</h3>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={historyMaxBlocks}
                  onChange={e => setHistoryMaxBlocks(Number(e.target.value))}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-400 px-2 py-1"
                >
                  <option value={5000}>5K blocks</option>
                  <option value={50000}>50K blocks</option>
                  <option value={150000}>150K blocks (~3 days)</option>
                  <option value={300000}>300K blocks (~1 week)</option>
                </select>
                <span className="text-[10px] text-zinc-600 font-mono">{history.length} records</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left whitespace-nowrap">
                <thead>
                  <tr className="bg-zinc-800/30 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                    <th className="px-6 py-4">Block</th>
                    <th className="px-6 py-4">Age</th>
                    <th className="px-6 py-4">Action</th>
                    <th className="px-6 py-4">Symbol</th>
                    <th className="px-6 py-4">Direction</th>
                    <th className="px-6 py-4">Entry</th>
                    <th className="px-6 py-4">SL</th>
                    <th className="px-6 py-4">TP</th>
                    <th className="px-6 py-4">AI Score</th>
                    <th className="px-6 py-4">Tx Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <Bot className="text-zinc-800" size={48} />
                          <p className="text-zinc-500 italic text-sm">No on-chain decisions yet</p>
                          <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
                            Bot trades will appear here once executed
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : history.map((record, i) => {
                    const d = record.decision;
                    const age = Math.floor((Date.now() - new Date(record.timestamp).getTime()) / 60000);
                    const ageStr = age < 1 ? 'just now' : age < 60 ? `${age}m ago` : age < 1440 ? `${Math.floor(age / 60)}h ago` : `${Math.floor(age / 1440)}d ago`;

                    return (
                      <tr key={i} className="hover:bg-zinc-800/20 transition-all">
                        <td className="px-6 py-4 text-xs font-mono text-zinc-500">
                          {record.blockNumber.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-500">{ageStr}</td>
                        <td className="px-6 py-4">
                          {d ? (
                            <span className={cn(
                              'px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                              d.action === 'open'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-rose-500/10 text-rose-400'
                            )}>
                              {d.action}
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-white">
                          {d?.symbol || '—'}
                        </td>
                        <td className="px-6 py-4">
                          {d ? (
                            <span className={cn(
                              'text-xs font-bold uppercase',
                              d.direction === 'long' ? 'text-emerald-400' : 'text-rose-400'
                            )}>
                              {d.direction}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-zinc-300">
                          ${d?.entry?.toFixed(4) || '—'}
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-rose-400">
                          ${d?.sl?.toFixed(4) || '—'}
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-emerald-400">
                          ${d?.tp?.toFixed(4) || '—'}
                        </td>
                        <td className="px-6 py-4">
                          {d?.aiConfidence != null && d.aiConfidence > 0 ? (
                            <span className="text-xs font-mono text-amber-400">
                              {(d.aiConfidence / 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <a
                            href={`https://explorer.mantle.xyz/tx/${record.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-violet-400 text-xs font-mono hover:underline flex items-center gap-1"
                          >
                            {record.txHash.slice(0, 10)}...
                            <ExternalLink size={10} />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
