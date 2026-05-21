# SignalDeck — Project Digest
## Generated: 2026-05-19 | AIOS v1

### Identity
- **Name:** SignalDeck
- **Type:** SMC crypto trading bot dashboard
- **Target:** Mantle Turing Test Hackathon 2026 (Phase 2: AI Awakening)
- **Track:** AI Trading & Strategy
- **Deadline:** June 15, 2026

### One-line summary
A real-time SMC trading dashboard with AI confidence scoring, on-chain decision verification via Mantle ERC-8004, and a full backtest/replay validation pipeline.

### Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Vite + React 19 + TypeScript + Tailwind v4 + Zustand |
| Backend | Express + Node.js (Fly.io, port 3000) |
| Bot Engine | SMCBot class — multi-user, ccxt/Bybit, 60s loop |
| Database | Supabase (PostgreSQL + Realtime subscriptions) |
| AI | Claude API — trade confidence scoring |
| Blockchain | Mantle Network (chain 5000), ethers.js v6 |
| Contracts | AgentTradeRegistry, ERC-8004 Identity/Reputation |

### Pages (6 routes)
| Route | Component | Status |
|-------|-----------|--------|
| `/` | CommandCenter | KPI, console, signal feed |
| `/agent` | AgentIdentity | Wallet, NFT, on-chain log |
| `/lab` | StrategyLab | Backtest + AI analyst + diagnostics |
| `/replay` | ReplayValidator | Live vs replay comparison |
| `/trades` | TradeHistory | Full trade table |
| `/settings` | Config | Bot config + Mantle + DB |

### Key modules (src/lib/)
| Module | Lines | Role |
|--------|-------|------|
| `backtester.ts` | 842 | Backtest + Walk-Forward + Monte Carlo |
| `mantle.ts` | 675 | Wallet, contract, NFT, retry queue |
| `replayValidator.ts` | 645 | Live vs replay trade comparison |
| `strategy.ts` | 257 | SMC FVG detection + HTF trend |
| `supabase.ts` | 118 | DB client + TypeScript types |
| `constants.ts` | 30 | Shared config, chain IDs, limits |

### Critical runtime files
| File | Lines | Role |
|------|-------|------|
| `server.ts` | 1,873 | All API routes + auth + Mantle |
| `botEngine.ts` | 944 | Trading loop, AI scoring, trail stop |

### Active contracts (Mantle mainnet)
- AgentTradeRegistry: `0x0c26e1f25735798CB94E2CC1851adeBfA0276142`
- ERC-8004 Identity: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8004 Reputation: `0x8004B663056A597Dffe9eCcC1965A193B7388713`

### Agent wallet
`0x8A944164F3e7edA762a28528A59A63261Af63788` (Mantle mainnet, ~10 MNT)

### Orphaned/legacy pages
SettingsPage.tsx → superseded by Config.tsx
Trades.tsx → superseded by TradeHistory.tsx
Dashboard.tsx → superseded by CommandCenter.tsx
ApiKeys.tsx → used as sub-component in Config.tsx
AIAnalyst.tsx, BacktestPage.tsx, SignalDiagnostics.tsx → sub-components in StrategyLab.tsx
