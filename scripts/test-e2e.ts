// Direct end-to-end test: setup → AI scoring → trade → Mantle contract write
import ccxt from 'ccxt';
import { createClient } from '@supabase/supabase-js';
import { logDecisionOnChain, initMantleFromEnv } from '../src/lib/mantle.ts';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function main() {
  console.log('=== SignalDeck E2E Test ===\n');

  // 1. Connect to Supabase
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('1. Supabase connected');

  // 2. Connect Mantle
  const mantleWallet = initMantleFromEnv();
  console.log(`2. Mantle: ${mantleWallet ? 'connected ' + mantleWallet.address : 'not connected'}`);

  // 3. Connect to Bybit
  const exchange = new ccxt.bybit({
    enableRateLimit: true,
    timeout: 15000,
    options: { defaultType: 'swap' },
  });
  if (process.env.BYBIT_TESTNET === 'true') exchange.setSandboxMode(true);
  await exchange.loadMarkets();
  console.log('3. Bybit markets loaded');

  // 4. Get current price for ONDO
  const symbol = 'ONDO/USDT:USDT';
  const ticker = await exchange.fetchTicker(symbol);
  const curPrice = ticker.last!;
  const entry = curPrice;
  const sl = curPrice * 0.98;    // 2% stop
  const tp = curPrice * 1.04;    // 4% target (RR = 2:1)

  // Simulated setup for testing the on-chain flow
  const setup = {
    direction: 'long' as const,
    reason: 'accepted',
    price: entry,
    sl,
    tp,
    htf_trend: 'bullish',
    atr: entry * 0.01,
    rr: 2.0,
  };
  console.log(`4. Simulated setup: ${symbol} LONG @ ${entry} | SL: ${sl} | TP: ${tp}`);

  // 5. AI Confidence Scoring
  console.log('\n5. AI Confidence Scoring...');
  let aiConfidence = 0;
  let aiReasoning = '';
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('No API key');

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
        messages: [{
          role: 'user',
          content: `Score this trade setup 0-10000: ${symbol} ${setup.direction} Entry:${setup.price} SL:${setup.sl} TP:${setup.tp} HTF:${setup.htf_trend}. Return JSON: {"confidence":<0-10000>,"reasoning":"<one sentence>"}`,
        }],
      }),
    });
    const data = await response.json();
    const text = data.content?.map((b: any) => b.text || '').join('') || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    aiConfidence = Math.max(0, Math.min(10000, parseInt(String(parsed.confidence)) || 0));
    aiReasoning = parsed.reasoning || '';
    console.log(`   AI Score: ${aiConfidence} (${(aiConfidence/100).toFixed(1)}%) — ${aiReasoning}`);
  } catch (err: any) {
    console.log(`   AI scoring skipped: ${err.message}`);
  }

  // 6. Insert trade to Supabase
  const tradeId = crypto.randomUUID();
  console.log(`\n6. Inserting trade to Supabase: ${tradeId}`);
  const { error: insertErr } = await sb.from('trades').insert({
    id: tradeId,
    symbol: 'ONDO/USDT',
    direction: setup.direction,
    entry: curPrice,
    sl_init: setup.sl,
    sl: setup.sl,
    tp: setup.tp,
    rr: 2.0,
    risk: 10,
    status: 'open',
    is_paper: true,
    exchange_type: 'swap',
    be_armed: false,
    bars_held: 0,
    opened_at: new Date().toISOString(),
    user_id: '00000000-0000-0000-0000-000000000000',
    ai_confidence: aiConfidence,
    ai_reasoning: aiReasoning,
  });
  if (insertErr) {
    console.log(`   Supabase insert ERROR: ${insertErr.message}`);
  } else {
    console.log(`   Trade inserted: ${tradeId}`);
  }

  // 8. Log to Mantle contract
  console.log('\n7. Logging to Mantle contract...');
  const txHash = await logDecisionOnChain({
    symbol: 'ONDO/USDT',
    action: 'open',
    entry: curPrice,
    sl: setup.sl!,
    tp: setup.tp!,
    direction: setup.direction!,
    tradeId,
    aiConfidence,
  });

  if (txHash) {
    console.log(`   ✅ TX: ${txHash}`);
    console.log(`   Explorer: https://explorer.mantle.xyz/tx/${txHash}`);

    // Update trade with tx hash
    await sb.from('trades').update({
      mantle_tx_hash: txHash,
      is_on_chain: true,
      mantle_logged_at: new Date().toISOString(),
    }).eq('id', tradeId);
    console.log('   Trade updated with tx hash');
  } else {
    console.log('   ❌ Mantle write failed — check wallet balance/gas');
  }

  // 9. Verify contract
  if (txHash) {
    console.log('\n8. Verifying on-chain...');
    const provider = new (await import('ethers')).ethers.JsonRpcProvider('https://rpc.mantle.xyz');
    const count = await provider.call({
      to: process.env.AGENT_TRADE_REGISTRY_ADDRESS,
      data: '0xe4ff19da', // getDecisionCount()
    });
    console.log(`   Contract decision count: ${parseInt(count, 16)}`);
  }

  console.log('\n=== E2E Test Complete ===');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
