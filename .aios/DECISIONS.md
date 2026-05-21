# SignalDeck — Key Technical Decisions
## Generated: 2026-05-19 | AIOS v1

### D-001: Strategy TP vs recalculated TP
**Decision:** Live bot uses setup.tp (strategy's TP from FVG gap price), not recalculated from curPrice.
**Why:** User explicitly asked to match backtest behavior. Backtester uses strategy TP.
**Tradeoff:** If fill price differs significantly from gap price, RR ratio deviates from target.
**Commit:** 3a76003

### D-002: Trailing stop in live bot
**Decision:** Added TRAIL_LEVELS to live bot, exported from backtester.ts to keep them in sync.
**Why:** Backtest showed trailing stops significantly improved net R (+317R vs +169R). Live bot was missing this.
**Commit:** ae4cf46

### D-003: Realistic backtester overhaul
**Decision:** Non-compounding default, fees, slippage, conservative intrabar, lookahead prevention, delayed trail, Monte Carlo, dual mode (ideal/realistic).
**Why:** Previous backtest showed 98x returns. User wanted realistic simulation that can't be fooled.
**Commit:** 373316f

### D-004: Replay validator with data hygiene
**Decision:** Three-tier filtering — sanity pre-check (±2% candle range), future signal detection, stale data exclusion.
**Why:** Replay was showing 30-40% entry deltas from testnet/synthetic trades mixed with live Bybit candles.
**Commits:** 1ce11f7, af6b502, 5ca1ac3

### D-005: Fire-and-forget Mantle writes (F-003)
**Decision:** All on-chain writes wrapped in fireAndForget() — never block trade execution.
**Why:** A failed Mantle transaction must never prevent or delay a trade. Side effects don't block core loop.
**Commit:** d0c1e9e

### D-006: AES-256 API key encryption
**Decision:** Bybit API keys encrypted at rest in Supabase using ENCRYPTION_SECRET.
**Why:** Security requirement for storing exchange credentials in cloud DB.
**Risk:** ENCRYPTION_SECRET must never be leaked or lost.

### D-007: Multi-user bot architecture
**Decision:** activeBots Map keyed by user_id, one SMCBot instance per user.
**Why:** Hackathon requirement for multi-tenant dashboard. Each user gets isolated bot instance with own API keys.
**Risk:** Duplicate bot instances (fixed via activeBots.has() guard, commit b55e7fe).

### D-008: On-chain history via event logs
**Decision:** getAgentOnChainHistory() uses DecisionLogged event logs with eth_getLogs, not block-by-block scanning.
**Why:** Block scanning was limited to 500 blocks (~16 min) and missed contract calls. Event logs are efficient and precise.
**Commit:** 26763af

### D-009: Symbol normalization for OHLCV
**Decision:** Strip :USDT suffix from swap symbols before fetching OHLCV from Bybit.
**Why:** Bybit OHLCV endpoint uses spot symbols (BTC/USDT), but bot trades swaps (BTC/USDT:USDT).
**Risk:** Symbol format mismatch can silently return wrong data (F-002).

### D-010: UTC-only timestamps
**Decision:** All timestamps are UTC. Daily loss halt resets at UTC midnight. Session filter uses UTC hours.
**Why:** Avoids timezone confusion. Trading sessions are defined in UTC (London = 7-12 UTC, NY AM = 12-17 UTC).
