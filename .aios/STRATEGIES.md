# SignalDeck — Design Strategies
## Generated: 2026-05-19 | AIOS v1

### Strategy: SMC FVG + HTF Trend

**Entry signal (detectSMCSetup in strategy.ts):**
1. Scan last 15 5m bars for 3-candle FVG pattern
2. Bullish FVG: c2 bullish, c3.low > c1.high, 1H trend bullish, price in discount zone (bottom 75% of 50-bar range)
3. Bearish FVG: c2 bearish, c3.high < c1.low, 1H trend bearish, price in premium zone (top 75% of 50-bar range)
4. Filters: body between 1.2× and 15× ATR, risk ≥ 0.2× ATR, risk ≥ 0.1% of price
5. Session filter: only allowed UTC sessions (default: London, NY AM, NY PM)
6. HTF alignment: 1H trend required, 4H optional but recommended

**Stop loss:** Nearest structural level from FVG candles (max/min of c1/c2 high/low)

**Take profit:** gap_price + risk × rr × direction_sign (uses strategy TP, not recalculated from fill)

### Trade management (botEngine.ts and backtester.ts share TRAIL_LEVELS)
| Level | Trigger | Action |
|-------|---------|--------|
| Break-even | 1R reached | SL → entry price |
| Trail 1 | 2R reached | SL → entry + risk × 1.0 |
| Trail 2 | 3R reached | SL → entry + risk × 2.0 |
| Timeout | 150 min | Exit at market |
| Stagnation | 75 min + < 0.5R | Exit at market |

### Backtest realism model (from backtester.ts overhaul)
- **Non-compounding mode:** riskAmount = initialCapital × riskPercent/100 (fixed)
- **Fees:** feePercent per entry + exit
- **Slippage:** long entry higher, short entry lower (against trader)
- **Conservative intrabar:** SL triggers before TP if both hit same candle
- **Lookahead prevention:** enter on NEXT bar open, HTF uses only closed candles
- **Delayed trail:** SL updates effective next candle, not same candle
- **Monte Carlo:** 1,000 trade shuffles, risk of ruin at 30% drawdown

### Replay validation strategy (replayValidator.ts)
- Data sanity pre-check: entry must be within ±2% of nearby candle high/low
- Signal search: bars from (opened_at - 90min) to (opened_at), never future
- Future signal bug: if signal time ≥ opened_at → excluded from metrics
- Flag categories: strategy_mismatch, execution_drift, replay_data_bug, missing_candle_data, stale_or_wrong_market_data

### Risk management
- Per-trade risk: risk_percent of balance (default 1.0%)
- Daily loss halt: stops trading when daily loss ≥ 3% (DAILY_LOSS_HALT_PCT)
- Max concurrent positions: MAX_OPEN_POSITIONS (3)
- Paper trading: is_paper flag, controlled via bot_settings

### AI integration (Claude API)
- Called during executeTrade() for confidence scoring
- Non-blocking: failure → confidence = 0 (deterministic fallback)
- Prompt includes on-chain performance context when available
- Scores 0-10000, stored as ai_confidence in trades table

### Mantle integration (mantle.ts)
- Contract-first: AgentTradeRegistry deployed on mainnet
- logDecisionOnChain() called via fireAndForget after every trade open/close
- Self-call calldata fallback when contract address not set
- Retry queue: 3 attempts, 60s interval, dead-letters after exhaustion
- On-chain history: event log scanning via DecisionLogged events
- ERC-8004 NFT: minted via official hackathon contract
