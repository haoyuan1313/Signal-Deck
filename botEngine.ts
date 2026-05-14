import ccxt from 'ccxt';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { detectSMCSetup, OHLCV, StrategySetup, calcATR, calcEMA, getHTFTrend, SMCOptions, DEFAULT_ALLOWED_SESSIONS } from './src/lib/strategy';
import { MAX_OPEN_POSITIONS, DAILY_LOSS_HALT_PCT } from './src/lib/constants';
import { logDecisionOnChain, fireAndForget, processRetryQueue, getOnChainPerformance } from './src/lib/mantle';

dotenv.config();

// ── Shared settings ID (server-side singleton) ────────────────────────────────
// Must match the row inserted by the server on first boot.
const BOT_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

let supabase: any = null;

function getSupabase() {
  if (supabase) return supabase;

  let supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Bot: CRITICAL - Supabase credentials missing on server side.');
    return null;
  }

  supabaseUrl = supabaseUrl.trim();
  if (!supabaseUrl.startsWith('http')) supabaseUrl = 'https://' + supabaseUrl;
  supabaseUrl = supabaseUrl.replace(/\/+$/, '').replace('/rest/v1', '');

  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    return supabase;
  } catch (error) {
    console.error('Bot: Failed to initialize Supabase client:', error);
    return null;
  }
}

// ── Encryption helpers (mirrors server.ts) ────────────────────────────────────
import crypto from 'crypto';

function decryptApiKey(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  const secret = process.env.ENCRYPTION_SECRET || 'fallback-change-this-in-production';
  const key    = crypto.scryptSync(secret, 'signaldeck-salt', 32);
  const [ivHex, encryptedHex] = ciphertext.split(':');
  if (!ivHex || !encryptedHex) return ciphertext;
  const iv        = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher  = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ── Per-user bot registry ─────────────────────────────────────────────────────

const activeBots = new Map<string, SMCBot>();

/**
 * Called once on server startup.  Finds every active user_api_keys row and
 * starts a dedicated SMCBot for each user.
 */
export async function startAllUserBots(): Promise<void> {
  const sb = getSupabase();
  if (!sb) {
    console.warn('Bot: Supabase not configured — skipping multi-user bot start.');
    return;
  }

  const { data: keys, error } = await sb
    .from('user_api_keys')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('Bot: Failed to load user API keys:', error.message);
    return;
  }

  if (!keys || keys.length === 0) {
    console.log('Bot: No active user API keys found — running in public/demo mode.');
    // Start a single bot with env keys as fallback
    const demoBot = new SMCBot(
      process.env.BYBIT_API_KEY,
      process.env.BYBIT_API_SECRET,
      process.env.BYBIT_TESTNET === 'true',
      process.env.BYBIT_DEFAULT_TYPE || 'spot',
      BOT_SETTINGS_ID,
    );
    activeBots.set('demo', demoBot);
    demoBot.run().catch(e => console.error('Demo bot crashed:', e));
    return;
  }

  for (const keyRecord of keys) {
    if (!activeBots.has(keyRecord.user_id)) {
      await startBotForUser(keyRecord);
    }
  }

  console.log(`Bot: Started ${activeBots.size} user bot(s).`);
}

/**
 * Called on a timer to pick up newly added / deactivated keys without a restart.
 */
export async function refreshUserBots(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  const { data: keys, error } = await sb
    .from('user_api_keys')
    .select('*')
    .eq('is_active', true);

  if (error) {
    console.error('Bot: refreshUserBots — failed to query keys:', error.message);
    return;
  }

  const activeIds = new Set((keys || []).map((k: any) => k.user_id as string));

  // Stop bots for deactivated keys
  for (const [userId, bot] of activeBots.entries()) {
    if (userId !== 'demo' && !activeIds.has(userId)) {
      bot.stop();
      activeBots.delete(userId);
      console.log(`Bot: Stopped bot for user ${userId} (key deactivated).`);
    }
  }

  // Start bots for new keys
  for (const keyRecord of (keys || [])) {
    if (!activeBots.has(keyRecord.user_id)) {
      await startBotForUser(keyRecord);
    }
  }
}

