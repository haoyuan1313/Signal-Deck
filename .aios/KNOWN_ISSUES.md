# SignalDeck — Known Issues
## Generated: 2026-05-19 | AIOS v1

### Active bugs

**KI-001: Replay validator can't replay with 100% accuracy**
- Entry price always differs slightly (curPrice vs candle open)
- Live ticker fill ≠ historical candle open, even with perfect alignment
- Expected: ~0.1-0.5% entry delta is normal execution drift
- Severity: Low (by design — ticker fills differ from candle open)

**KI-002: Orphaned page files**
- SettingsPage.tsx, Trades.tsx, Dashboard.tsx are superseded but not deleted
- 7 page files exist that aren't route-mapped
- Severity: Low (no runtime impact)

**KI-003: demo user trades show is_paper=true with mantle_tx_hash**
- Some demo trades have on-chain tx hashes despite being paper trades
- These tx hashes may not exist on Mantle (could be testnet or failed)
- Severity: Low (only affects replay validator data hygiene)

**KI-004: Daily loss halt uses UTC midnight**
- Users in UTC+8 see the bot "still disabled" for 8 extra hours
- Reset is at 00:00 UTC, not local midnight
- Severity: Medium (UX confusion)

### Technical debt

**TD-001: server.ts is 1,873 lines**
- Should be split into route modules (auth, data, mantle, replay, admin)
- Risk: Single-file changes risk merge conflicts, hard to navigate
- Effort: High (affects all routes), medium risk

**TD-002: No shared TRAIL_LEVELS constant between backtester and bot engine**
- Fixed: TRAIL_LEVELS now exported from backtester.ts and imported in botEngine.ts
- But it's in the backtester module; ideally in strategy.ts or constants.ts

**TD-003: Type check has 4 pre-existing errors**
- server.ts: Property 'USDT' does not exist on type 'Balance' (line 1578)
- AuthGate.tsx: Cannot find namespace 'React' (line 67)
- useStore.ts: Cannot find name 'uid' (line 165, 2 occurrences)
- These don't affect Vite build but should be fixed

**TD-004: No test suite**
- Only strategy.test.ts exists (232 lines, partial coverage)
- No tests for botEngine, backtester, mantle, replayValidator, server
- Risk: Regression during refactoring

**TD-005: Contract verification incomplete**
- AgentTradeRegistry deployed but not fully verified on Mantle Explorer
- standard-input.json prepared but not submitted to Blockscout
- Hackathon risk: judges can't read verified source on explorer

### Risk register

**RISK-001: Bot running on Bybit mainnet (CRITICAL)**
- User's API key has bybit_testnet=false, is_active=true
- Real trades executing with real money (~$45 equity remaining)
- User aware of this — explicitly asked not to change to testnet
- Mitigation: daily loss halt (3%), trailing stop added

**RISK-002: Mantle mainnet for test scripts**
- test-trade.mjs defaults to testnet but can write to mainnet with flag
- Requires explicit --mainnet + contract address confirmation
- Severity: Medium (guarded, but still possible)

**RISK-003: No automated backup of Supabase data**
- Trade history, user keys, bot settings could be lost
- Mitigation: supabase-mantle.sql backup exists locally
