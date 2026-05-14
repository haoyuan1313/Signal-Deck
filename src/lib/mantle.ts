// ─── Mantle Integration — On-chain agent identity & decision logging ─────
// ethers.js v6 — BigInt, not BigNumber. All Mantle writes are non-blocking.

import { ethers } from 'ethers';
import { ERC8004_IDENTITY_REGISTRY } from './constants.ts';

// ─── Network Config ─────────────────────────────────────────────────────────

export const MANTLE_TESTNET = {
  chainId: 5001,
  name: 'Mantle Sepolia Testnet',
  rpcUrl: 'https://rpc.sepolia.mantle.xyz',
  explorerUrl: 'https://explorer.sepolia.mantle.xyz',
};

export const MANTLE_MAINNET_CFG = {
  chainId: 5000,
  name: 'Mantle Mainnet',
  rpcUrl: 'https://rpc.mantle.xyz',
  explorerUrl: 'https://explorer.mantle.xyz',
};

export const MANTLE = process.env.MANTLE_MAINNET === 'true' ? MANTLE_MAINNET_CFG : MANTLE_TESTNET;

// ─── ERC-8004 Contract ──────────────────────────────────────────────────────

const ERC8004_ABI = [
  'function mint(address to, string memory name, string memory strategy, string memory metadataURI) external returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
];

// ─── Module State ───────────────────────────────────────────────────────────

let wallet: ethers.Wallet | null = null;
let provider: ethers.JsonRpcProvider | null = null;

interface RetryEntry {
  decision: Decision;
  attempts: number;
  lastAttempt: number;
}

const retryQueue: RetryEntry[] = [];
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 60_000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Decision {
  symbol: string;
  action: 'open' | 'close';
  entry: number;
  sl: number;
  tp: number;
  direction: 'long' | 'short';
  tradeId: string;
  aiConfidence?: number; // 0-10000, 0 = deterministic SMC, >0 = AI-scored
}

export interface NFTMetadata {
  name: string;
  strategy: string;
  metadataURI: string;
}

export interface AgentOnChainRecord {
  txHash: string;
  blockNumber: number;
  timestamp: string;
  decision: Decision | null;
}

// ─── Connection ─────────────────────────────────────────────────────────────

export function connectMantle(privateKey: string): ethers.Wallet {
  provider = new ethers.JsonRpcProvider(MANTLE.rpcUrl);
  wallet = new ethers.Wallet(privateKey, provider);
  console.log(`[Mantle] Connected to ${MANTLE.name} (chain ${MANTLE.chainId}) — ${wallet.address}`);
  return wallet;
}

export function initMantleFromEnv(): ethers.Wallet | null {
  try {
    const pk = process.env.MANTLE_PRIVATE_KEY;
    if (!pk || pk.trim().length < 64) {
      console.log('[Mantle] MANTLE_PRIVATE_KEY not set — skipping Mantle init.');
      return null;
    }
    return connectMantle(pk.trim());
  } catch (err) {
    console.error('[Mantle] initMantleFromEnv failed:', err);
    return null;
  }
}

export function isMantleConnected(): boolean {
  return wallet !== null && provider !== null;
}

export function getMantleAddress(): string | null {
  return wallet?.address ?? null;
}

// ─── Decision Encoding ──────────────────────────────────────────────────────
// We use AbiCoder to encode the decision struct, then send it as calldata in
// a 0-value self-transfer. The calldata IS the on-chain record — verifiable
// on any block explorer without needing a deployed contract.

const DECISION_SELECTOR = ethers.id(
  'logDecision((string,string,int256,int256,int256,string,string))',
).slice(0, 10); // first 4 bytes

function encodeDecision(decision: Decision): string {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const encoded = abi.encode(
    ['tuple(string,string,int256,int256,int256,string,string)'],
    [[
      decision.symbol,
      decision.action,
      Math.round(decision.entry * 1e8),   // store prices as integers to avoid float issues
      Math.round(decision.sl * 1e8),
      Math.round(decision.tp * 1e8),
      decision.direction,
      decision.tradeId,
    ]],
  );
  return DECISION_SELECTOR + encoded.slice(2);
}

