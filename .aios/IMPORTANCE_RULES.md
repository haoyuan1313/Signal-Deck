# SignalDeck — Importance Rules
## Generated: 2026-05-19 | AIOS v1

### Critical files — treat with extreme care

| File | Why |
|------|-----|
| `botEngine.ts` | Live trading loop. Bugs here cost real money. |
| `server.ts` | All API routes + auth. Breaking change = all endpoints down. |
| `src/lib/supabase.ts` | DB schema types. Wrong type = data corruption. |
| `src/lib/mantle.ts` | Manages Mantle private key. Secret leak = wallet drained. |
| `src/lib/constants.ts` | Shared config. Changing limits affects both bot and backtest. |

### High-impact files

| File | Why |
|------|-----|
| `src/lib/backtester.ts` | Core simulation engine. All strategy evaluation depends on it. |
| `src/lib/replayValidator.ts` | Live vs replay comparison. Accuracy metrics depend on it. |
| `src/lib/strategy.ts` | Entry signal logic. Changes affect bot, backtest, and replay. |
| `src/store/useStore.ts` | Global state hub. Breaking change = all pages affected. |

### Design patterns to preserve

1. **Fire-and-forget (F-003):** Never block trade execution on side effects (Mantle, Telegram, logs)
2. **UTC-only timestamps:** No local timezone conversion anywhere
3. **Normal decimal prices:** Never mix on-chain 1e8 integers with exchange prices
4. **Non-blocking AI:** Claude scoring failure → confidence = 0 (fallback)
5. **Retry queue pattern:** 3 attempts, 60s apart, dead-letter after exhaustion

### Dangerous operations

- **Modifying executeTrade()** — touches real Bybit orders. Test with paper_trading=true first.
- **Modifying AES encryption/decryption** — can make all stored API keys unrecoverable.
- **Adding database columns** — must not break Supabase RLS policies.
- **Modifying trailing stop logic** — must stay in sync between botEngine and backtester.
- **Changing RR/TRAIL_LEVELS** — affects both live bot and backtest; change in one place (backtester.ts).

### When editing, check:
1. Does this change affect the trading loop? → Test with paper_trading=true.
2. Does this change affect the Mantle contract? → Test on testnet first.
3. Does this change affect Supabase queries? → Check RLS policies.
4. Does this change affect the backtester? → Run a comparison backtest.
5. Does this change affect the replay validator? → Re-run validation.

### What NOT to do:
- Never log Mantle private key or ENCRYPTION_SECRET
- Never hardcode API keys or secrets (F-001: silent failures)
- Never add blocking I/O inside executeTrade() (F-003)
- Never mix on-chain 1e8 prices with exchange decimal prices
- Never use BYBIT_TESTNET=false for development
- Never skip Supabase RLS when adding columns
