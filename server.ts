import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import ccxt from "ccxt";
import crypto from "crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { startAllUserBots, refreshUserBots } from "./botEngine";
import { OHLCV } from "./src/lib/strategy";
import { runBacktest, runWalkForward } from "./src/lib/backtester";
import {
  initMantleFromEnv,
  connectMantle,
  isMantleConnected,
  getMantleAddress,
  getMantleWalletInfo,
  getAgentOnChainHistory,
  getRetryQueueStatus,
  mintAgentNFT,
} from './src/lib/mantle';

dotenv.config();

// ── Startup env validation ────────────────────────────────────────────────────
const REQUIRED_VARS  = ['SUPABASE_URL', 'SUPABASE_KEY'];
const OPTIONAL_VARS  = [
  'ANTHROPIC_API_KEY', 'BYBIT_API_KEY', 'BYBIT_API_SECRET',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'VITE_MASTER_PASSWORD',
  'ENCRYPTION_SECRET',
];
for (const v of REQUIRED_VARS) {
  if (!process.env[v]) console.error(`Server: CRITICAL — missing required env var: ${v}`);
}
for (const v of OPTIONAL_VARS) {
  if (!process.env[v]) console.warn(`Server: ⚠️  Optional env var not set: ${v}`);
}

// ── Encryption helpers ────────────────────────────────────────────────────────

function encryptApiKey(plaintext: string): string {
  const secret = process.env.ENCRYPTION_SECRET || 'fallback-change-this-in-production';
  const key = crypto.scryptSync(secret, 'signaldeck-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

async function getUserBySessionToken(token: string): Promise<{ user_id: string; username: string } | null> {
  if (!supabase || !token) return null;
  try {
    const { data } = await supabase
      .from('system_users')
      .select('user_id, username, session_expires_at')
      .eq('session_token', token)
      .maybeSingle();
    if (!data) return null;
    if (data.session_expires_at && new Date(data.session_expires_at).getTime() < Date.now()) return null;
    return { user_id: data.user_id, username: data.username };
  } catch {
    return null;
  }
}

function extractBearerToken(req: any): string | null {
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

function decryptApiKey(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) {
    // If it's the system user's seeded key or already decrypted
    return ciphertext;
  }
  const secret = process.env.ENCRYPTION_SECRET || 'fallback-change-this-in-production';
  const key = crypto.scryptSync(secret, 'signaldeck-salt', 32);
  const [ivHex, encryptedHex] = ciphertext.split(':');
  if (!ivHex || !encryptedHex) return ciphertext;
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ── Supabase (server-side, service role) ──────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY || "";

let supabase: any = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Server: Supabase client initialised (Service Role).");
  } catch (err) {
    console.error("Server: Failed to initialise Supabase client:", err);
  }
} else {
  console.warn("Server: Supabase credentials missing — some admin features will fail.");
}

// ── Claude (Anthropic) helper ─────────────────────────────────────────────────
async function callClaude(userPrompt: string, systemPrompt?: string): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your environment variables."
    );
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";

  const body: any = {
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: userPrompt }],
  };
  if (systemPrompt) body.system = systemPrompt;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "x-api-key":       anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.content
    .map((block: any) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

// ── OpenClaw system prompt ────────────────────────────────────────────────────
const OPENCLAW_SYSTEM_PROMPT = `You are OpenClaw — the command parser for SignalDeck, an SMC crypto trading bot dashboard.

Your job: convert the user's natural-language request into ONE structured command from the schema below. You do not execute anything yourself. You return JSON. The dashboard executes the command after the user confirms.

AVAILABLE COMMANDS:

Strategy config (writes — set requires_confirmation: true):
- set_symbols { symbols: string[] }
- set_rr { rr: number }                          range 1.0–5.0
- set_risk_percent { risk_percent: number }       range 0.1–10.0
- add_symbol { symbol: string }
- remove_symbol { symbol: string }
- set_max_concurrent { max: number }              range 1–10
- set_max_daily_loss { max_r: number }            range -10.0–-0.5

Status queries (reads — set requires_confirmation: false):
- get_win_rate { window?: '7d' | '30d' | 'all' }
- get_open_trades
- get_balance
- get_strategy_config

Autopilot / Screener:
- run_screener
- set_autopilot { enabled: boolean }
- set_autopilot_interval { interval_hours: number }

Meta:
- clarify { question: string }
- reject  { reason: string }

HARD RULES:
1. Output ONLY valid JSON. No markdown fences.
2. Symbols MUST be uppercase BASE/QUOTE (e.g. "BTC/USDT").
3. Numeric ranges are strict — outside-range gets a clarify.
4. The explanation field is shown verbatim to the user.

OUTPUT SHAPE:
{ "command": { "kind": "...", ...args }, "explanation": "...", "requires_confirmation": true|false }`;

const SETTINGS_ID   = '00000000-0000-0000-0000-000000000000';
const AUTOPILOT_ID  = '00000000-0000-0000-0000-000000000000';

function getEffectiveUserId(userIdStr?: string): string {
  const input = userIdStr || 'demo-user';
  if (input === 'demo-user' || input === 'demo') return SETTINGS_ID;
  // If it's not a UUID, return SETTINGS_ID as fallback to prevent SQL errors
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);
  return isUUID ? input : SETTINGS_ID;
}
const SCREENER_LOCK = { running: false };

const WRITE_KINDS = new Set([
  'set_symbols', 'set_rr', 'set_risk_percent', 'add_symbol', 'remove_symbol',
  'set_max_concurrent', 'set_max_daily_loss',
  'run_screener', 'set_autopilot', 'set_autopilot_interval',
]);

function validateCommand(cmd: any): { ok: boolean; error?: string } {
  if (!cmd || typeof cmd.kind !== 'string') return { ok: false, error: 'Malformed command.' };
  switch (cmd.kind) {
    case 'set_rr':
      if (typeof cmd.rr !== 'number' || cmd.rr < 1.0 || cmd.rr > 5.0)
        return { ok: false, error: 'RR must be between 1.0 and 5.0.' };
      return { ok: true };
    case 'set_risk_percent':
      if (typeof cmd.risk_percent !== 'number' || cmd.risk_percent < 0.1 || cmd.risk_percent > 10.0)
        return { ok: false, error: 'Risk % must be between 0.1 and 10.0.' };
      return { ok: true };
    case 'set_max_concurrent':
      if (typeof cmd.max !== 'number' || cmd.max < 1 || cmd.max > 10)
        return { ok: false, error: 'max_concurrent must be between 1 and 10.' };
      return { ok: true };
    case 'set_max_daily_loss':
      if (typeof cmd.max_r !== 'number' || cmd.max_r > -0.5 || cmd.max_r < -10)
        return { ok: false, error: 'max_daily_loss_r must be between -10 and -0.5.' };
      return { ok: true };
    case 'set_symbols':
      if (!Array.isArray(cmd.symbols) || !cmd.symbols.length)
        return { ok: false, error: 'Symbols must be a non-empty array.' };
      for (const s of cmd.symbols) {
        if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(s))
          return { ok: false, error: `Invalid symbol: ${s}` };
      }
      return { ok: true };
    case 'add_symbol':
    case 'remove_symbol':
      if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(cmd.symbol))
        return { ok: false, error: `Invalid symbol: ${cmd.symbol}` };
      return { ok: true };
    case 'set_autopilot':
      if (typeof cmd.enabled !== 'boolean') return { ok: false, error: 'enabled must be boolean.' };
      return { ok: true };
    case 'set_autopilot_interval':
      if (typeof cmd.interval_hours !== 'number' || cmd.interval_hours < 1 || cmd.interval_hours > 168)
        return { ok: false, error: 'interval_hours must be 1–168.' };
      return { ok: true };
    case 'run_screener':
    case 'get_win_rate':
    case 'get_open_trades':
    case 'get_balance':
    case 'get_strategy_config':
    case 'clarify':
    case 'reject':
      return { ok: true };
    default:
      return { ok: false, error: `Unknown command: ${cmd.kind}` };
  }
}