function decodeDecision(hexData: string): Decision | null {
  try {
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const data = hexData.startsWith('0x') ? hexData : '0x' + hexData;
    const decoded = abi.decode(
      ['tuple(string,string,int256,int256,int256,string,string)'],
      '0x' + data.slice(10), // strip selector
    )[0];
    return {
      symbol: decoded[0],
      action: decoded[1] as 'open' | 'close',
      entry: Number(decoded[2]) / 1e8,
      sl: Number(decoded[3]) / 1e8,
      tp: Number(decoded[4]) / 1e8,
      direction: decoded[5] as 'long' | 'short',
      tradeId: decoded[6],
    };
  } catch {
    return null;
  }
}

// ─── Contract ABI (minimal — just logDecision + events) ─────────────────────

const REGISTRY_ABI = [
  'function logDecision(string,string,int256,int256,int256,string,uint256) external returns (uint256)',
  'function getDecisionCount() external view returns (uint256)',
  'function agent() external view returns (address)',
  'function getDecisionsPaginated(uint256,uint256) external view returns (tuple(string,string,int256,int256,int256,string,uint256,uint256)[], uint256)',
];

function getRegistryContract(): ethers.Contract | null {
  const addr = process.env.AGENT_TRADE_REGISTRY_ADDRESS;
  if (!addr || !wallet) return null;
  return new ethers.Contract(addr, REGISTRY_ABI, wallet);
}

// ─── Core: Log Decision On-Chain ────────────────────────────────────────────
// Uses the deployed AgentTradeRegistry contract if configured.
// Falls back to self-call calldata if no contract address set.

export async function logDecisionOnChain(decision: Decision): Promise<string | null> {
  if (!wallet || !provider) {
    console.warn('[Mantle] logDecisionOnChain skipped — wallet not connected.');
    return null;
  }

  const registry = getRegistryContract();

  if (registry) {
    // PREFERRED: call deployed contract — structured, verifiable, judge-ready
    try {
      const tx = await registry.logDecision(
        decision.symbol,
        decision.action,
        Math.round(decision.entry * 1e8),
        Math.round(decision.sl * 1e8),
        Math.round(decision.tp * 1e8),
        decision.direction,
        decision.aiConfidence ?? 0, // 0 = deterministic SMC, >0 = AI-scored
        { gasLimit: 300000n },
      );
      const receipt = await tx.wait();
      if (!receipt) throw new Error('Transaction receipt is null');
      console.log(
        `[Mantle] Decision logged via contract — tx: ${receipt.hash} — ${decision.action} ${decision.symbol} ${decision.direction}`,
      );
      return receipt.hash;
    } catch (err) {
      console.error('[Mantle] logDecisionOnChain (contract) failed:', err);
      retryQueue.push({ decision, attempts: 0, lastAttempt: Date.now() });
      return null;
    }
  }

  // FALLBACK: self-call with ABI-encoded calldata — works without contract
  try {
    const calldata = encodeDecision(decision);
    const tx = await wallet.sendTransaction({
      to: wallet.address,
      data: calldata,
      value: 0n,
      gasLimit: 100000n,
    });

    const receipt = await tx.wait();
    console.log(
      `[Mantle] Decision logged (self-call) — tx: ${receipt.hash} — ${decision.action} ${decision.symbol} ${decision.direction}`,
    );
    return receipt.hash;
  } catch (err) {
    console.error('[Mantle] logDecisionOnChain (self-call) failed:', err);
    retryQueue.push({ decision, attempts: 0, lastAttempt: Date.now() });
    return null;
  }
}

// ─── Fire-and-Forget ────────────────────────────────────────────────────────
// botEngine calls this — the Mantle write never blocks trade execution.

