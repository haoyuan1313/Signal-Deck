# SignalDeck — Architecture
## Generated: 2026-05-19 | AIOS v1

### Deployment topology
```
Vercel (Frontend)                    Fly.io (Backend)
┌──────────────────────┐           ┌──────────────────────┐
│ Static SPA build      │  /api/*  │ Express server        │
│ React + Tailwind      │─────────▶│ + botEngine loop      │
│ Zustand store         │  rewrite │ + Mantle wallet       │
│ Supabase Realtime     │           │ + Claude API calls    │
└──────────────────────┘           └──────────┬───────────┘
       │                                      │
       │ Supabase client (anon key)           │ Supabase (service role)
       ▼                                      ▼
┌──────────────────────────────────────────────────┐
│              Supabase (PostgreSQL)                │
│  Tables: trades, signals_log, bot_settings,       │
│          bot_execution_logs, bot_heartbeat,       │
│          user_api_keys, system_users,             │
│          telegram_config                          │
└──────────────────────────────────────────────────┘
```

### Data flow for a trade
```
1. botEngine loop (60s tick)
   └─ fetchOHLCV() from Bybit
   └─ detectSMCSetup() → strategy.ts
   └─ scoreAIConfidence() → Claude API
   └─ executeTrade()
      ├─ createOrder() → Bybit (live/paper)
      ├─ insert into trades table → Supabase
      ├─ fireAndForget → logDecisionOnChain() → Mantle
      └─ notifyTelegram()
   └─ manageOpenTrades()
      ├─ Check TP/SL/Timeout/Stagnation
      ├─ Update break-even / trailing stop
      └─ On close: update trade, fireAndForget mantle log
```

### Auth chain
```
main.tsx fetch interceptor (Bearer token)
  → AuthGate (setup/login/register UI)
    → AppInner (routes)
      → Optional: PasswordGuard (VITE_MASTER_PASSWORD)
```

### State flow
```
useStore (Zustand)
├─ fetchInitialData() → Supabase (trades, signals, logs, settings, heartbeat)
├─ useRealtime() → Supabase subscriptions + price polling (10s)
├─ updatePrices() → pushed by useRealtime
└─ Pages subscribe to slices: trades, signals, logs, settings, prices, botLive
```

### Key design patterns
1. **Fire-and-forget (F-003):** Mantle writes never block trade execution
2. **Retry queue:** 3 attempts, 60s apart, dead-letter after exhaustion
3. **AES-256 encryption:** API keys encrypted at rest in Supabase
4. **Multi-user:** activeBots Map, one SMCBot per user_id
5. **Non-blocking AI:** Claude scoring failure → fallback to deterministic
6. **ETL bias:** All timestamps UTC, all prices normal decimal, no on-chain 1e8 mixing

### Database schema (key columns)
- `trades`: symbol, direction, entry, sl_init, sl, tp, exit_price, r, status, is_paper, is_on_chain, mantle_tx_hash, ai_confidence, opened_at, closed_at, user_id
- `user_api_keys`: bybit_api_key_enc, bybit_api_secret_enc, bybit_testnet, account_type, is_active, user_id
- `bot_settings`: symbols[], timeframe, htf_timeframe, rr, risk_percent, paper_trading, paused, allowed_sessions[], user_id
