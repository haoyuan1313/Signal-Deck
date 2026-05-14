# SignalDeck — Architecture

## Overview

SignalDeck is an SMC (Smart Money Concepts) crypto trading bot dashboard targeting the Mantle Turing Test Hackathon 2026 (Phase 2: AI Awakening). It combines a real-time trading dashboard with AI-powered strategy analysis and on-chain agent identity verification via Mantle's ERC-8004 NFT standard.

**Stack:** Vite + React 19 + TypeScript + Tailwind CSS v4 + Zustand + Supabase + Express + ccxt + Claude API + ethers.js v6  
**Runtime:** Node.js server (Express, Fly.io) + static SPA frontend (Vercel)  
**Database:** Supabase (PostgreSQL)  
**Exchange:** Bybit (spot + perpetual swaps)  
**Blockchain:** Mantle Network (chain ID 5000)  
**Smart Contract:** AgentTradeRegistry — `0x0c26e1f25735798CB94E2CC1851adeBfA0276142` on Mantle Mainnet

---

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    VERCEL (Frontend)                      │
│  Static SPA build — Vite + React + Tailwind               │
│  Routes: / /agent /lab /trades /settings                  │
│  State: Zustand (useStore)                                │
│  Auth: PasswordGuard → session token → Supabase           │
└────────────┬─────────────────────────────────────────────┘
             │ /api/* rewrites
             ▼
┌──────────────────────────────────────────────────────────┐
│                  FLY.IO (Backend)                         │
│  Express server (server.ts)                               │
│  ├─ Auth: /api/auth/setup, /login, /logout, /me           │
│  ├─ Data: /api/prices, /api/ohlcv, /api/balance           │
│  ├─ OpenClaw: /api/openclaw/* (AI command parser)         │
│  ├─ AI: /api/ai-analyst, /api/ai-admin                    │
│  ├─ Mantle: /api/mantle/status, connect, mint-nft,        │
│  │          history, retry-queue                           │
│  ├─ Admin: /api/admin/bulk-delete                         │
│  └─ Health: /api/health, /api/live-readiness              │
│                                                           │
│  botEngine.ts                                             │
│  ├─ SMCBot class — per-user trading loop                  │
│  ├─ AI confidence scoring via Claude (scoreAIConfidence)  │
│  ├─ Mantle on-chain logging (fireAndForget)               │
│  ├─ Retry queue processing (processRetryQueue)            │
│  ├─ Multi-user bot registry (activeBots Map)              │
│  └─ Lifecycle: startAllUserBots / refreshUserBots         │
└────────────┬─────────────────────────────────────────────┘
             │
      ┌──────┴──────┐
      ▼             ▼
┌──────────────┐ ┌──────────────────────────────────────┐
│   SUPABASE   │ │          MANTLE NETWORK               │
│   (Data)     │ │  AgentTradeRegistry                   │
│              │ │  0x0c26e1f25735798CB94E2CC1851adeBf   │
│  Tables:     │ │   A0276142 (Mainnet)                  │
│  ├─ trades   │ │                                      │
│  │  (mantle_ │ │  logDecision(symbol, action, entry,   │
│  │  tx_hash, │ │    sl, tp, direction, aiConfidence)   │
│  │  is_on_   │ │  → emits DecisionLogged event         │
│  │  chain,   │ │  → returns decisionId                 │
│  │  ai_confi-│ │                                      │
│  │  dence,   │ │  getDecision(0..N) — judge queryable  │
│  │  ai_reas- │ │  getDecisionCount()                   │
│  │  oning)   │ │                                      │
│  ├─ agent_   │ │  ERC-8004 NFT (pending)               │
│  │  identity │ │                                      │
│  └─ mantle_  │ └──────────────────────────────────────┘
│     config   │
└──────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│                   BYBIT (Exchange)                        │
│  ccxt.bybit — spot + perpetual swaps                      │
│  Per-user API keys (AES-256 encrypted in Supabase)        │
│  Operations: fetchTickers, fetchOHLCV, fetchBalance       │
│             createOrder (paper or live)                    │
└──────────────────────────────────────────────────────────┘
```

---

## Frontend — 5-Page Structure

| Route | Page | Purpose |
|-------|------|---------|
| `/` | `CommandCenter` | KPI bar, equity curve, open positions, bot console, signal feed, Mantle status bar |
| `/agent` | `AgentIdentity` | ERC-8004 NFT card, on-chain decision log, cumulative stats, Demo Day fullscreen mode |
| `/lab` | `StrategyLab` | Tab 1: Backtester, Tab 2: AXIOM AI Analyst, Tab 3: Signal diagnostics + protocol selector |
| `/trades` | `TradeHistory` | Full trade table with filters, on-chain tx hash column, slide-over detail panel |
| `/settings` | `Config` | Tab 1: Bot Config, Tab 2: Mantle Connection, Tab 3: Database manager |

### State Management (Zustand)

`src/store/useStore.ts` — single store with slices:
- **trades/signals/logs** — fetched from Supabase, polled every 30s
- **settings** — bot configuration, persisted from Supabase
- **prices** — real-time price map (symbol → price), pushed from server
- **botLive/heartbeat** — bot liveness derived from bot_heartbeat table
- **auth** — session token, username, logout function
- **fullHistoryLoaded** — lazy-load flag for trade history page

### Data Flow

```
1. User loads page → AuthGate checks /api/auth/me
2. useStore.fetchInitialData() → Supabase queries (settings, trades, signals, logs)
3. useRealtime hook → polling /api/prices every 3s for live prices
4. Bot console auto-refreshes every 5s
5. User actions (save settings, pause bot) → PUT/POST to Supabase via API
```

---

## Backend — Express Server

### Route Map

```
Auth:
  GET    /api/auth/status          — check if system user exists
  POST   /api/auth/setup           — create initial account
  POST   /api/auth/login           — authenticate, return session token
  POST   /api/auth/logout          — clear session
  GET    /api/auth/me              — validate session token

Market Data:
  GET    /api/prices               — fetch current prices for symbols
  GET    /api/ohlcv                — fetch OHLCV candles for backtesting
  GET    /api/balance              — fetch Bybit account balance
  POST   /api/walkforward          — run walk-forward validation

OpenClaw (AI Command Parser):
  POST   /api/openclaw/parse       — Claude parses NL → structured command
  POST   /api/openclaw/execute     — execute validated command
  GET    /api/openclaw/candidates  — top-volume symbols for screener
  GET    /api/openclaw/recommendations — screener results
  POST   /api/openclaw/recommendations/:id/approve — apply top 3
  POST   /api/openclaw/recommendations/:id/reject  — dismiss
  GET    /api/openclaw/autopilot   — get autopilot state
  POST   /api/openclaw/autopilot   — update autopilot config
  POST   /api/openclaw/run-screener — trigger screener manually

AI:
  POST   /api/ai-analyst           — Claude: strategy analysis
  POST   /api/ai-admin             — Claude: database audit

Mantle (on-chain agent identity):
  GET    /api/mantle/status        — wallet info, NFT status, retry queue
  POST   /api/mantle/connect       — connect Mantle wallet (private key, never logged)
  POST   /api/mantle/mint-nft      — mint ERC-8004 agent identity NFT
  GET    /api/mantle/history       — agent on-chain decision history
  GET    /api/mantle/retry-queue   — pending retry entries

Admin:
  POST   /api/admin/bulk-delete    — delete trades by ID array

Infra:
  GET    /api/health               — exchange status + markets loaded
  GET    /api/ping                 — connectivity check
  GET    /api/live-readiness       — pre-flight checks for live trading
  GET    /api/db-debug             — Supabase credential check
  GET    /api/telegram-config      — get telegram state
  POST   /api/telegram-config      — save telegram config
  POST   /api/test-telegram        — send test notification

User API Keys:
  GET    /api/user/api-keys        — list keys (hints only, no secrets)
  POST   /api/user/api-keys        — save new encrypted key
  POST   /api/user/api-keys/:id/test — test key connectivity
  PATCH  /api/user/api-keys/:id    — toggle active
  DELETE /api/user/api-keys/:id    — remove key
```

### Key Design Decisions

- **API keys encrypted at rest:** Bybit API keys/secrets are AES-256-CBC encrypted with ENCRYPTION_SECRET before storing in Supabase `user_api_keys`. Decryption happens only server-side.
- **Session auth:** Simple session token model. Single user system. 14-day TTL. Stored in `system_users.session_token`.
- **Public fallback:** If user's API key is invalid (10003/10004), prices and candles fall back to the server's public exchange instance.
- **Screener lock:** Global mutex (`SCREENER_LOCK`) prevents concurrent screener runs.
- **Mantle wallet:** Connected via POST /api/mantle/connect. Private key held only in ethers.Wallet memory — never logged, never stored in Supabase. Auto-connects on startup if MANTLE_PRIVATE_KEY env var is set.

---

## Bot Engine (`botEngine.ts`)

### SMCBot Lifecycle

```
┌──────────────────┐
│  init()          │  Load settings, load markets, validate symbols
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  runLoop()       │  Fires every 60s
│  For each symbol:│
│  1. Fetch OHLCV   │
│  2. detectSMCSetup│  ← strategy.ts: FVG detection + HTF trend analysis
│  3. Validate setup│  (ATR, session, direction, 4H alignment)
│  4. Check limits  │  (max positions, daily loss, concurrent)
│  5. AI scoring    │  ← scoreAIConfidence(): Claude evaluates setup → 0-10000
│  6. Calculate size│  (risk_percent × equity / stop distance)
│  7. executeTrade  │  → open position (paper or live via ccxt)
│  8. Mantle log    │  → fireAndForget(logDecisionOnChain) — non-blocking (F-003)
│  9. manageTrades  │  → check SL/TP/BE, close if hit
│ 10. Mantle close  │  → fireAndForget(logDecisionOnChain) on trade close
│ 11. processRetryQ │  → retry failed Mantle writes (3 attempts, 60s apart)
│ 12. updateHeartbeat│
└──────────────────┘
```

### AI Confidence Scoring

- `scoreAIConfidence(setup, symbol)` — calls Claude with setup details
- Prompt includes: symbol, direction, entry, SL, TP, HTF trend, session, ATR
- Claude returns JSON: `{"confidence": <0-10000>, "reasoning": "<one sentence>"}`
- Non-blocking — if Claude fails, returns `{confidence: 0}` (deterministic SMC fallback)
- Score written on-chain via `logDecision(aiConfidence)` → contract stores it

### Multi-User Architecture

- `activeBots: Map<string, SMCBot>` — one bot instance per user
- `startAllUserBots()` — called on server start, finds all active API keys
- `refreshUserBots()` — called every 5 minutes and after key changes
- Each bot has its own exchange connection, settings, and loop interval

### Autopilot

- Runs every 5 minutes (via setInterval in server.ts)
- Queries `openclaw_autopilot` for enabled/interval config
- Discovers top-volume symbols, runs backtest screener on them
- Proposes top 3 via `openclaw_recommendations` table
- Telegram notification if new top 3 differs from current watchlist

---

## Strategy Engine (`src/lib/strategy.ts`)

SMC (Smart Money Concepts) trade detection:

1. **FVG Detection** — identifies Fair Value Gaps (imbalance zones) on the execution timeframe
2. **HTF Trend Analysis** — determines higher timeframe trend (1H/4H) using EMA + structure
3. **Displacement Confirmation** — validates the sweep/displacement pattern
4. **Session Filtering** — restricts entries to Asian/London/NY sessions
5. **ATR-based sizing** — stop loss distance scaled by ATR

Output: `StrategySetup` with direction, entry, SL, TP, RR, reason.

---

## Backtester (`src/lib/backtester.ts`)

Walk-Forward validation engine:

- `runBacktest(ohlcv, options)` — single-pass backtest with full trade simulation
- `runWalkForward(ohlcv, options, numWindows)` — multi-window walk-forward analysis
- Output: `BacktestResult` with trades[], winRate, profitFactor, equity curve, drawdown

---

## Mantle Integration (`src/lib/mantle.ts`)

### Smart Contract: AgentTradeRegistry

- **Deployed:** `0x0c26e1f25735798CB94E2CC1851adeBfA0276142` on Mantle Mainnet (chain 5000)
- **Explorer:** https://explorer.mantle.xyz/address/0x0c26e1f25735798CB94E2CC1851adeBfA0276142
- **Sourcify:** partial verification (bytecode match confirmed)

### Contract Interface

```
logDecision(symbol, action, entry, sl, tp, direction, aiConfidence) → decisionId
getDecisionCount() → uint256
getDecision(id) → TradeDecision struct
getDecisionsPaginated(offset, limit) → (TradeDecision[], total)
```

Each `TradeDecision` stored on-chain contains: symbol, action, entry/sl/tp prices (×1e8), direction, AI confidence score (0-10000), and block timestamp.

Every decision emits a `DecisionLogged` event visible on Mantle Explorer.

### Module Architecture

```
connectMantle(privateKey)       → ethers.Wallet
initMantleFromEnv()             → Wallet | null (from MANTLE_PRIVATE_KEY)
isMantleConnected()             → boolean
getMantleAddress()              → string | null
logDecisionOnChain(decision)    → txHash | null
  Prefers: deployed AgentTradeRegistry contract
  Fallback: self-call with ABI-encoded calldata
fireAndForget(fn, label)        → void (never throws)
processRetryQueue()             → retryCount
  Max 3 attempts, 60s between retries
  Dead-letters exhausted entries
mintAgentNFT(metadata)          → { tokenId, txHash }
getAgentOnChainHistory(addr, N) → AgentOnChainRecord[]
getMantleWalletInfo()           → wallet metadata
getTxExplorerUrl(txHash)        → explorer link
```

### Design Rules

- **F-003 enforced:** `fireAndForget` wraps all Mantle writes — never blocks trade execution
- **Private key:** held in process memory only. Never logged, never stored in Supabase
- **Retry queue:** failed writes retry 3 times with 60s intervals, then dead-letter
- **Self-call fallback:** if no contract address configured, logs decisions as calldata in 0-value self-transfers

### Integration Points

1. **Config → Mantle Connection tab:** wallet address display, connect button, mint NFT
2. **Agent Identity page:** NFT metadata, on-chain decision history feed
3. **botEngine.ts → executeTrade():** `fireAndForget(logDecisionOnChain)` after each trade
4. **botEngine.ts → manageOpenTrades():** `fireAndForget(logDecisionOnChain)` on trade close
5. **botEngine.ts → runLoop():** `processRetryQueue()` every iteration
6. **Supabase trades table:** `mantle_tx_hash`, `is_on_chain`, `mantle_block`, `mantle_logged_at`, `ai_confidence`, `ai_reasoning` columns

---

## Deployment

| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend | Vercel | Static SPA, `vite build` |
| Backend | Fly.io | Express server, `tsx server.ts` |
| Database | Supabase | PostgreSQL with RLS |
| Smart Contract | Mantle Mainnet | AgentTradeRegistry @ 0x0c26...6142 |
| API Proxy | vercel.json rewrites | `/api/*` → `signal-deck.fly.dev/api/*` |

### Environment Variables

**Vercel (build-time, VITE_ prefix):**
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key (public)

**Fly.io (runtime):**
- `SUPABASE_URL`, `SUPABASE_KEY` — Supabase service role
- `SUPABASE_SERVICE_ROLE_KEY` — alternative service key
- `BYBIT_API_KEY`, `BYBIT_API_SECRET` — default exchange credentials (optional)
- `BYBIT_DEFAULT_TYPE` — "spot" or "swap"
- `BYBIT_TESTNET` — "true" for testnet
- `BYBIT_HOSTNAME` — custom hostname (optional)
- `ANTHROPIC_API_KEY` — Claude API (for AI Analyst + OpenClaw + AI scoring)
- `ANTHROPIC_MODEL` — model ID (default: claude-sonnet-4-20250514)
- `ENCRYPTION_SECRET` — AES-256 key for API key encryption
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — notification config
- `MANTLE_PRIVATE_KEY` — Mantle wallet private key (never logged)
- `MANTLE_MAINNET` — "true" for mainnet, default: testnet
- `AGENT_TRADE_REGISTRY_ADDRESS` — deployed contract address
- `ERC8004_CONTRACT_ADDRESS` — ERC-8004 NFT contract (TBD)
- `PORT` — server port (default 3000)

---

## Key Libraries

| Package | Purpose |
|---------|---------|
| `react` / `react-dom` ^19 | UI framework |
| `react-router-dom` ^7 | Client-side routing |
| `zustand` ^5 | State management |
| `tailwindcss` / `@tailwindcss/vite` ^4 | CSS framework |
| `motion` / `framer-motion` | Animations |
| `recharts` | Charts (equity curve, pie chart) |
| `lucide-react` | Icons |
| `@supabase/supabase-js` | Database client |
| `ccxt` | Exchange API (Bybit) |
| `express` | HTTP server |
| `ethers` ^6 | Mantle blockchain integration |
| `solc` ^0.8.20 | Solidity compiler (dev) |

---

## File Map

```
Signal-Deck/
├── server.ts                — Express backend
├── botEngine.ts             — SMCBot trading loop + AI scoring + Mantle logging
├── vite.config.ts           — Vite + Tailwind config
├── vercel.json              — API proxy rewrites
├── hardhat.config.js        — Hardhat config (Mantle mainnet + testnet)
├── package.json
│
├── contracts/
│   ├── AgentTradeRegistry.sol    — On-chain trade decision registry
│   ├── AgentTradeRegistry.bin    — Compiled bytecode
│   └── standard-input.json       — For Explorer contract verification
│
├── scripts/
│   ├── deploy.mjs           — Contract deployment script (ethers.js)
│   └── test-e2e.ts          — End-to-end test (strategy → AI → Mantle)
│
├── src/
│   ├── App.tsx              — Router + sidebar + layout
│   ├── main.tsx             — React entry point
│   ├── index.css            — Global styles + Tailwind
│   │
│   ├── pages/
│   │   ├── CommandCenter.tsx  — Main dashboard (KPI, positions, console)
│   │   ├── AgentIdentity.tsx  — ERC-8004 NFT + on-chain log (TO BUILD)
│   │   ├── StrategyLab.tsx    — Backtest + AI + diagnostics tabs
│   │   ├── TradeHistory.tsx   — Trade table + slide-over detail
│   │   ├── Config.tsx         — Bot settings + Mantle + DB tabs
│   │   ├── BacktestPage.tsx   — Backtest engine UI
│   │   ├── AIAnalyst.tsx      — AXIOM AI strategy analysis
│   │   ├── SignalDiagnostics.tsx — Signal filter pie chart
│   │   ├── ApiKeys.tsx        — Bybit API key management
│   │   └── SettingsPage.tsx   — (legacy, merged into Config)
│   │
│   ├── components/
│   │   ├── AuthGate.tsx       — Password-protected route guard
│   │   ├── PasswordGuard.tsx  — Per-page password gate
│   │   ├── BalanceIndicator.tsx — Account equity display
│   │   ├── ErrorBoundary.tsx  — React error boundary
│   │   └── Skeleton.tsx       — Loading skeleton components
│   │
│   ├── hooks/
│   │   ├── useRealtime.ts     — Price polling (3s interval)
│   │   └── useUser.ts         — Auth state + session management
│   │
│   ├── store/
│   │   └── useStore.ts        — Zustand global state
│   │
│   ├── lib/
│   │   ├── strategy.ts        — SMC FVG detection + HTF analysis
│   │   ├── backtester.ts      — Backtest + Walk-Forward engine
│   │   ├── mantle.ts          — Mantle integration (contract + wallet + retry)
│   │   ├── supabase.ts        — Supabase client + types
│   │   ├── constants.ts       — Shared constants + Mantle config + contract address
│   │   ├── utils.ts           — Formatting helpers (R, currency, dates)
│   │   └── openclawSchema.ts  — OpenClaw command Zod schemas
│   │
│   └── services/
│       └── aiAdminService.ts  — AI-powered trade cleanup service
```

---

## Known Bugs & Edge Cases

| Issue | Location | Status |
|-------|----------|--------|
| Symbol format mismatch (spot vs swap) | `/api/prices` → symbolMap | Fixed — uses user account type for resolution |
| Auth redirect loop on Zustand hydration | `AuthGate.tsx` | Guarded by `_hasHydrated` check |
| Daily loss calculation includes paper trades | `botEngine.ts` `checkDailyLoss()` | Fixed — filters by `is_paper` |
| Preview deploys missing Supabase env vars | Vercel env config | VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY must be added to Preview environment |
| AI scoring JSON parse failure | `botEngine.ts` `scoreAIConfidence()` | Non-blocking — falls back to aiConfidence=0 on parse error (F-003) |
| Explorer API intermittent 502 | Mantle Explorer | TX verification via RPC as fallback |
| Contract partial verification only | Sourcify | Metadata hash mismatch — manual verification via standard-input.json needed for full Explorer verification |

---

## Hackathon Checklist

- [x] Smart contract deployed on Mantle Mainnet
- [ ] Contract fully verified on Mantle Explorer
- [x] AI-powered function callable on-chain (aiConfidence in logDecision)
- [x] Frontend demo publicly accessible
- [ ] Deployment address in DoraHacks submission
- [ ] Demo video (≥ 2 min)
- [ ] README with setup instructions + architecture + contract address
- [ ] ERC-8004 NFT minted
- [ ] AgentIdentity page built
- [ ] Mantle on-chain data as core data source