async function logOpenClawAction(message: string, type = 'info') {
  if (!supabase) return;
  try {
    await supabase.from('bot_execution_logs').insert({
      user_id: SETTINGS_ID,
      message: `[OpenClaw] ${message}`, type, created_at: new Date().toISOString(),
    });
  } catch {}
}

async function getTelegramConfig(): Promise<{ token: string; chatId: string } | null> {
  if (supabase) {
    try {
      const { data } = await supabase
        .from('telegram_config')
        .select('bot_token_enc, chat_id')
        .eq('id', 'singleton')
        .maybeSingle();
      if (data?.bot_token_enc && data?.chat_id) {
        return { token: decryptApiKey(data.bot_token_enc), chatId: data.chat_id };
      }
    } catch {}
  }
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (token && chatId) return { token, chatId };
  return null;
}

async function notifyTelegram(message: string) {
  const cfg = await getTelegramConfig();
  if (!cfg) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text: `🦾 *OpenClaw*\n${message}`, parse_mode: 'Markdown' }),
    });
  } catch {}
}

// ── Screener helpers ──────────────────────────────────────────────────────────

async function discoverTopVolumeSymbols(exchange: any, limit = 20): Promise<string[]> {
  if (!exchange.markets) await exchange.loadMarkets();
  const tickers = await exchange.fetchTickers();
  const ranked = Object.entries(tickers)
    .map(([symbol, t]: [string, any]) => {
      const market = exchange.markets[symbol];
      if (!market || market.quote !== 'USDT' || market.active === false) return null;
      const isSwapMode = exchange.options?.['defaultType'] === 'swap' || exchange.options?.['defaultType'] === 'future';
      if (isSwapMode && market.type !== 'swap') return null;
      if (!isSwapMode && market.type !== 'spot') return null;
      const vol = Number(t?.quoteVolume) || 0;
      return vol > 0 ? { symbol, quoteVolume: vol } : null;
    })
    .filter(Boolean) as { symbol: string; quoteVolume: number }[];
  return ranked.sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, limit).map(r => r.symbol);
}

async function fetchOHLCVForBacktest(exchange: any, symbol: string, timeframe: string, targetLimit: number): Promise<any[]> {
  const tfSeconds = exchange.parseTimeframe(timeframe);
  let allOhlcv: any[] = [];
  const batchLimit = 1000;
  let batch = await exchange.fetchOHLCV(symbol, timeframe, undefined, batchLimit);
  allOhlcv = [...batch];
  while (allOhlcv.length < targetLimit && batch.length > 0) {
    const firstTs   = allOhlcv[0][0];
    const fetchCount = Math.min(targetLimit - allOhlcv.length, batchLimit);
    const since      = firstTs - fetchCount * tfSeconds * 1000;
    batch = await exchange.fetchOHLCV(symbol, timeframe, since, fetchCount);
    if (!batch.length) break;
    const filtered = batch.filter((c: any) => c[0] < firstTs);
    if (!filtered.length) break;
    allOhlcv = [...filtered, ...allOhlcv];
    if (allOhlcv.length >= 100000) break;
  }
  return allOhlcv.sort((a, b) => a[0] - b[0]).slice(-targetLimit)
    .map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
}

async function runScreenerFull(exchange: any, candidates: string[], bars: number, rr: number, riskPercent: number) {
  const results: any[] = [];
  for (const symbol of candidates) {
    try {
      const ohlcv = await fetchOHLCVForBacktest(exchange, symbol, '5m', bars);
      if (ohlcv.length < 500) { results.push({ symbol, net_r: 0, win_rate: 0, profit_factor: 0, total_trades: 0, bars: ohlcv.length, error: 'insufficient_data' }); continue; }
      const bt       = runBacktest(ohlcv, { rr, riskPercent, allowedDirections: ['long', 'short'] });
      const riskAmt  = 10000 * (riskPercent / 100);
      const netR     = bt.trades.reduce((acc, t) => acc + t.pnl / riskAmt, 0);
      results.push({ symbol, net_r: +netR.toFixed(2), win_rate: +bt.winRate.toFixed(1), profit_factor: +bt.profitFactor.toFixed(2), total_trades: bt.totalTrades, bars: ohlcv.length });
    } catch (e: any) {
      results.push({ symbol, net_r: 0, win_rate: 0, profit_factor: 0, total_trades: 0, bars: 0, error: e.message });
    }
  }
  return results.sort((a, b) => (a.total_trades === 0 ? 1 : b.total_trades === 0 ? -1 : b.net_r - a.net_r));
}

async function executeScreenerRun(exchange: any, source: 'manual' | 'autopilot', userIdRequested?: string) {
  if (!supabase) throw new Error('Supabase not configured.');
  const actualUserId = getEffectiveUserId(userIdRequested);
  const { data: settings } = await supabase.from('bot_settings').select('*').eq('user_id', actualUserId).limit(1).maybeSingle();
  const { data: autopilot } = await supabase.from('openclaw_autopilot').select('*').eq('id', AUTOPILOT_ID).maybeSingle();

  const poolSize    = autopilot?.candidate_pool_size || 20;
  const bars        = autopilot?.backtest_bars       || 5000;
  const rr          = settings?.rr                  || 2.0;
  const riskPercent = settings?.risk_percent         || 1.0;
  const currentSymbols: string[] = settings?.symbols || [];

  await logOpenClawAction(`SCREENER START source=${source} user=${actualUserId} pool=${poolSize} bars=${bars}`);

  const candidates = await discoverTopVolumeSymbols(exchange, poolSize);
  if (!candidates.length) throw new Error('Could not discover candidates.');

  const ranked = await runScreenerFull(exchange, candidates, bars, rr, riskPercent);
  const top3   = ranked.slice(0, 3).map(r => r.symbol);

  const isNoChange = [...currentSymbols].sort().join(',') === [...top3].sort().join(',');

  await supabase.from('openclaw_recommendations')
    .update({ status: 'superseded', resolved_at: new Date().toISOString() })
    .eq('status', 'pending');

  const { data: rec, error: recErr } = await supabase.from('openclaw_recommendations').insert({
    source, ranked_symbols: ranked, proposed_top_3: top3, current_symbols: currentSymbols,
    status: isNoChange ? 'superseded' : 'pending',
    notes:  isNoChange ? 'No change — top 3 matches current watchlist.' : null,
  }).select().maybeSingle();
  if (recErr) throw recErr;

  await supabase.from('openclaw_autopilot').update({
    last_run_at:      new Date().toISOString(),
    last_run_status:  isNoChange ? 'no_change' : 'recommendation_pending',
    last_run_message: isNoChange ? 'Top 3 unchanged.' : `New top 3: ${top3.join(', ')}`,
  }).eq('id', AUTOPILOT_ID);

  if (!isNoChange) {
    const block = ranked.slice(0, 3).map((r, i) =>
      `${i + 1}. *${r.symbol}* — ${r.net_r >= 0 ? '+' : ''}${r.net_r}R · ${r.win_rate}% WR · PF ${r.profit_factor} · ${r.total_trades}t`
    ).join('\n');
    await notifyTelegram(`📊 *Screener (${source})*\n\nProposed top 3:\n${block}\n\nCurrent: ${currentSymbols.join(', ') || '(none)'}\n\nApprove in OpenClaw.`);
  }

  await logOpenClawAction(`SCREENER DONE top3=${top3.join('/')} ${isNoChange ? '(no change)' : '(pending)'}`, 'accept');
  return { recommendation_id: rec.id, source, ranked, proposed_top_3: top3, current_symbols: currentSymbols, is_no_change: isNoChange };
}

