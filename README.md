# SignalDeck

**AI-powered SMC trading agent with verifiable on-chain alpha on Mantle.**

## What it does

SignalDeck runs an SMC (Smart Money Concepts) trading bot that detects Fair Value Gaps on Bybit. Claude scores every trade setup with an AI confidence rating. All decisions — entry, exit, AI score — are logged on-chain via the AgentTradeRegistry contract on Mantle, making every trade verifiable on the explorer.

## Hackathon

**Track:** Alpha & Data — AI-Driven Trading Strategy  
**Live demo:** https://signal-deck-beta.vercel.app

## Deployed Contracts (Mantle Mainnet)

| Contract | Address |
|----------|---------|
| AgentTradeRegistry | `0x0c26e1f25735798CB94E2CC1851adeBfA0276142` |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## Architecture

```
Vercel (React SPA) ─→ Fly.io (Express + botEngine) ─→ Supabase (Postgres)
                                                    ─→ Bybit (ccxt API)
                                                    ─→ Mantle (AgentTradeRegistry + ERC-8004)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design.

## Quick Start

```bash
git clone https://github.com/haoyuan13/Signal-Deck
cd Signal-Deck
npm install
cp .env.example .env
# Fill in required env vars (see below)
npm run dev     # http://localhost:3000
```

## Environment Variables

### Fly.io (runtime)

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase service role key |
| `ENCRYPTION_SECRET` | Yes | AES-256 key for API key encryption |
| `ANTHROPIC_API_KEY` | Yes | Claude API (AI analyst + trade scoring) |
| `MANTLE_PRIVATE_KEY` | Yes | Mantle wallet private key (never logged) |
| `MANTLE_MAINNET` | No | `true` for mainnet, default testnet |
| `AGENT_TRADE_REGISTRY_ADDRESS` | No | Deployed contract (default hardcoded) |
| `ERC8004_IDENTITY_REGISTRY` | No | ERC-8004 identity (default hardcoded) |
| `ERC8004_REPUTATION_REGISTRY` | No | ERC-8004 reputation (default hardcoded) |
| `BYBIT_API_KEY` | No | Default exchange credentials |
| `BYBIT_API_SECRET` | No | Default exchange secret |
| `BYBIT_DEFAULT_TYPE` | No | `spot` or `swap` (default `spot`) |
| `BYBIT_TESTNET` | No | `true` for testnet |
| `TELEGRAM_BOT_TOKEN` | No | Trade notifications via Telegram |
| `TELEGRAM_CHAT_ID` | No | Notification target chat ID |
| `PORT` | No | Server port (default 3000) |

### Vercel (build-time)

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (public) |

## How the bot works

1. Scans symbols every 60s using SMC strategy (FVG + HTF trend detection)
2. Claude scores valid setups with AI confidence (0–100%)
3. Executes paper or live trades on Bybit via ccxt
4. Logs every decision on-chain via `AgentTradeRegistry.logDecision()`
5. Retry queue handles failed Mantle writes (3 attempts, 60s apart)
6. ERC-8004 NFT proves agent identity on-chain
7. Telegram notifications on trade open/close

Bot starts automatically on server boot. Connect API keys in **Settings → Config → API Keys**. Connect Mantle wallet in **Settings → Config → Mantle Connection**.
