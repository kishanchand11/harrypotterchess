# Audit #4 — 3-iteration deep audit of the full post-indexer codebase

Scope: indexer, session, registry, history, alerts, watchlist/scan/profile APIs, UI panels —
fresh-eyes pass each iteration, fix + strict typecheck each iteration, full runtime regression at the end.
Baseline: `cd464d0`, strict-tsc clean, 16/16 indexer invariants green.

## Iteration 1 — correctness & memory (6 fixes)

| # | Severity | Module | Bug | Fix |
|---|----------|--------|-----|-----|
| 1 | **HIGH — memory leak** | `session.ts` | Cross-source dedupe keys (`tx\|wallet\|side`) were added to `seenOrder` but eviction only cleaned `seenTradeIds` → `seenSwapKeys` grew unbounded (~25MB/day at load) | Eviction deletes from both sets |
| 2 | **HIGH — churn** | `registry.ts` | `MAX_SESSIONS=6` + a >6-token watchlist → evict() pass-3 killed the oldest keep-alive session on *every* new session → background tracking thrashed | Cap raised to 12; pass-3 remains last-resort |
| 3 | **MED — double-count** | `indexer.ts` | Checkpoint with `cursor==0` + balances would restore balances then re-apply all events from scratch (double-credit) | Never restore a cursor==0 checkpoint |
| 4 | **MED — data quality** | `indexer.ts` | LP pools dominate top-holders but were labeled `isContract:false` → UI presented pools as wallets | `holders()` tags pool addresses |
| 5 | LOW | `indexer.ts` | Dead no-op phase line in `rpc()` | Removed |
| 6 | LOW | `api/scan` | Duplicate registry import statements | Merged |

## Iteration 2 — resilience (2 fixes)

| # | Severity | Module | Bug | Fix |
|---|----------|--------|-----|-----|
| 7 | **CRITICAL — permanent death** | `indexer.ts` | One transient post-live RPC failure set `phase="error"` and `poll()`'s top guard then early-returned **forever** — the indexer never recovered from a single hiccup | Poll errors stay in the current phase and retry next tick (endpoint rotation in `rpc()`); "error" now only means "init failed, awaiting session re-init" |
| 8 | **MED** | `session.ts` | A failed indexer `init()` (RPC cold-start hiccup) was never retried → indexer dead for the session's lifetime | `indexerTick` retries `init()` every 60s until ready |

## Iteration 3 — lifecycle & promises (2 fixes)

| # | Severity | Module | Bug | Fix |
|---|----------|--------|-----|-----|
| 9 | **MED** | `session.ts`/`registry.ts` | Starring an *already-analyzed* token didn't promote its live session to keep-alive → it idled out 90s later (watchlist silently lost tracking) | `promoteKeepAlive()` applied in the existing-session branch |
| 10 | **MED** | `session.ts` | Keep-alive (watchlist) sessions died at the 4h interactive MAX_AGE — contradicting the background-tracking promise | Keep-alive sessions live 24h (re-created on next touch); interactive stays 4h |

## Runtime verification (post-fix)

- ✅ 16/16 indexer invariant assertions
- ✅ homepage 200 · invalid session → 400 · session → honest `connecting`
- ✅ watchlist add → new keep-alive session (`bg=true` in scanner); **promotion verified live** (existing session flipped `keepAlive: false → true` without restart)
- ✅ watchlist delete → session stopped (scanner rows drop)
- ✅ tri-state key test honest under blocked host (`blocked`, "key itself may be fine")
- ✅ `/api/profile` 200 · `/api/net` pre-flight accurate
- ✅ strict tsc (`noUnusedLocals/Parameters`) + `next build` green after every iteration

## Totals across all audits (AUDIT.md → AUDIT4.md)

**41 bugs found and fixed** over 12 audit passes, plus 2 test-data bugs caught during verification
(engine behavior confirmed correct in both cases).