// ── Server ────────────────────────────────────────────────────────────────────

async function startServer() {
  const app  = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // ── Logging Middleware ───────────────────────────────────────────────────────
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (res.statusCode >= 400 || req.url.startsWith('/api')) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
      }
    });
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  let vite: any = null;
  if (process.env.NODE_ENV !== "production") {
    vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    console.log("Server: Vite dev server initialised.");
  }

  // Note: Vite middleware and SPA fallback moved to the end of the route definitions

  // Exchange setup
  const apiKey      = process.env.BYBIT_API_KEY?.trim();
  const apiSecret   = process.env.BYBIT_API_SECRET?.trim();
  const isTestnet   = process.env.BYBIT_TESTNET?.trim().toLowerCase() === 'true';
  const exchangeConfig: any = {
    enableRateLimit: true, timeout: 10000,
    apiKey: apiKey || undefined, secret: apiSecret || undefined,
    options: { defaultType: process.env.BYBIT_DEFAULT_TYPE || 'spot' },
  };
  if (process.env.BYBIT_HOSTNAME) exchangeConfig.hostname = process.env.BYBIT_HOSTNAME.trim();
  let exchange = new ccxt.bybit(exchangeConfig);
  if (isTestnet) exchange.setSandboxMode(true);

  const initMarkets = async () => {
    try {
      await exchange.loadMarkets();
      console.log(`Server: Bybit markets loaded.`);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('10003') || msg.includes('10004') || msg.includes('API key is invalid') || msg.includes('AuthenticationError')) {
        console.warn("Server: Default Bybit keys invalid or expired — switching to a clean public instance.");
        
        try {
          // Re-instantiate a clean public exchange
          const publicConfig: any = {
            enableRateLimit: true,
            timeout: 10000,
            options: { defaultType: process.env.BYBIT_DEFAULT_TYPE || 'spot' },
          };
          if (process.env.BYBIT_HOSTNAME) publicConfig.hostname = process.env.BYBIT_HOSTNAME.trim();
          
          const publicExchange = new ccxt.bybit(publicConfig);
          if (isTestnet) publicExchange.setSandboxMode(true);
          
          await publicExchange.loadMarkets();
          exchange = publicExchange; // Reassign global exchange to the public one
          console.log("Server: Markets loaded successfully in public mode using fresh instance.");
        } catch (retryErr: any) {
          console.error("Server: Failed to load markets even in public mode:", retryErr.message);
        }
      } else {
        console.warn("Server: Market load warning:", err.message);
      }
    }
  };

  // ── Existing API routes ───────────────────────────────────────────────────

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", exchange: exchange.id, marketsLoaded: !!exchange.markets });
  });

  app.get("/api/ping", (req, res) => {
    console.log(`[ping] Received request`);
    res.json({ pong: true, timestamp: new Date().toISOString() });
  });

  app.get("/api/auth/status", async (req, res) => {
    if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
    try {
      const { data, error } = await supabase
        .from('system_users')
        .select('username')
        .eq('user_id', SYSTEM_USER_ID)
        .maybeSingle();
      if (error) throw new Error(error.message);
      res.json({ initialized: !!data, username: data?.username || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/setup", express.json(), async (req, res) => {
    if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required." });
    if (String(username).length < 3) return res.status(400).json({ error: "Username must be at least 3 characters." });
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    try {
      const { data: existing } = await supabase
        .from('system_users')
        .select('user_id')
        .eq('user_id', SYSTEM_USER_ID)
        .maybeSingle();
      if (existing) return res.status(409).json({ error: "Account already exists. Use login." });

      const token = generateSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const { error } = await supabase
        .from('system_users')
        .insert({
          user_id: SYSTEM_USER_ID,
          username: String(username).trim(),
          password_hash: hashPassword(String(password)),
          session_token: token,
          session_expires_at: expiresAt,
        });
      if (error) throw new Error(error.message);
      res.json({ token, user_id: SYSTEM_USER_ID, username: String(username).trim() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/login", express.json(), async (req, res) => {
    if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required." });
    try {
      const { data, error } = await supabase
        .from('system_users')
        .select('user_id, username, password_hash')
        .eq('username', String(username).trim())
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data || !verifyPassword(String(password), data.password_hash)) {
        return res.status(401).json({ error: "Invalid username or password." });
      }
      const token = generateSessionToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const { error: updateError } = await supabase
        .from('system_users')
        .update({
          session_token: token,
          session_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', data.user_id);
      if (updateError) throw new Error(updateError.message);
      res.json({ token, user_id: data.user_id, username: data.username });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const token = extractBearerToken(req);
    if (!supabase || !token) return res.status(204).end();
    try {
      await supabase
        .from('system_users')
        .update({ session_token: null, session_expires_at: null })
        .eq('session_token', token);
    } catch {}
    res.status(204).end();
  });

  app.get("/api/auth/me", async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "No session" });
    const user = await getUserBySessionToken(token);
    if (!user) return res.status(401).json({ error: "Session invalid or expired" });
    res.json(user);
  });

  // Helper to get a user-specific exchange instance
  async function getUserExchange(userId: string) {
    const actualUserId = getEffectiveUserId(userId);

    let userApiKey: string | undefined;
    let userApiSecret: string | undefined;
    let userIsTestnet = isTestnet;
    let userAccountType = process.env.BYBIT_DEFAULT_TYPE || 'spot';

    if (supabase) {
      const { data: keyRecord } = await supabase
        .from('user_api_keys')
        .select('*')
        .eq('user_id', actualUserId)
        .eq('is_active', true)
        .maybeSingle();

      if (keyRecord) {
        try {
          const decKey = decryptApiKey(keyRecord.bybit_api_key_enc);
          const decSec = decryptApiKey(keyRecord.bybit_api_secret_enc);
          
          if (decKey === 'system' || decSec === 'system') {
             userApiKey = apiKey;
             userApiSecret = apiSecret;
          } else {
             userApiKey      = decKey;
             userApiSecret   = decSec;
          }
          userIsTestnet   = keyRecord.bybit_testnet;
          userAccountType = keyRecord.account_type || 'swap';
        } catch (err) {
          console.error(`Helper: Failed to decrypt keys for ${userId}:`, err);
          userApiKey = apiKey;
          userApiSecret = apiSecret;
        }
      } else {
        userApiKey    = apiKey;
        userApiSecret = apiSecret;
      }
    } else {
      console.warn("getUserExchange: Supabase not available, using environment fallback.");
      userApiKey    = apiKey;
      userApiSecret = apiSecret;
    }

    if (!userApiKey || !userApiSecret) return null;

    const ex = new ccxt.bybit({
      apiKey: userApiKey,
      secret: userApiSecret,
      enableRateLimit: true,
      timeout: 15000,
      options: { defaultType: userAccountType }
    });
    if (userIsTestnet) ex.setSandboxMode(true);
    if (process.env.BYBIT_HOSTNAME) ex.hostname = process.env.BYBIT_HOSTNAME.trim();
    
    // Pre-load markets if not already loaded to avoid repeat calls on same instance
    // (though for temp instances we do it once anyway)
    return { ex, isTestnet: userIsTestnet, accountType: userAccountType };
  }

  app.get("/api/balance", async (req, res) => {
    try {
      const userId = (req.headers['x-user-id'] as string) || 'demo-user';
      const userExObj = await getUserExchange(userId);
      
      if (!userExObj) {
        return res.status(401).json({ error: "API Keys missing. Connect your Bybit account in Settings." });
      }

      const { ex, isTestnet: uTestnet, accountType: uAccountType } = userExObj;

      const balance = await Promise.race([
        ex.fetchBalance(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)),
      ]) as any;

      const v5Equity = balance.info?.result?.list?.[0]?.totalEquity || balance.info?.list?.[0]?.totalEquity;
      res.json({ 
        total: balance.total, 
        free: balance.free, 
        equity: v5Equity || balance.total?.USDT || 0, 
        isTestnet: uTestnet, 
        accountType: uAccountType 
      });
    } catch (error: any) {
      if (error.message.includes('timed out') || error.message === 'Timeout') return res.status(504).json({ error: "Timeout" });
      if (error.message.includes('10003') || error.message.includes('10004')) return res.status(401).json({ error: "Invalid API Key - please check your keys in the API Keys page." });
      console.error("[balance] error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ── Auth middleware ──────────────────────────────────────────────────────
  async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'No session token' });
    const user = await getUserBySessionToken(token);
    if (!user) return res.status(401).json({ error: 'Session invalid or expired' });
    (req as any).user = user;
    next();
  }

  // ── Mantle Routes ──────────────────────────────────────────────────────

  // GET /api/mantle/status — wallet, NFT, retry queue overview
  app.get('/api/mantle/status', requireAuth, async (req, res) => {
    try {
      const walletInfo = getMantleWalletInfo();
      const retryStatus = getRetryQueueStatus();

      let nftStatus: any = null;
      if (supabase && walletInfo.address) {
        const { data } = await supabase
          .from('agent_identity')
          .select('*')
          .eq('wallet_address', walletInfo.address)
          .maybeSingle();
        nftStatus = data ?? null;
      }

      res.json({
        wallet: walletInfo,
        nft: nftStatus
          ? { minted: true, tokenId: nftStatus.token_id, txHash: nftStatus.mint_tx_hash }
          : { minted: false },
        retryQueue: retryStatus,
      });
    } catch (err: any) {
      console.error('[mantle:status]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/mantle/connect — connect wallet with private key (NEVER logged)
  app.post('/api/mantle/connect', requireAuth, express.json(), async (req, res) => {
    try {
      const { privateKey } = req.body || {};
      if (!privateKey || typeof privateKey !== 'string' || privateKey.trim().length < 64) {
        return res.status(400).json({ error: 'Valid private key required (64+ hex chars).' });
      }

      const wallet = connectMantle(privateKey.trim());

      if (supabase) {
        const address = wallet.address;
        await supabase.from('mantle_config').upsert({
          id: '00000000-0000-0000-0000-000000000002',
          wallet_address: address,
          is_connected: true,
          network: 'mantle',
          chain_id: null,
          is_testnet: process.env.MANTLE_MAINNET !== 'true',
          last_connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      console.log(`[mantle:connect] Wallet connected: ${wallet.address}`);
      res.json({ connected: true, address: wallet.address });
    } catch (err: any) {
      console.error('[mantle:connect]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/mantle/mint-nft — mint ERC-8004 agent identity NFT
  app.post('/api/mantle/mint-nft', requireAuth, express.json(), async (req, res) => {
    try {
      if (!isMantleConnected()) {
        return res.status(400).json({ error: 'Wallet not connected. POST /api/mantle/connect first.' });
      }

      const { name, strategy, metadataURI } = req.body || {};
      if (!name || !strategy) {
        return res.status(400).json({ error: 'name and strategy are required.' });
      }

      const result = await mintAgentNFT({
        name: String(name).trim(),
        strategy: String(strategy).trim(),
        metadataURI: String(metadataURI || 'https://signaldeck.vercel.app/api/agent/metadata'),
      });

      const address = getMantleAddress();
      if (supabase && address) {
        await supabase.from('agent_identity').upsert({
          wallet_address: address,
          token_id: result.tokenId,
          nft_name: String(name).trim(),
          strategy: String(strategy).trim(),
          network: 'mantle',
          chain_id: process.env.MANTLE_MAINNET === 'true' ? 5000 : 5001,
          mint_tx_hash: result.txHash,
          minted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'wallet_address' });
      }

      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[mantle:mint-nft]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/mantle/history — agent on-chain decision history
  app.get('/api/mantle/history', requireAuth, async (req, res) => {
    try {
      const address = getMantleAddress();
      if (!address) {
        return res.status(400).json({ error: 'Wallet not connected.' });
      }

      const maxBlocks = Math.min(
        5000,
        Math.max(10, parseInt(String(req.query.maxBlocks || '500'), 10) || 500),
      );

      const history = await getAgentOnChainHistory(address, maxBlocks);
      res.json({ address, count: history.length, history });
    } catch (err: any) {
      console.error('[mantle:history]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/mantle/retry-queue — retry queue status
  app.get('/api/mantle/retry-queue', requireAuth, async (req, res) => {
    try {
      const status = getRetryQueueStatus();
      res.json(status);
    } catch (err: any) {
      console.error('[mantle:retry-queue]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/prices", async (req, res) => {
    try {
      const symbolsStr = req.query.symbols as string;
      if (!symbolsStr) return res.json({});
      const symbols = symbolsStr.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
      
      const userId = (req.headers['x-user-id'] as string) || 'demo-user';
      const userExObj = await getUserExchange(userId);
      
      // Use user-specific exchange if available, otherwise fallback to global
      const ex = userExObj?.ex || exchange;

      if (!ex.markets) {
        console.log(`[prices] Loading markets...`);
        await ex.loadMarkets();
      }

      // Use user's actual account type, not the global env var
      const accountType = userExObj?.accountType || process.env.BYBIT_DEFAULT_TYPE || 'spot';
      const isSwapMode = ['swap', 'future'].includes(accountType);

      const symbolMap: Record<string, string> = {};
      for (const s of symbols) {
        // 1. Direct match
        if (ex.markets[s]) { symbolMap[s] = s; continue; }

        // 2. Spot symbol + swap mode → try swap suffix variants
        if (isSwapMode && s.includes('/') && !s.includes(':')) {
          const [base, quote] = s.split('/');
          const swapKey = `${s}:${quote}`;
          if (ex.markets[swapKey]) { symbolMap[s] = swapKey; continue; }
          if (ex.markets[`${base}/${quote}:USDT`]) { symbolMap[s] = `${base}/${quote}:USDT`; continue; }
          // Also try perpetual suffix
          if (ex.markets[`${base}/${quote}:USDT- perpetual`] || ex.markets[`${s}:USDT-PERP`]) {
            const perpKey = Object.keys(ex.markets).find(k =>
              k.startsWith(`${base}/${quote}:`) && ex.markets[k]?.type === 'swap'
            );
            if (perpKey) { symbolMap[s] = perpKey; continue; }
          }
        }

        // 3. Swap symbol in spot mode → strip suffix
        if (!isSwapMode && s.includes(':')) {
          const basePart = s.split(':')[0];
          if (ex.markets[basePart]) { symbolMap[s] = basePart; continue; }
        }

        // 4. Swap mode: already has colon → check if it exists as-is
        if (s.includes(':') && ex.markets[s]) {
          symbolMap[s] = s; continue;
        }

        // 5. Last resort: fuzzy match by base symbol
        if (s.includes('/')) {
          const base = s.split('/')[0];
          const fuzzy = Object.keys(ex.markets).find(k =>
            k.startsWith(`${base}/`) && ex.markets[k]?.active !== false
          );
          if (fuzzy) {
            console.warn(`[prices] Fuzzy match: ${s} → ${fuzzy}`);
            symbolMap[s] = fuzzy;
          } else {
            console.warn(`[prices] Symbol not found in markets: ${s}`);
          }
        } else {
          console.warn(`[prices] Symbol not found in markets: ${s}`);
        }
      }

      const ccxtSymbols = [...new Set(Object.values(symbolMap))];
      if (!ccxtSymbols.length) return res.json({});

      const groups: Record<string, string[]> = {};
      ccxtSymbols.forEach(s => {
        const m = ex.markets[s];
        const type = m?.type || 'spot';
        if (!groups[type]) groups[type] = [];
        groups[type].push(s);
      });

      const priceMap: Record<string, number> = {};
      const CHUNK = 50;

      for (const [type, typeSymbols] of Object.entries(groups)) {
        for (let i = 0; i < typeSymbols.length; i += CHUNK) {
          const chunk = typeSymbols.slice(i, i + CHUNK);
          try {
            let tickers;
            try {
              tickers = await ex.fetchTickers(chunk);
            } catch (innerErr: any) {
              if (innerErr.message.includes('10003') || innerErr.message.includes('API key is invalid')) {
                console.warn("[prices] Invalid API key. Retrying using public fallback...");
                tickers = await exchange.fetchTickers(chunk);
              } else {
                throw innerErr;
              }
            }
            
            for (const [reqSym, ccxtSym] of Object.entries(symbolMap)) {
              if (chunk.includes(ccxtSym)) {
                const ticker = tickers[ccxtSym];
                const price = ticker?.last ?? ticker?.close ?? ticker?.info?.lastPrice ?? ticker?.info?.p ?? null;
                if (price !== null && price !== undefined && !isNaN(Number(price))) {
                  priceMap[reqSym] = Number(price);
                }
              }
            }
          } catch (err: any) {
            console.error(`[prices] fetchTickers failed for ${type} chunk:`, err.message);
          }
        }
      }

      res.json(priceMap);
    } catch (error: any) {
      console.error(`[prices] error:`, error.message);
      res.status(503).json({ error: error.message });
    }
  });

  app.get("/api/ohlcv", async (req, res) => {
    try {
      const { symbol: rawSymbol, timeframe = "5m", limit = "100" } = req.query;
      if (!rawSymbol) return res.status(400).json({ error: "Symbol required" });
      let symbol = (rawSymbol as string).toUpperCase();
      
      const userId = (req.headers['x-user-id'] as string) || 'demo-user';
      const userExObj = await getUserExchange(userId);
      const ex = userExObj?.ex || exchange;

      if (!ex.markets) await ex.loadMarkets();
      const isSwapMode = ['swap', 'future'].includes(userExObj?.accountType || process.env.BYBIT_DEFAULT_TYPE || '');
      if (isSwapMode && (!ex.markets[symbol] || ex.markets[symbol].type === 'spot')) {
        const sw = `${symbol}:${symbol.split('/')[1] || 'USDT'}`;
        if (ex.markets[sw]) symbol = sw;
      }
      let formatted;
      try {
        formatted = await fetchOHLCVForBacktest(ex, symbol, timeframe as string, Math.min(100000, parseInt(limit as string)));
      } catch (innerErr: any) {
        if (innerErr.message.includes('10003') || innerErr.message.includes('API key is invalid')) {
          console.warn("[ohlcv] Invalid API key detected. Retrying with public fallback...");
          formatted = await fetchOHLCVForBacktest(exchange, symbol, timeframe as string, Math.min(100000, parseInt(limit as string)));
        } else {
          throw innerErr;
        }
      }
      res.json(formatted);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/walkforward", express.json({ limit: "5mb" }), async (req, res) => {
    try {
      const { symbol, timeframe = '5m', limit = 5000, options = {}, numWindows = 5 } = req.body;
      if (!symbol) return res.status(400).json({ error: "symbol required" });
      const ohlcv = await fetchOHLCVForBacktest(exchange, symbol, timeframe, limit);
      if (ohlcv.length < 1000) return res.status(400).json({ error: "Insufficient data for walk-forward (need 1000+ bars)" });
      const result = runWalkForward(ohlcv, options, numWindows);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/db-debug", (req, res) => {
    res.json({ supabaseUrl: !!process.env.SUPABASE_URL, supabaseKey: !!process.env.SUPABASE_KEY });
  });

  app.post("/api/admin/bulk-delete", async (req, res) => {
    try {
      const { ids, table = 'trades' } = req.body;
      if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: "Array of IDs required" });
      const { error } = await supabase.from(table).delete().in('id', ids);
      if (error) throw error;
      res.json({ success: true, count: ids.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/test-telegram", async (req, res) => {
    const cfg = await getTelegramConfig();
    if (!cfg) return res.status(400).json({ success: false, error: "Telegram not configured. Add bot token + chat ID in Settings." });
    try {
      const r = await (await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.chatId, text: "✅ SignalDeck test message" }),
      })).json();
      res.json({ success: r.ok, details: r.description });
    } catch (err: any) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get("/api/telegram-config", async (req, res) => {
    if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
    try {
      const { data, error } = await supabase
        .from('telegram_config')
        .select('chat_id, updated_at, bot_token_enc')
        .eq('id', 'singleton')
        .maybeSingle();
      if (error) throw new Error(error.message);
      res.json({
        configured: !!(data?.bot_token_enc && data?.chat_id),
        chat_id: data?.chat_id || '',
        updated_at: data?.updated_at || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/telegram-config", express.json(), async (req, res) => {
    if (!supabase) return res.status(503).json({ error: "Supabase not configured" });
    const { botToken, chatId } = req.body || {};
    if (!botToken || !chatId) return res.status(400).json({ error: "Both botToken and chatId are required." });
    try {
      const encrypted = encryptApiKey(String(botToken).trim());
      const { error } = await supabase
        .from('telegram_config')
        .upsert({
          id: 'singleton',
          bot_token_enc: encrypted,
          chat_id: String(chatId).trim(),
          updated_at: new Date().toISOString(),
        });
      if (error) throw new Error(error.message);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ai-analyst", express.json({ limit: "50mb" }), async (req, res) => {
    try {
      const { prompt, systemInstruction } = req.body;
      if (!prompt) return res.status(400).json({ error: "No prompt provided." });
      const text = await callClaude(prompt, systemInstruction);
      res.json({ text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai-admin", express.json({ limit: "10mb" }), async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: "No prompt provided." });
      const text = await callClaude(prompt, "You are a trading database auditor. Always respond with valid JSON only — no markdown fences, no explanation outside the JSON object.");
      res.json({ text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── OpenClaw routes ───────────────────────────────────────────────────────

  app.post('/api/openclaw/parse', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const { input } = req.body;
      if (!input || typeof input !== 'string' || input.length > 500)
        return res.status(400).json({ error: 'Provide input string under 500 chars.' });
      const text = await callClaude(input, OPENCLAW_SYSTEM_PROMPT);
      let parsed: any;
      try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); }
      catch { return res.status(500).json({ error: 'OpenClaw returned malformed JSON.' }); }
      const validation = validateCommand(parsed.command);
      if (!validation.ok) return res.status(400).json({ error: validation.error, raw: parsed });
      parsed.requires_confirmation = WRITE_KINDS.has(parsed.command.kind);
      await logOpenClawAction(`PARSE "${input}" → ${parsed.command.kind}`);
      res.json(parsed);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/openclaw/execute', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const { command } = req.body;
      const userId = (req.headers['x-user-id'] as string) || 'demo-user';
      const actualUserId = getEffectiveUserId(userId);

      const validation = validateCommand(command);
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      if (!supabase) return res.status(503).json({ error: 'Supabase not configured.' });

      let result: any = null;
      switch (command.kind) {
        case 'get_strategy_config': {
          const { data, error } = await supabase.from('bot_settings').select('*').eq('user_id', actualUserId).limit(1).maybeSingle();
          if (error) throw error;
          result = { symbols: data?.symbols || [], rr: data?.rr, risk_percent: data?.risk_percent, paper_trading: data?.paper_trading, paused: data?.paused, max_concurrent_trades: data?.max_concurrent_trades, max_daily_loss_r: data?.max_daily_loss_r };
          break;
        }
        case 'get_win_rate': {
          const window = command.window || '30d';
          const cutoff = window === 'all' ? new Date(0) : new Date(Date.now() - (window === '7d' ? 7 : 30) * 86400000);
          const { data, error } = await supabase.from('trades').select('r').eq('user_id', actualUserId).eq('status', 'closed').gte('closed_at', cutoff.toISOString());
          if (error) throw error;
          const ts = data || [], wins = ts.filter((t: any) => (t.r || 0) > 0).length;
          result = { window, total_trades: ts.length, wins, losses: ts.length - wins, win_rate_pct: ts.length > 0 ? +((wins / ts.length) * 100).toFixed(1) : 0, net_r: +ts.reduce((a: number, t: any) => a + (t.r || 0), 0).toFixed(2) };
          break;
        }
        case 'get_open_trades': {
          const { data, error } = await supabase.from('trades').select('*').eq('user_id', actualUserId).eq('status', 'open').order('opened_at', { ascending: false });
          if (error) throw error;
          result = { count: data?.length || 0, trades: (data || []).map((t: any) => ({ symbol: t.symbol, direction: t.direction, entry: t.entry, sl: t.sl, tp: t.tp, be_armed: t.be_armed, is_paper: t.is_paper, opened_at: t.opened_at })) };
          break;
        }
        case 'get_balance': {
          try {
            const userExObj = await getUserExchange(userId);
            if (!userExObj) {
              result = { error: 'API keys missing.', detail: 'Connect your Bybit account in Settings.' };
            } else {
              const { ex, isTestnet: uTestnet, accountType: uAccountType } = userExObj;
              const balance: any = await ex.fetchBalance();
              const v5Equity = balance.info?.result?.list?.[0]?.totalEquity || balance.info?.list?.[0]?.totalEquity;
              result = { equity: Number(v5Equity) || balance.total?.USDT || 0, is_testnet: uTestnet, account_type: uAccountType };
            }
          } catch (e: any) { result = { error: 'Could not fetch balance.', detail: e.message }; }
          break;
        }
        case 'set_rr': {
          await supabase.from('bot_settings').update({ rr: command.rr, updated_at: new Date().toISOString() }).eq('user_id', actualUserId);
          result = { applied: true, rr: command.rr };
          await notifyTelegram(`RR target set to *${command.rr}*`);
          break;
        }
        case 'set_risk_percent': {
          await supabase.from('bot_settings').update({ risk_percent: command.risk_percent, updated_at: new Date().toISOString() }).eq('user_id', actualUserId);
          result = { applied: true, risk_percent: command.risk_percent };
          await notifyTelegram(`Risk per trade set to *${command.risk_percent}%*`);
          break;
        }
        case 'set_max_concurrent': {
          await supabase.from('bot_settings').update({ max_concurrent_trades: command.max, updated_at: new Date().toISOString() }).eq('user_id', actualUserId);
          result = { applied: true, max_concurrent_trades: command.max };
          await notifyTelegram(`Max concurrent trades set to *${command.max}*`);
          break;
        }
        case 'set_max_daily_loss': {
          await supabase.from('bot_settings').update({ max_daily_loss_r: command.max_r, updated_at: new Date().toISOString() }).eq('user_id', actualUserId);
          result = { applied: true, max_daily_loss_r: command.max_r };
          await notifyTelegram(`Daily loss limit set to *${command.max_r}R*`);
          break;
        }
        case 'set_symbols': {
          await supabase.from('bot_settings').update({ symbols: command.symbols, updated_at: new Date().toISOString() }).eq('user_id', actualUserId);
          result = { applied: true, symbols: command.symbols };
          await notifyTelegram(`Watchlist → *${command.symbols.join(', ')}*`);
          break;
        }
        case 'add_symbol': {
          const { data: cur } = await supabase.from('bot_settings').select('symbols').eq('user_id', actualUserId).limit(1).maybeSingle();
          const symbols = [...new Set([...(cur?.symbols || []), command.symbol])];
          await supabase.from('bot_settings').update({ symbols, updated_at: new Date().toISOString() }).eq('user_id', actualUserId);
          result = { applied: true, symbols };
          await notifyTelegram(`Added *${command.symbol}* to watchlist`);
          break;
        }
        case 'remove_symbol': {
          const { data: cur } = await supabase.from('bot_settings').select('symbols').eq('user_id', actualUserId).limit(1).maybeSingle();
          const symbols = (cur?.symbols || []).filter((s: string) => s !== command.symbol);
          await supabase.from('bot_settings').update({ symbols, updated_at: new Date().toISOString() }).eq('user_id', actualUserId);
          result = { applied: true, symbols };
          await notifyTelegram(`Removed *${command.symbol}* from watchlist`);
          break;
        }
        case 'run_screener': {
          if (SCREENER_LOCK.running) return res.status(409).json({ error: 'Screener already running.' });
          SCREENER_LOCK.running = true;
          try { 
            const userExObj = await getUserExchange(userId);
            const ex = userExObj?.ex || exchange;
            result = await executeScreenerRun(ex, 'manual', userId); 
          }
          finally { SCREENER_LOCK.running = false; }
          break;
        }
        case 'set_autopilot': {
          const { data, error } = await supabase.from('openclaw_autopilot').update({ enabled: command.enabled, updated_at: new Date().toISOString() }).eq('id', AUTOPILOT_ID).select().maybeSingle();
          if (error) throw error;
          result = { applied: true, autopilot: data };
          await notifyTelegram(command.enabled ? `🟢 *Autopilot ON*` : `⚫ *Autopilot OFF*`);
          break;
        }
        case 'set_autopilot_interval': {
          const { data, error } = await supabase.from('openclaw_autopilot').update({ interval_hours: command.interval_hours, updated_at: new Date().toISOString() }).eq('id', AUTOPILOT_ID).select().maybeSingle();
          if (error) throw error;
          result = { applied: true, autopilot: data };
          break;
        }
        case 'clarify':
        case 'reject':
          return res.status(400).json({ error: `${command.kind} is not executable.` });
        default:
          return res.status(400).json({ error: `Unknown command: ${command.kind}` });
      }

      await logOpenClawAction(`EXEC ${command.kind} → success`, 'accept');
      res.json({ success: true, command: command.kind, result });
    } catch (error: any) {
      await logOpenClawAction(`EXEC failed: ${error.message}`, 'reject');
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/openclaw/candidates', async (req, res) => {
    try {
      const limit   = Math.min(50, Number(req.query.limit) || 20);
      const symbols = await discoverTopVolumeSymbols(exchange, limit);
      res.json({ candidates: symbols, count: symbols.length });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/openclaw/recommendations', async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: 'Supabase not configured.' });
      const status = req.query.status as string | undefined;
      let query = supabase.from('openclaw_recommendations').select('*').order('created_at', { ascending: false }).limit(20);
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw error;
      res.json({ recommendations: data || [] });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/openclaw/recommendations/:id/approve', async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: 'Supabase not configured.' });
      const { data: rec } = await supabase.from('openclaw_recommendations').select('*').eq('id', req.params.id).maybeSingle();
      if (!rec) return res.status(404).json({ error: 'Not found.' });
      if (rec.status !== 'pending') return res.status(409).json({ error: `Cannot approve status '${rec.status}'.` });

      const userId = (req.headers['x-user-id'] as string) || 'demo-user';
      const actualUserId = getEffectiveUserId(userId);

      await supabase.from('bot_settings').update({ symbols: rec.proposed_top_3, updated_at: new Date().toISOString() }).eq('user_id', actualUserId);
      await supabase.from('openclaw_recommendations').update({ status: 'approved', resolved_at: new Date().toISOString() }).eq('id', req.params.id);
      await logOpenClawAction(`APPROVED rec=${req.params.id} for user ${actualUserId}`, 'accept');
      await notifyTelegram(`✅ *Watchlist updated*\n${rec.proposed_top_3.join(', ')}`);
      res.json({ success: true, applied_symbols: rec.proposed_top_3 });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/openclaw/recommendations/:id/reject', async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: 'Supabase not configured.' });
      await supabase.from('openclaw_recommendations').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', req.params.id).eq('status', 'pending');
      await logOpenClawAction(`REJECTED rec=${req.params.id}`);
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/openclaw/autopilot', async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: 'Supabase not configured.' });
      const { data } = await supabase.from('openclaw_autopilot').select('*').eq('id', AUTOPILOT_ID).maybeSingle();
      res.json(data || { enabled: false, interval_hours: 24 });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/openclaw/autopilot', express.json(), async (req, res) => {
    try {
      if (!supabase) return res.status(503).json({ error: 'Supabase not configured.' });
      const { enabled, interval_hours, candidate_pool_size, backtest_bars } = req.body;
      const update: any = { updated_at: new Date().toISOString() };
      if (typeof enabled === 'boolean') update.enabled = enabled;
      if (typeof interval_hours === 'number' && interval_hours >= 1 && interval_hours <= 168) update.interval_hours = interval_hours;
      if (typeof candidate_pool_size === 'number' && candidate_pool_size >= 5 && candidate_pool_size <= 50) update.candidate_pool_size = candidate_pool_size;
      if (typeof backtest_bars === 'number' && backtest_bars >= 500 && backtest_bars <= 10000) update.backtest_bars = backtest_bars;
      const { data, error } = await supabase.from('openclaw_autopilot').update(update).eq('id', AUTOPILOT_ID).select().maybeSingle();
      if (error) throw error;
      await logOpenClawAction(`AUTOPILOT updated: ${JSON.stringify(update)}`);
      res.json(data);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/openclaw/run-screener', express.json({ limit: '1mb' }), async (req, res) => {
    if (SCREENER_LOCK.running) return res.status(409).json({ error: 'Screener already running.' });
    SCREENER_LOCK.running = true;
    try {
      const source = req.body?.source === 'autopilot' ? 'autopilot' : 'manual';
      const userId = (req.headers['x-user-id'] as string) || 'demo-user';
      const userExObj = await getUserExchange(userId);
      const ex = userExObj?.ex || exchange;
      const result = await executeScreenerRun(ex, source, userId);
      res.json(result);
    } catch (error: any) {
      await logOpenClawAction(`SCREENER FAILED: ${error.message}`, 'reject');
      res.status(500).json({ error: error.message });
    } finally { SCREENER_LOCK.running = false; }
  });

  // ── User API Key routes ───────────────────────────────────────────────────
  // GET /api/user/api-keys — list keys for current user
  app.get('/api/user/api-keys', async (req, res) => {
    try {
      const userId = getEffectiveUserId(req.headers['x-user-id'] as string);
      const { data, error } = await supabase
        .from('user_api_keys')
        .select('id, label, bybit_api_key_hint, bybit_testnet, is_active, created_at, last_verified_at, account_type')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/user/api-keys — save new encrypted key
  app.post('/api/user/api-keys', express.json(), async (req, res) => {
    try {
      const userId = getEffectiveUserId(req.headers['x-user-id'] as string);
      const { label, apiKey, apiSecret, testnet, accountType } = req.body;

      if (!apiKey || !apiSecret) {
        return res.status(400).json({ error: 'API key and secret are required' });
      }
      if (apiKey.length < 10 || apiSecret.length < 10) {
        return res.status(400).json({ error: 'API key or secret looks invalid — check you copied it correctly' });
      }

      // Test the key before saving
      try {
        const testExchange = new ccxt.bybit({
          apiKey: apiKey.trim(),
          secret: apiSecret.trim(),
          enableRateLimit: true,
          timeout: 10000,
          options: { defaultType: accountType || 'swap' },
        });
        if (testnet) testExchange.setSandboxMode(true);
        await testExchange.fetchBalance();
      } catch (testErr: any) {
        const msg = testErr.message || '';
        if (msg.includes('10003') || msg.includes('10004') || msg.includes('InvalidApiKey')) {
          return res.status(400).json({
            error: 'Invalid API credentials — check your key and secret, and make sure you whitelisted the correct IP on Bybit.'
          });
        }
        console.warn('API key test warning (saving anyway):', msg);
      }

      // Encrypt and store
      const encryptedKey    = encryptApiKey(apiKey.trim());
      const encryptedSecret = encryptApiKey(apiSecret.trim());
      const keyHint         = apiKey.trim().slice(-4);

      const { data, error } = await supabase
        .from('user_api_keys')
        .insert({
          user_id:              userId,
          label:                label || 'My Bybit Account',
          bybit_api_key_enc:    encryptedKey,
          bybit_api_secret_enc: encryptedSecret,
          bybit_api_key_hint:   keyHint,
          bybit_testnet:        testnet ?? true,
          account_type:         accountType || 'swap',
          is_active:            true,
          last_verified_at:     new Date().toISOString(),
        })
        .select('id, label, bybit_api_key_hint, bybit_testnet, is_active, created_at')
        .single();

      if (error) throw error;
      
      // Trigger bot refresh
      setImmediate(() => refreshUserBots().catch(e => console.error('Bot refresh failed:', e)));

      res.json({ success: true, key: data });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/user/api-keys/:id/test — test a saved key
  app.post('/api/user/api-keys/:id/test', async (req, res) => {
    try {
      const userId = getEffectiveUserId(req.headers['x-user-id'] as string);
      const { data: keyRecord, error } = await supabase
        .from('user_api_keys')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', userId)
        .single();

      if (error || !keyRecord) return res.status(404).json({ error: 'Key not found' });

      const decryptedKey    = decryptApiKey(keyRecord.bybit_api_key_enc);
      const decryptedSecret = decryptApiKey(keyRecord.bybit_api_secret_enc);

      const testExchange = new ccxt.bybit({
        apiKey:  decryptedKey,
        secret:  decryptedSecret,
        enableRateLimit: true,
        timeout: 10000,
        options: { defaultType: keyRecord.account_type || 'swap' },
      });
      if (keyRecord.bybit_testnet) testExchange.setSandboxMode(true);

      const balance = await testExchange.fetchBalance();
      const equity  = balance.info?.result?.list?.[0]?.totalEquity
        || (balance.total as any)?.USDT
        || 0;

      await supabase
        .from('user_api_keys')
        .update({ last_verified_at: new Date().toISOString() })
        .eq('id', req.params.id);

      res.json({ success: true, equity: Number(equity).toFixed(2) });
    } catch (err: any) {
      const msg = err.message || '';
      const userMsg = msg.includes('10003') || msg.includes('10004')
        ? 'Invalid credentials — key may have been deleted or IP whitelist changed on Bybit.'
        : 'Connection failed: ' + msg;
      res.json({ success: false, error: userMsg });
    }
  });

  // PATCH /api/user/api-keys/:id — toggle active
  app.patch('/api/user/api-keys/:id', express.json(), async (req, res) => {
    try {
      const userId = getEffectiveUserId(req.headers['x-user-id'] as string);
      const { is_active } = req.body;
      const { error } = await supabase
        .from('user_api_keys')
        .update({ is_active })
        .eq('id', req.params.id)
        .eq('user_id', userId);
      if (error) throw error;

      // Trigger bot refresh
      setImmediate(() => refreshUserBots().catch(e => console.error('Bot refresh failed:', e)));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/user/api-keys/:id — remove key
  app.delete('/api/user/api-keys/:id', async (req, res) => {
    try {
      const userId = getEffectiveUserId(req.headers['x-user-id'] as string);
      const { error } = await supabase
        .from('user_api_keys')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', userId);
      if (error) throw error;

      // Trigger bot refresh
      setImmediate(() => refreshUserBots().catch(e => console.error('Bot refresh failed:', e)));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Live Trading Readiness Check ─────────────────────────────────────────
  // GET /api/live-readiness  — runs several non-destructive checks and reports
  app.get('/api/live-readiness', async (req, res) => {
    const checks: { name: string; ok: boolean; detail: string }[] = [];

    // 1. Bybit connectivity (public — no auth needed)
    try {
      const ex = new ccxt.bybit({ enableRateLimit: true, timeout: 8000 });
      const ticker = await ex.fetchTicker('BTC/USDT');
      checks.push({ name: 'Bybit connectivity', ok: true, detail: `BTC price: $${ticker.last?.toFixed(0)}` });
    } catch (err: any) {
      checks.push({ name: 'Bybit connectivity', ok: false, detail: err.message });
    }

    // 2. API keys saved
    const userId = getEffectiveUserId(req.headers['x-user-id'] as string);
    let keyRecord: any = null;
    try {
      const { data } = await supabase
        .from('user_api_keys')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      keyRecord = data;
      checks.push({ name: 'API keys configured', ok: !!data, detail: data ? `Key hint: ••••${data.bybit_api_key_hint}` : 'No active API key found in DB' });
    } catch (err: any) {
      checks.push({ name: 'API keys configured', ok: false, detail: err.message });
    }

    // 3. Auth — balance fetch
    if (keyRecord) {
      try {
        const decKey = decryptApiKey(keyRecord.bybit_api_key_enc);
        const decSec = decryptApiKey(keyRecord.bybit_api_secret_enc);
        const ex = new ccxt.bybit({
          apiKey: decKey, secret: decSec,
          enableRateLimit: true, timeout: 10000,
          options: { defaultType: keyRecord.account_type || 'swap' },
        });
        if (keyRecord.bybit_testnet) ex.setSandboxMode(true);
        if (process.env.BYBIT_HOSTNAME) (ex as any).hostname = process.env.BYBIT_HOSTNAME.trim();
        const balance = await ex.fetchBalance();
        const equity = balance.info?.result?.list?.[0]?.totalEquity || balance.total?.USDT || 0;
        checks.push({ name: 'Balance fetch (auth OK)', ok: true, detail: `Equity: $${Number(equity).toFixed(2)} | ${keyRecord.bybit_testnet ? 'Testnet' : 'Mainnet'} | ${keyRecord.account_type || 'swap'}` });
      } catch (err: any) {
        const hint = err.message?.includes('10003') || err.message?.includes('10004')
          ? 'Invalid credentials or IP not whitelisted on Bybit'
          : err.message?.includes('403') ? 'Geo-blocked — Railway region may need to be Singapore'
          : err.message;
        checks.push({ name: 'Balance fetch (auth OK)', ok: false, detail: hint });
      }
    } else {
      checks.push({ name: 'Balance fetch (auth OK)', ok: false, detail: 'Skipped — no API key' });
    }

    // 4. Paper trading mode setting
    try {
      const { data: settings } = await supabase
        .from('bot_settings')
        .select('paper_trading, paused')
        .eq('user_id', userId)
        .maybeSingle();
      if (settings) {
        checks.push({
          name: 'Trading mode',
          ok: !settings.paper_trading,
          detail: settings.paper_trading ? '⚠️  paper_trading = true — switch to false in Bot Config to go live' : '✅ paper_trading = false (LIVE)',
        });
        checks.push({ name: 'Bot not paused', ok: !settings.paused, detail: settings.paused ? '⚠️  Bot is paused — resume in sidebar' : '✅ Running' });
      } else {
        checks.push({ name: 'Trading mode', ok: false, detail: 'No settings row found' });
      }
    } catch (err: any) {
      checks.push({ name: 'Trading mode', ok: false, detail: err.message });
    }

    const allOk = checks.every(c => c.ok);
    res.json({ ready: allOk, checks });
  });

  // ── Global Error Handler ──────────────────────────────────────────────────
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`[Global Error] ${req.method} ${req.url}:`, err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  });

  // ── Catch-all ─────────────────────────────────────────────────────────────
  app.all("/api/*", (req, res) => {
    console.log(`[404] Not Found: ${req.path}`);
    res.status(404).json({ error: "Route Not Found", path: req.path });
  });

  // ── SPA Fallback ─────────────────────────────────────────────────────────

  // In Development: Vite handles SPA fallback and static assets
  if (vite) {
    app.use((req, res, next) => {
      if (req.url.startsWith('/api')) {
        console.warn(`[Vite Middleware Warning] API call reached Vite: ${req.url}`);
      }
      next();
    });
    app.use(vite.middlewares);
  }

  // In Production: Serve static files and index.html as fallback
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 SignalDeck Server v1.5 on http://localhost:${PORT}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`   Model: ${process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'}`);
    console.log(`   Encryption: ${process.env.ENCRYPTION_SECRET ? '✅ configured' : '⚠️  ENCRYPTION_SECRET not set'}`);
    console.log(`   Vite: ${process.env.NODE_ENV !== 'production' ? 'Dev' : 'Static'}\n`);

    setImmediate(async () => {
      try {
        await new Promise(r => setTimeout(r, 3000));
        await initMarkets();

        // Start multi-user bot management
        await startAllUserBots();

        // Initialise Mantle on-chain integration
        initMantleFromEnv();
        
        // Refresh bots every 5 minutes
        setInterval(refreshUserBots, 5 * 60 * 1000);

        // Autopilot scheduler
        setInterval(async () => {
          if (!supabase || SCREENER_LOCK.running) return;
          try {
            const { data: ap } = await supabase.from('openclaw_autopilot').select('*').eq('id', AUTOPILOT_ID).maybeSingle();
            if (!ap?.enabled) return;
            const lastRun    = ap.last_run_at ? new Date(ap.last_run_at).getTime() : 0;
            const intervalMs = (ap.interval_hours || 24) * 3600000;
            if (Date.now() - lastRun < intervalMs) return;
            SCREENER_LOCK.running = true;
            try { 
              // Try to find first active user to use as surrogate for autopilot run
              let apExchange = exchange;
              const { data: activeKey } = await supabase.from('user_api_keys').select('user_id').eq('is_active', true).limit(1).maybeSingle();
              if (activeKey) {
                const userExObj = await getUserExchange(activeKey.user_id);
                if (userExObj) apExchange = userExObj.ex;
              }
              await executeScreenerRun(apExchange, 'autopilot'); 
            }
            finally { SCREENER_LOCK.running = false; }
          } catch (e: any) {
            console.error('Autopilot tick error:', e.message);
            SCREENER_LOCK.running = false;
          }
        }, 5 * 60 * 1000);
      } catch (e) {
        console.error("Server: Background services init failed:", e);
      }
    });
  });
}

startServer().catch(err => console.error("CRITICAL: Server failed to start:", err));