async function startBotForUser(keyRecord: any): Promise<void> {
  try {
    const apiKey    = decryptApiKey(keyRecord.bybit_api_key_enc);
    const apiSecret = decryptApiKey(keyRecord.bybit_api_secret_enc);

    if (!apiKey || apiKey === 'system') return; // skip placeholder rows

    const bot = new SMCBot(
      apiKey,
      apiSecret,
      keyRecord.bybit_testnet ?? true,
      keyRecord.account_type || 'swap',
      keyRecord.user_id,
    );

    activeBots.set(keyRecord.user_id, bot);
    bot.run().catch(e => console.error(`Bot crashed for user ${keyRecord.user_id}:`, e));
    console.log(`Bot: Started bot for user ${keyRecord.user_id} (hint: ...${keyRecord.bybit_api_key_hint})`);
  } catch (err: any) {
    console.error(`Bot: Failed to start bot for user ${keyRecord.user_id}:`, err.message);
  }
}

// ── SMCBot class ──────────────────────────────────────────────────────────────

export class SMCBot {
  private exchange: any;
  private settings: any = null;
  private symbols: string[] = [];
  private lastPausedState: boolean | null = null;
  private lastPaperState: boolean | null = null;
  private userId: string;
  private _running = true;

  constructor(
    apiKey:      string | undefined,
    apiSecret:   string | undefined,
    isTestnet:   boolean,
    defaultType: string,
    userId:      string,
  ) {
    this.userId = userId;

    const config: any = {
      enableRateLimit: true,
      timeout:         30000,
      apiKey:          apiKey   || undefined,
      secret:          apiSecret || undefined,
      options:         { defaultType },
    };

    if (process.env.BYBIT_HOSTNAME) config.hostname = process.env.BYBIT_HOSTNAME.trim();

    this.exchange = new ccxt.bybit(config);
    if (isTestnet) this.exchange.setSandboxMode(true);

    const modeLabel = defaultType.toUpperCase();
    console.log(`Bot [${userId}]: Initializing Bybit ${modeLabel} | Testnet: ${isTestnet}`);

    if (apiKey && apiSecret) {
      console.log(`Bot [${userId}]: Exchange initialised with API keys.`);
    } else {
      console.warn(`Bot [${userId}]: No API keys — read-only/demo mode.`);
    }

    this.exchange.loadMarkets().catch((err: any) => {
      console.warn(`Bot [${userId}]: Market load warning: ${err.message}`);
    });
  }

  stop() {
    this._running = false;
  }