export async function fireAndForget(
  fn: () => Promise<any>,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[Mantle] fireAndForget [${label}] error:`, err);
  }
}

// ─── Retry Queue ────────────────────────────────────────────────────────────

export async function processRetryQueue(): Promise<number> {
  if (retryQueue.length === 0) return 0;

  const now = Date.now();
  let succeeded = 0;

  for (const entry of retryQueue) {
    if (entry.attempts >= MAX_RETRY_ATTEMPTS) continue;
    if (now - entry.lastAttempt < RETRY_INTERVAL_MS) continue;

    entry.attempts++;
    entry.lastAttempt = now;
    console.log(
      `[Mantle] Retry ${entry.attempts}/${MAX_RETRY_ATTEMPTS} — trade ${entry.decision.tradeId}`,
    );

    const txHash = await logDecisionOnChain(entry.decision);
    if (txHash) {
      succeeded++;
    }
  }

  // Clean up exhausted entries
  for (let i = retryQueue.length - 1; i >= 0; i--) {
    if (retryQueue[i].attempts >= MAX_RETRY_ATTEMPTS) {
      console.error(
        `[Mantle] Retries exhausted — trade ${retryQueue[i].decision.tradeId} dead-lettered.`,
      );
      retryQueue.splice(i, 1);
    }
  }

  return succeeded;
}

export function getRetryQueueStatus() {
  return {
    pending: retryQueue.length,
    entries: retryQueue.map((e) => ({
      tradeId: e.decision.tradeId,
      action: e.decision.action,
      symbol: e.decision.symbol,
      attempts: e.attempts,
      lastAttempt: new Date(e.lastAttempt).toISOString(),
    })),
  };
}

// ─── ERC-8004 NFT Minting ───────────────────────────────────────────────────

export async function mintAgentNFT(metadata: NFTMetadata): Promise<{ tokenId: string; txHash: string }> {
  const contractAddress =
    process.env.ERC8004_IDENTITY_REGISTRY ||
    process.env.ERC8004_CONTRACT_ADDRESS ||
    process.env.VITE_ERC8004_CONTRACT_ADDRESS ||
    ERC8004_IDENTITY_REGISTRY; // hardcoded fallback — official Mantle hackathon contract

  if (!contractAddress) {
    throw new Error('ERC-8004 contract address not configured.');
  }

  if (!wallet || !provider) {
    throw new Error('Mantle wallet not connected. Call initMantleFromEnv() first.');
  }

  const contract = new ethers.Contract(contractAddress, ERC8004_ABI, wallet);
  const tx = await contract.mint(
    wallet.address,
    metadata.name,
    metadata.strategy,
    metadata.metadataURI,
    { gasLimit: 300000n },
  );
  const receipt = await tx.wait();

  // ERC-8004 uses custom events — tokenId from on-chain state
  let tokenId = 'unknown';
  if (receipt.logs.length > 0) {
    const log = receipt.logs[0];
    if (log.topics.length >= 4) {
      tokenId = BigInt(log.topics[3]).toString();
    }
  }
  // Fallback: query balanceOf to confirm mint succeeded
  if (tokenId === 'unknown') {
    try {
      const count = await contract.balanceOf(wallet.address);
      tokenId = count > 0n ? `minted (balance: ${count})` : 'unknown';
    } catch {
      // ERC-8004 may not implement balanceOf — tx success is proof enough
      tokenId = `tx:${receipt.hash.slice(0, 10)}`;
    }
  }

  console.log(`[Mantle] NFT minted — tokenId: ${tokenId}, tx: ${receipt.hash}`);
  return { tokenId, txHash: receipt.hash };
}

// ─── On-Chain History ───────────────────────────────────────────────────────

export async function getAgentOnChainHistory(
  agentAddress: string,
  maxBlocks: number = 500,
): Promise<AgentOnChainRecord[]> {
  if (!provider) {
    console.warn('[Mantle] Provider not initialized — returning empty history.');
    return [];
  }

  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - maxBlocks);
    const results: AgentOnChainRecord[] = [];

    // Fetch blocks with concurrency limit of 10
    const CONCURRENCY = 10;
    for (let batchStart = fromBlock; batchStart <= currentBlock; batchStart += CONCURRENCY) {
      const batchEnd = Math.min(batchStart + CONCURRENCY - 1, currentBlock);
      const batch = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);

      const blocks = await Promise.all(
        batch.map((bn) => provider!.getBlock(bn, true).catch(() => null)),
      );

      for (const block of blocks) {
        if (!block) continue;
        for (const txHash of block.transactions) {
          const tx = block.getPrefetchedTransaction(txHash);
          if (!tx) continue;
          if (
            tx.from?.toLowerCase() !== agentAddress.toLowerCase() ||
            tx.to?.toLowerCase() !== agentAddress.toLowerCase() ||
            !tx.data.startsWith(DECISION_SELECTOR)
          ) continue;

          const decision = decodeDecision(tx.data);
          results.push({
            txHash: tx.hash,
            blockNumber: block.number,
            timestamp: new Date(block.timestamp * 1000).toISOString(),
            decision,
          });
        }
      }
    }

    return results.sort((a, b) => b.blockNumber - a.blockNumber);
  } catch (err) {
    console.error('[Mantle] getAgentOnChainHistory failed:', err);
    return [];
  }
}

// ─── On-Chain Performance ──────────────────────────────────────────────────
// Reads decisions from the contract to calculate per-symbol, per-direction
// metrics. Complements on-chain data with Supabase for win/loss (contract
// doesn't store exit_price). Cached for 5 min to avoid RPC spam on bot loop.

interface PerformanceCache {
  data: OnChainPerformance;
  timestamp: number;
}

let performanceCache: PerformanceCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface OnChainPerformance {
  overall: { totalDecisions: number; winRate: number | null; avgAIConfidence: number };
  bySymbol: Record<string, { decisions: number; winRate: number | null; avgAIConfidence: number }>;
  byDirection: { long: { decisions: number; winRate: number | null }; short: { decisions: number; winRate: number | null } };
}

export async function getOnChainPerformance(): Promise<OnChainPerformance | null> {
  // Return cached data if fresh
  if (performanceCache && Date.now() - performanceCache.timestamp < CACHE_TTL_MS) {
    return performanceCache.data;
  }

  try {
    const registry = getRegistryContract();
    if (!registry) return null;

    // Fetch decisions in batches of 50 from the contract
    const total: bigint = await registry.getDecisionCount();
    if (total === 0n) return null;

    const decisions: Array<{
      symbol: string; action: 'open' | 'close'; entry: number; direction: 'long' | 'short';
      aiConfidence: number; tradeId?: string;
    }> = [];

    const limit = 50n;
    for (let offset = 0n; offset < total; offset += limit) {
      const [batch] = await registry.getDecisionsPaginated(offset, limit);
      for (const d of batch) {
        decisions.push({
          symbol: d.symbol,
          action: d.action === 'open' ? 'open' : 'close',
          entry: Number(d.entry) / 1e8,
          direction: d.direction === 'long' ? 'long' : 'short',
          aiConfidence: Number(d.aiConfidence),
        });
      }
    }

    // Calculate per-symbol + per-direction aggregates from contract data
    const symStats: Record<string, { opens: number; closes: number; aiSum: number; aiCount: number; longs: number; shorts: number }> = {};
    const dirStats = { long: { opens: 0, closes: 0 }, short: { opens: 0, closes: 0 } };
    let totalAISum = 0;
    let totalAICount = 0;

    for (const d of decisions) {
      if (!symStats[d.symbol]) symStats[d.symbol] = { opens: 0, closes: 0, aiSum: 0, aiCount: 0, longs: 0, shorts: 0 };
      const ss = symStats[d.symbol];
      if (d.action === 'open') { ss.opens++; dirStats[d.direction].opens++; }
      else { ss.closes++; dirStats[d.direction].closes++; }
      if (d.direction === 'long') ss.longs++;
      else ss.shorts++;
      if (d.aiConfidence > 0) { ss.aiSum += d.aiConfidence; ss.aiCount++; totalAISum += d.aiConfidence; totalAICount++; }
    }

    // Note: true win/loss requires exit_price, which isn't stored on-chain.
    // The contract stores open entry price on both open AND close decisions.
    // Win rate is null when we can't calculate it from on-chain data alone.
    // See Supabase trades table for actual win/loss with R-multiple.

    const overall = {
      totalDecisions: decisions.length,
      winRate: null as number | null, // requires exit_price — use Supabase
      avgAIConfidence: totalAICount > 0 ? Math.round(totalAISum / totalAICount) : 0,
    };

    const bySymbol: Record<string, { decisions: number; winRate: number | null; avgAIConfidence: number }> = {};
    for (const [sym, ss] of Object.entries(symStats)) {
      bySymbol[sym] = {
        decisions: ss.opens + ss.closes,
        winRate: null, // requires exit_price
        avgAIConfidence: ss.aiCount > 0 ? Math.round(ss.aiSum / ss.aiCount) : 0,
      };
    }

    const byDirection = {
      long: { decisions: dirStats.long.opens + dirStats.long.closes, winRate: null as number | null },
      short: { decisions: dirStats.short.opens + dirStats.short.closes, winRate: null as number | null },
    };

    const result: OnChainPerformance = { overall, bySymbol, byDirection };
    performanceCache = { data: result, timestamp: Date.now() };
    return result;
  } catch (err) {
    console.error('[Mantle] getOnChainPerformance failed:', err);
    return null;
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

export function getMantleWalletInfo() {
  return {
    connected: isMantleConnected(),
    address: getMantleAddress(),
    network: MANTLE.name,
    chainId: MANTLE.chainId,
    isTestnet: MANTLE.chainId === MANTLE_TESTNET.chainId,
    rpcUrl: MANTLE.rpcUrl,
  };
}

export function getTxExplorerUrl(txHash: string): string {
  return `${MANTLE.explorerUrl}/tx/${txHash}`;
}