  private async notifyTelegram(message: string) {
    try {
      let token: string | undefined;
      let chatId: string | undefined;

      // 1. Try Supabase telegram_config first
      const sb = getSupabase();
      if (sb) {
        try {
          const { data } = await sb.from('telegram_config')
            .select('bot_token_enc, chat_id')
            .eq('id', 'singleton')
            .maybeSingle();
          if (data?.bot_token_enc && data?.chat_id) {
            token = decryptApiKey(data.bot_token_enc);
            chatId = data.chat_id;
          }
        } catch { /* fall through to env vars */ }
      }

      // 2. Fall back to env vars
      if (!token) token = process.env.TELEGRAM_BOT_TOKEN;
      if (!chatId) chatId = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chatId) return;

      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
      });
    } catch {}
  }

  private async updateHeartbeat() {
    try {
      const sb = getSupabase();
      if (!sb) return;
      await sb.from('bot_heartbeat').upsert({
        id:        BOT_SETTINGS_ID,
        last_ping: new Date().toISOString(),
        user_id:   this.userId,
      });
    } catch {}
  }

  private async loadSettings() {
    try {
      const sb = getSupabase();
      if (!sb) return;

      // Try to find settings by user_id first, fall back to singleton id
      let { data, error } = await sb
        .from('bot_settings')
        .select('*')
        .eq('user_id', this.userId)
        .maybeSingle();

      if (error || !data) {
        // Fall back to the legacy singleton row
        const fallback = await sb
          .from('bot_settings')
          .select('*')
          .eq('id', BOT_SETTINGS_ID)
          .maybeSingle();
        data  = fallback.data;
        error = fallback.error;
      }

      if (error) {
        console.error(`Bot [${this.userId}]: Settings error: ${error.message}`);
        return;
      }

      if (!data) {
        console.warn(`Bot [${this.userId}]: No settings found, using defaults.`);
        this.settings = {
          symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
          timeframe: '5m', htf_timeframe: '1h', htf2_timeframe: '4h',
          rr: 2.0, bars: 500, paused: false, paper_trading: true, risk_percent: 1.0,
        };
        this.symbols = this.settings.symbols;
        return;
      }

      if (this.lastPausedState !== null && this.lastPausedState !== data.paused) {
        const msg = data.paused
          ? '⏸️ *Bot Paused*\nThe engine has stopped scanning for new setups.'
          : '▶️ *Bot Resumed*\nThe engine is now actively scanning symbols.';
        await this.notifyTelegram(msg);
      }
      if (this.lastPaperState !== null && this.lastPaperState !== data.paper_trading) {
        const msg = data.paper_trading
          ? '⚖️ *Mode Switched to PAPER*\nTrades will now be simulated.'
          : '🔥 *Mode Switched to LIVE*\nReal funds will be used on Bybit!';
        await this.notifyTelegram(msg);
      }

      this.lastPausedState = data.paused;
      this.lastPaperState  = data.paper_trading;
      this.settings        = data;
      this.symbols         = data.symbols || [];
    } catch (err) {
      console.error(`Bot [${this.userId}]: loadSettings exception:`, err);
    }
  }

  private async detectSetup(symbol: string): Promise<StrategySetup | null> {
    try {
      const ltf   = this.settings?.timeframe      || '5m';
      const htf   = this.settings?.htf_timeframe  || '1h';
      const htf2  = this.settings?.htf2_timeframe || '4h';
      const bars  = this.settings?.bars           || 500;
      const rr    = this.settings?.rr             || 2.0;

      const htfLimit  = Math.max(100, Math.floor(bars / 5));
      const htf2Limit = Math.max(50,  Math.floor(bars / 20));

      const [ohlcvLtf, ohlcvHtf, ohlcvHtf2] = await Promise.all([
        this.fetchOHLCV(symbol, ltf,  bars),
        this.fetchOHLCV(symbol, htf,  htfLimit),
        this.fetchOHLCV(symbol, htf2, htf2Limit),
      ]);

      const smc: SMCOptions = {
        rr,
        atrPeriod:       this.settings?.atr_period       || 14,
        allowedSessions: this.settings?.allowed_sessions  || DEFAULT_ALLOWED_SESSIONS,
        require4hAlign:  this.settings?.require_4h_align  ?? true,
      };

      return detectSMCSetup(ohlcvLtf, ohlcvHtf, ohlcvHtf2, smc);
    } catch (err) {
      console.error(`Bot [${this.userId}]: detectSetup failed for ${symbol}:`, err);
      return null;
    }
  }

  private async calculateAmount(symbol: string, entry: number, sl: number, direction: 'long' | 'short'): Promise<number> {
    try {
      const riskPercent = this.settings?.risk_percent || 1.0;

      let balanceData: any;
      try {
        balanceData = await this.exchange.fetchBalance();
      } catch {
        balanceData = { free: { USDT: 10000 }, total: { USDT: 10000 }, info: {} };
      }

      let equity = balanceData.total?.USDT || balanceData.free?.USDT || 10000;
      const v5eq = balanceData.info?.result?.list?.[0]?.totalEquity || balanceData.info?.list?.[0]?.totalEquity;
      if (v5eq) equity = Number(v5eq);

      const riskUSDT   = equity * (riskPercent / 100);
      const stopDist   = Math.abs(entry - sl);
      if (stopDist === 0) return 0;

      let amount = riskUSDT / stopDist;

      if (!this.exchange.markets?.[symbol]) await this.exchange.loadMarkets();
      const market  = this.exchange.market(symbol);
      const isSpot  = this.exchange.options['defaultType'] === 'spot';
      const balance = await this.exchange.fetchBalance();

      if (isSpot) {
        if (direction === 'long') {
          const available = (balance.free[market.quote] || 0) * 0.98 / entry;
          if (amount > available) amount = available;
        } else {
          const available = balance.free[market.base] || 0;
          if (available <= 0) return 0;
          if (amount > available) amount = available;
        }
      } else {
        const cost = amount * entry;
        if (cost > equity * 0.95 && equity > 0) amount = (equity * 0.90) / entry;
      }

      amount = parseFloat(this.exchange.amountToPrecision(symbol, amount));
      if (market.limits?.amount?.min && amount < market.limits.amount.min) return 0;
      return amount;
    } catch (err) {
      console.error(`Bot [${this.userId}]: calculateAmount error:`, err);
      return 0;
    }
  }

  // ── AI Confidence Scoring ────────────────────────────────────────────────
  // Calls Claude to evaluate a trade setup. Non-blocking — if Claude fails,
  // returns 0 (deterministic SMC fallback). Never throws (F-003).

  private async scoreAIConfidence(setup: StrategySetup, symbol: string): Promise<{ confidence: number; reasoning: string }> {
    try {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) return { confidence: 0, reasoning: 'ANTHROPIC_API_KEY not set' };

      // Fetch on-chain performance data — non-blocking, fallback to empty (F-003)
      let onChainContext = '';
      try {
        const perf = await getOnChainPerformance();
        if (perf) {
          const symPerf = perf.bySymbol[symbol];
          const dirKey = setup.direction || 'long';
          const dirPerf = perf.byDirection[dirKey as 'long' | 'short'];
          onChainContext = `
On-chain historical performance from Mantle AgentTradeRegistry (${perf.overall.totalDecisions} decisions recorded):
- Overall avg AI confidence: ${perf.overall.avgAIConfidence} bps${symPerf ? `
- ${symbol} on-chain: ${symPerf.decisions} decisions, avg AI confidence ${symPerf.avgAIConfidence} bps` : ''}${dirPerf ? `
- ${dirKey} direction on-chain: ${dirPerf.decisions} decisions` : ''}

Use this on-chain data to calibrate your confidence score — higher confidence when the setup aligns with historical patterns.`;
        }
      } catch { /* F-003: on-chain data fetch failure doesn't block scoring */ }

      const prompt = `You are an SMC (Smart Money Concepts) trade evaluator. Score the following trade setup on a scale of 0-10000 (basis points).${onChainContext}

Setup details:
- Symbol: ${symbol}
- Direction: ${setup.direction}
- Entry price: ${setup.price?.toFixed(4)}
- Stop Loss: ${setup.sl?.toFixed(4)}
- Take Profit: ${setup.tp?.toFixed(4)}
- HTF Trend: ${setup.htf_trend}
- Session: ${setup.session || 'unknown'}
- ATR: ${setup.atr?.toFixed(4) || 'N/A'}

Score based on:
1. HTF trend alignment (higher = stronger trend)
2. Risk/reward quality (higher RR = better)
3. Session quality (London/NY > Asian/Late)
4. On-chain historical patterns for this symbol and direction
5. Overall setup cleanliness

Return ONLY valid JSON — no markdown, no explanation outside JSON:
{"confidence": <0-10000>, "reasoning": "<one sentence>"}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: 256,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) return { confidence: 0, reasoning: `Claude API ${response.status}` };

      const data = await response.json();
      const text = data.content?.map((b: any) => b.text || '').join('') || '';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

      const confidence = Math.max(0, Math.min(10000, parseInt(String(parsed.confidence)) || 0));
      console.log(`Bot [${this.userId}]: AI confidence for ${symbol}: ${confidence} — ${parsed.reasoning}`);
      return { confidence, reasoning: parsed.reasoning || 'no reasoning' };
    } catch (err) {
      console.error(`Bot [${this.userId}]: AI confidence scoring failed:`, err);
      return { confidence: 0, reasoning: 'scoring error — fallback to deterministic' };
    }
  }

  private async executeTrade(
    symbol: string,
    setup: StrategySetup,
    aiScore: { confidence: number; reasoning: string } = { confidence: 0, reasoning: '' },
  ) {
    const price      = setup.price!;
    const direction  = setup.direction!;
    const isSwapMode = ['swap', 'future'].includes(this.exchange.options['defaultType']);

    let lookupSymbol = symbol;
    if (isSwapMode && (!this.exchange.markets?.[symbol] || this.exchange.markets[symbol].type === 'spot')) {
      const sw = symbol.includes(':') ? symbol : `${symbol}:${symbol.split('/')[1]}`;
      if (this.exchange.markets?.[sw]) lookupSymbol = sw;
    }

    const ticker = await this.exchange.fetchTicker(lookupSymbol);
    const curPrice = ticker?.last;
    if (!curPrice) {
      await this.logStatus(`SKIPPED ${symbol}: Could not fetch current price`, 'info');
      return;
    }

    const diff = Math.abs(curPrice - price) / price;
    if (diff > 0.01) {
      await this.logStatus(`PENDING ${symbol}: Price ${curPrice.toFixed(4)} too far from FVG ${price.toFixed(4)} (>1%)`, 'info');
      return;
    }

    const sl          = setup.sl!;
    const actualRisk  = Math.abs(curPrice - sl);
    if (actualRisk < curPrice * 0.001) {
      await this.logStatus(`SKIPPED ${symbol}: Risk too small`, 'info');
      return;
    }

    const rr = setup.rr || this.settings?.rr || 2.0;
    const tp = curPrice + (actualRisk * rr * (direction === 'long' ? 1 : -1));

    const isAlreadyPastTarget = direction === 'long' ? curPrice >= setup.tp! : curPrice <= setup.tp!;
    const isAlreadyPastSL     = direction === 'long' ? curPrice <= sl       : curPrice >= sl;

    if (isAlreadyPastTarget || isAlreadyPastSL) {
      await this.logStatus(`SKIPPED ${symbol}: Already past TP or SL`, 'info');
      return;
    }

    await this.logStatus(`🔥 EXECUTING ${symbol} @ ${curPrice.toFixed(4)} (TP: ${tp.toFixed(4)}, SL: ${sl.toFixed(4)})`, 'accept');

    let orderId       = 'simulated';
    let executedAmount = 0;
    const isPaper     = this.settings?.paper_trading ?? true;
    const isLiveAuth  = !!(this.exchange.apiKey && this.exchange.secret);
    const isRealOrder = isLiveAuth && !isPaper;

    if (isRealOrder) {
      try {
        let tradeSym = symbol;
        const market = this.exchange.market(symbol);
        if (isSwapMode && (market.type === 'spot' || !market.type)) {
          const sw = symbol.includes(':') ? symbol : `${symbol}:${symbol.split('/')[1]}`;
          if (this.exchange.markets?.[sw]) { tradeSym = sw; }
        }

        const amount = await this.calculateAmount(tradeSym, curPrice, sl, direction);
        if (amount <= 0) { await this.logStatus(`SKIPPED ${symbol}: Amount is 0`, 'info'); return; }

        executedAmount = amount;
        const side   = direction === 'long' ? 'buy' : 'sell';
        const params: any = {};
        const tradeMarket = this.exchange.market(tradeSym);
        if (['swap', 'future', 'linear', 'inverse'].includes(tradeMarket.type)) {
          params.stopLoss   = sl;
          params.takeProfit = tp;
          params.tpslMode   = 'Full';
        }

        const order = await this.exchange.createOrder(tradeSym, 'market', side, amount, undefined, params);
        orderId = order.id;
        console.log(`Bot [${this.userId}]: Live order placed — ID: ${orderId}, amount: ${amount} ${symbol}`);
      } catch (err: any) {
        console.error(`Bot [${this.userId}]: LIVE EXECUTION FAILED:`, err.message);
        await this.notifyTelegram(`❌ *LIVE EXECUTION FAILED*\n${symbol}: ${err.message}`);
        await this.logStatus(`LIVE ERROR ${symbol}: ${err.message}`, 'reject');
        return;
      }
    }

    // Calculate risk in USDT for the record
    const riskPercent = this.settings?.risk_percent ?? 1.0;
    let riskUsdt = 0;
    try {
      if (isRealOrder && executedAmount > 0) {
        riskUsdt = executedAmount * actualRisk;
      } else {
        // Estimate for paper trades based on settings risk %
        const equity = 10000; // paper placeholder — actual equity unknown without auth call
        riskUsdt = equity * (riskPercent / 100);
      }
    } catch { riskUsdt = 0; }

    const tradeData = {
      symbol,
      direction,
      entry:         curPrice,
      sl_init:       sl,
      sl,
      tp,
      rr,
      risk:          Math.round(riskUsdt * 100) / 100,
      status:        'open',
      is_paper:      isPaper,
      order_id:      orderId,
      exchange_type: this.exchange.options['defaultType'] || 'spot',
      be_armed:      false,
      bars_held:     0,
      opened_at:     new Date().toISOString(),
      user_id:       this.userId,
      ai_confidence: aiScore.confidence,
      ai_reasoning:  aiScore.reasoning,
    };

    const sb = getSupabase();
    let dbTradeId: string | null = null;
    if (sb) {
      const { data: inserted, error } = await sb.from('trades').insert(tradeData).select('id').single();
      if (error) {
        console.error(`Bot [${this.userId}]: Trade insert error:`, error.message);
      } else if (inserted) {
        dbTradeId = inserted.id;
      }
    }

    const aiPct = aiScore.confidence > 0 ? `\nAI Score: ${(aiScore.confidence / 100).toFixed(1)}%` : '';
    const tag = isRealOrder ? '🔥 LIVE TRADE' : isPaper ? '🧪 PAPER TRADE' : '⚖️ PAPER TRADE (Live Data)';
    await this.notifyTelegram(
      `✅ *${tag}*${aiPct}\n${symbol} ${direction.toUpperCase()}\nEntry: ${curPrice.toFixed(4)}\nSL: ${sl.toFixed(4)}\nTP: ${tp.toFixed(4)}`,
    );

    // Mantle on-chain log — fire-and-forget, never blocks trade execution (F-003)
    if (dbTradeId) {
      const entry = curPrice;
      const aiConf = aiScore.confidence;
      fireAndForget(async () => {
        const txHash = await logDecisionOnChain({
          symbol,
          action: 'open',
          entry,
          sl,
          tp,
          direction,
          tradeId: dbTradeId!,
          aiConfidence: aiConf,
        });
        if (txHash) {
          const sb2 = getSupabase();
          if (sb2) {
            await sb2.from('trades').update({
              mantle_tx_hash: txHash,
              is_on_chain: true,
              mantle_logged_at: new Date().toISOString(),
            }).eq('id', dbTradeId);
            console.log(`Bot [${this.userId}]: Mantle tx recorded — ${txHash}`);
          }
        }
      }, `mantle-log-open-${dbTradeId}`);
    }
  }

  private async manageOpenTrades() {
    try {
      const sb = getSupabase();
      if (!sb) return;

      const query = sb.from('trades').select('*').eq('status', 'open');
      // Filter by user if we have a real user id
      const { data: openTrades, error } = this.userId !== BOT_SETTINGS_ID
        ? await query.eq('user_id', this.userId)
        : await query;

      if (error) throw error;

      for (const trade of (openTrades || [])) {
        const ticker   = await this.exchange.fetchTicker(trade.symbol);
        const curPrice = ticker.last;
        if (!curPrice) continue;

        const riskAmt = Math.abs(trade.entry - trade.sl_init) || 1;
        const pnl_r   = trade.direction === 'long'
          ? (curPrice - trade.entry) / riskAmt
          : (trade.entry - curPrice) / riskAmt;

        // Break even
        if (pnl_r >= 1.0 && !trade.be_armed) {
          await sb.from('trades').update({ sl: trade.entry, be_armed: true }).eq('id', trade.id);
        }

        const elapsedMins  = (Date.now() - new Date(trade.opened_at).getTime()) / 60000;
        const isSL         = trade.direction === 'long' ? curPrice <= trade.sl : curPrice >= trade.sl;
        const isTP         = trade.direction === 'long' ? curPrice >= trade.tp : curPrice <= trade.tp;
        const isTimeout    = elapsedMins >= 150;
        const isStagnation = elapsedMins >= 75 && pnl_r < 0.5;

        if (isSL || isTP || isTimeout || isStagnation) {
          let pnlFinal = pnl_r;
          if (isSL && trade.be_armed) pnlFinal = Math.max(0, pnl_r);

          await sb.from('trades').update({
            status:    'closed',
            closed_at: new Date().toISOString(),
            exit_price: curPrice,
            outcome:   pnlFinal > 0 ? 1 : pnlFinal < 0 ? -1 : 0,
            r:         Math.round(pnlFinal * 100) / 100,
            bars_held: Math.floor(elapsedMins),
          }).eq('id', trade.id);

          // Fire-and-forget close decision on Mantle — never blocks (F-003)
          fireAndForget(async () => {
            const txHash = await logDecisionOnChain({
              symbol: trade.symbol,
              action: 'close',
              entry: trade.entry,
              sl: trade.sl_init ?? trade.sl,
              tp: trade.tp,
              direction: trade.direction,
              tradeId: trade.id,
            });
            if (txHash) {
              await sb.from('trades').update({
                mantle_tx_hash: txHash,
                is_on_chain: true,
                mantle_logged_at: new Date().toISOString(),
              }).eq('id', trade.id);
            }
          }, `mantle-log-close-${trade.id}`);

          const reason = isTP ? 'TP 🟢' : isSL ? 'SL 🔴' : isTimeout ? 'TIMEOUT ⌛' : 'STAGNATION 🛑';
          await this.logStatus(`🏁 CLOSED ${trade.symbol} | ${reason} | PnL: ${pnlFinal.toFixed(2)}R`, 'accept');
        } else {
          await sb.from('trades').update({ bars_held: Math.floor(elapsedMins) }).eq('id', trade.id);
        }
      }
    } catch (err) {
      console.error(`Bot [${this.userId}]: manageOpenTrades error:`, err);
    }
  }

  private async logStatus(message: string, type: 'info' | 'loop' | 'check' | 'reject' | 'accept' = 'info') {
    console.log(`[${new Date().toISOString()}] Bot [${this.userId}] [${type.toUpperCase()}]: ${message}`);
    try {
      const sb = getSupabase();
      if (sb) {
        await sb.from('bot_execution_logs').insert({
          message,
          type,
          user_id:    this.userId,
          created_at: new Date().toISOString(),
        });
      }
    } catch {}
  }

  private async fetchOHLCV(symbol: string, timeframe: string, limit: number): Promise<OHLCV[]> {
    const tfSeconds  = this.exchange.parseTimeframe(timeframe);
    let allOhlcv: any[] = [];
    const batchLimit = 1000;

    let batch = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, batchLimit);
    allOhlcv  = [...batch];

    while (allOhlcv.length < limit && batch.length > 0) {
      const firstTs    = allOhlcv[0][0];
      const fetchCount = Math.min(limit - allOhlcv.length, batchLimit);
      const since      = firstTs - fetchCount * tfSeconds * 1000;

      batch = await this.exchange.fetchOHLCV(symbol, timeframe, since, fetchCount);
      if (!batch.length) break;

      const filtered = batch.filter((c: any) => c[0] < firstTs);
      if (!filtered.length) break;

      allOhlcv = [...filtered, ...allOhlcv];
      if (allOhlcv.length >= 10000) break;
    }

    return allOhlcv
      .sort((a, b) => a[0] - b[0])
      .slice(-limit)
      .map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }));
  }

  private async isAtMaxPositions(): Promise<boolean> {
    try {
      const sb = getSupabase();
      if (!sb) return false;
      const query = sb.from('trades').select('*', { count: 'exact', head: true }).eq('status', 'open');
      const { count, error } = this.userId !== BOT_SETTINGS_ID
        ? await query.eq('user_id', this.userId)
        : await query;
      if (error) return false;
      const maxAllowed = this.settings?.max_concurrent_trades ?? MAX_OPEN_POSITIONS;
      console.log(`Bot [${this.userId}]: Open positions: ${count ?? 0} / max ${maxAllowed}`);
      return (count ?? 0) >= maxAllowed;
    } catch { return false; }
  }

  private async isDailyLossBreached(): Promise<boolean> {
    try {
      const sb = getSupabase();
      if (!sb) return false;

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const query = sb.from('trades').select('r').eq('status', 'closed').gte('closed_at', todayStart.toISOString());
      const { data, error } = this.userId !== BOT_SETTINGS_ID
        ? await query.eq('user_id', this.userId)
        : await query;

      if (error) return false;

      const totalR    = (data ?? []).reduce((sum: number, t: { r: number | null }) => sum + (t.r ?? 0), 0);
      const riskPct   = this.settings?.risk_percent ?? 1.0;
      const dailyLoss = Math.abs(Math.min(totalR, 0)) * riskPct;

      if (dailyLoss >= DAILY_LOSS_HALT_PCT) {
        await this.logStatus(`DAILY LOSS HALT: ${dailyLoss.toFixed(2)}%`, 'reject');
        return true;
      }
      return false;
    } catch { return false; }
  }

  async run() {
    console.log(`Bot [${this.userId}]: Engine loop started.`);
    await this.logStatus('Engine loop started.', 'info');

    const shutdown = async (sig: string) => {
      if (!this._running) return;
      this._running = false;
      await this.logStatus(`Bot shutting down (${sig}).`, 'info');
      await this.notifyTelegram(`🛑 *Bot Stopped*\nSignal: ${sig}`);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    await this.loadSettings();

    setTimeout(async () => {
      const mode = this.settings?.paper_trading ? '🧪 Paper' : '🔥 LIVE';
      await this.notifyTelegram(`🚀 *SignalDeck Bot Started*\nMode: ${mode}`);
    }, 1000);

    while (this._running) {
      try {
        await this.loadSettings();
        await this.updateHeartbeat();

        if (this.settings && !this.settings.paused) {
          const [dailyHalt, maxPos] = await Promise.all([
            this.isDailyLossBreached(),
            this.isAtMaxPositions(),
          ]);

          if (dailyHalt || maxPos) {
            await this.manageOpenTrades();
            await new Promise(r => setTimeout(r, 60000));
            continue;
          }

          await this.logStatus(`Scanning ${this.symbols.length} symbols...`, 'loop');

          for (const symbol of this.symbols) {
            if (!this._running) break;
            await this.logStatus(`Checking ${symbol}`, 'check');

            let setup: StrategySetup | null = null;
            try {
              setup = await this.detectSetup(symbol);
            } catch (err: any) {
              if (err.message?.includes('10003') || err.message?.includes('10004')) {
                await this.logStatus(`AUTH FAILED for ${symbol} — disabling keys.`, 'reject');
                this.exchange.apiKey = undefined;
                (this.exchange as any).secret = undefined;
                break;
              }
              throw err;
            }

            const sb = getSupabase();
            const NOISE = new Set(['no_setup_found', 'no_data', 'insufficient_data', 'no_sweep_detected', 'none', 'session_filter']);
            const reason = setup?.reason || 'no_data';

            if (sb && !NOISE.has(reason)) {
              await sb.from('signals_log').insert({
                symbol,
                direction: setup?.direction || 'none',
                reason,
                price:     setup?.price || 0,
                htf_trend: setup?.htf_trend || 'n/a',
                user_id:   this.userId,
              });
            }

            if (!setup || setup.reason !== 'accepted') {
              await this.logStatus(`SKIPPED ${symbol}: ${reason}`, 'reject');
              continue;
            }

            await this.logStatus(`📐 SETUP DETECTED ${symbol}: ${setup.direction?.toUpperCase()}`, 'accept');

            if (sb) {
              const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
              const dupQ = sb.from('trades').select('*').eq('symbol', symbol)
                .or(`status.eq.open,and(status.eq.closed,closed_at.gt.${fifteenMinsAgo})`);
              const { data: existing } = this.userId !== BOT_SETTINGS_ID
                ? await dupQ.eq('user_id', this.userId)
                : await dupQ;

              if (!existing || existing.length === 0) {
                // AI scores the setup — non-blocking, fallback to 0 on error (F-003)
                const aiScore = await this.scoreAIConfidence(setup, symbol);
                await this.executeTrade(symbol, setup, aiScore);
              } else {
                const hasOpen = existing.some((t: any) => t.status === 'open');
                await this.logStatus(hasOpen ? `MISSED SIGNAL (open exists) ${symbol}` : `COOLDOWN ${symbol}`, 'info');
              }
            }
          }

          await this.manageOpenTrades();
        } else {
          await this.logStatus('Bot is PAUSED.', 'info');
        }
      } catch (err) {
        console.error(`Bot [${this.userId}]: Loop error:`, err);
        await this.logStatus(`LOOP ERROR: ${err instanceof Error ? err.message : String(err)}`, 'info');
      }

      // Process failed Mantle writes (non-blocking)
      try {
        const retried = await processRetryQueue();
        if (retried > 0) {
          console.log(`Bot [${this.userId}]: Mantle retry queue — ${retried} succeeded`);
        }
      } catch (err) {
        console.error(`Bot [${this.userId}]: processRetryQueue error:`, err);
      }

      await new Promise(r => setTimeout(r, 60000));
    }
  }
}