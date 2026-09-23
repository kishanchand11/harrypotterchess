# Code Audit — 3 Full Iterations

Scope: every module in `src/engine/**`, `src/app/api/**`, `src/store/**`, `src/hooks/**`,
`src/lib/**`, `src/components/**`, plus build/deploy config. Method per iteration:
line-by-line read → reasoning over invariants → fix → `tsc --noEmit
--noUnusedLocals --noUnusedParameters` → `next build` → runtime stress test
(SSE stream parsed, invariant assertions over 35–75s sessions).

## Iteration 1 — engine core & providers (7 bugs)

| # | Severity | Module | Bug | Fix |
|---|----------|--------|-----|-----|
| 1 | **CRITICAL** | `session.ts` | **Duplicate swap ingestion in live mode**: GeckoTerminal `/trades` returns the most-recent-N swaps; the 3s poll re-delivered them and `ingest()` had no dedupe → wallet ledger, flow, clusters and impact all double-counted every swap | Bounded `seenTradeIds` set (5k cap, FIFO eviction) in the single ingestion path; all sources now deduped uniformly |
| 2 | **HIGH** | `dexscreener.ts` | Token identity/price taken from the deepest pair **even when the analyzed token was the quote** → wrong symbol and another token's price in `TokenMeta`/`PairNode` | Restrict discovery to pairs where the token is the base; return `null` otherwise (analyzer can't track quote-only tokens) |
| 3 | **HIGH** | `Dockerfile` | `ENV NODE_ENV=production` before `npm ci` → npm skipped devDependencies → `next build` failed (typescript/tailwind missing) | `npm ci --include=dev`; NODE_ENV set after build |
| 4 | **MED** | `api/stream` | Heartbeat interval leaked when the session stopped server-side; session bus listener leaked on broken pipe | `shutdown()` clears heartbeat + unsubscribes on `stopped`, enqueue failure and client abort |
| 5 | **MED** | `impact.ts` | Attribution window grew unbounded if price ticks stalled (provider outage) | 2,000-entry cap with splice |
| 6 | **MED** | `useStream.ts` | Session auto-recreate (server restart) dropped the user's BYO keys header | `keysHeaders(loadKeys())` on the recreate POST |
| 7 | **LOW** | `sim.ts` | Dead code (`addr` fn + `void addr`) | Removed |

## Iteration 2 — analytics logic, UI, API (10 bugs)

| # | Severity | Module | Bug | Fix |
|---|----------|--------|-----|-----|
| 8 | **HIGH** | `wallets.ts` | `sniper` wallet class **never assigned** — `snipedAt` was computed but never surfaced; the 🎯 UI filter could never match | `snipedAt` added to `WalletSummary`; label `Early Sniper`; classify rule → `klass: "sniper"` |
| 9 | **HIGH** | `Dashboard.tsx` | ⚙ **"Save & apply" dropped pasted keys**: session-recreate POST sent no keys header → `resolveKeys` fell back to env keys, silently discarding user input | Header attached; keys now apply to the live session immediately |
| 10 | **MED** | `wallets.ts` | Wallets with **no round-trip record** received free 0.5 win-rate credit (score inflation) | Unknown record → uncertainty discount (0.5 × 0.4) |
| 11 | **MED** | `session.ts` | Sessions created but **never streamed** ran pollers for the full 4h MAX_AGE (provider-quota burn) — idle clock only started after first unsubscribe | `lastSubscriberLeftAt` initialized at start; 90s idle grace applies from creation |
| 12 | **MED** | `sniper.ts` | Radar enrichment re-looked-up unresolvable tokens **every 30s forever** (6 lookups/poll) | Per-token attempt cap (2) + 30s TTL |
| 13 | **MED** | `etherscan.ts` | `esPing` classified HTTP 4xx as "network blocked" (misleading diagnostics) | Status-aware error detail (`key rejected` vs `cannot reach`) |
| 14 | **MED** | `PriceChart.tsx` | Trade markers with `ts` beyond the last tick drew into the price-axis gutter | `x()` clamped to the plot |
| 15 | **MED** | `PriceChart.tsx` | Pressure histogram was O(ticks × trades) per redraw (216k ops worst case) | Two-pointer sliding window, O(T + N) |
| 16 | **LOW** | `PairGraphView.tsx` | `key={p.address}` could collide (same pair listed under two DEX labels) → React duplicate-key warnings | Composite `address-index` key |
| 17 | **LOW** | `impact.ts` | Dead field `priceAtWindowStart` | Removed |

## Iteration 3 — full re-audit + runtime verification (5 findings)

| # | Severity | Module | Bug | Fix |
|---|----------|--------|-----|-----|
| 18 | **MED** | `sim.ts` | Demo never exercised the sniper pipeline: pool was created 47min pre-session, so no trade could land in the 30min snipe window (`sniped: 0` in stress test) | Pool = fresh launch (15min); one-time launch-snipe bundles emitted as real trades (shared tx hashes also exercise bundle detection) |
| 19 | **LOW** | 5 files | Dead locals: unused `res` binding, unused imports (`fmtUsd` ×2), unused `sessionStart`/`price` bindings | Cleaned; `tsc --noUnusedLocals --noUnusedParameters` now passes strict-clean |
| 20 | **LOW** | `package.json` | `npm run lint` referenced eslint that isn't installed | Script removed |
| 21 | note | `registry.ts` | A session stopped mid-discovery may complete `start()` once more, then self-stops within the 90s idle grace — wasted work, self-healing | Accepted (documented) |
| 22 | note | `api/*` | Sessions are address-keyed and not owner-scoped — acceptable for a single-user/self-hosted tool; not addressed | Documented |

## Runtime invariants verified (post-fix stress tests)

- ✅ streamed trade ids **141/141 unique** (dedupe)
- ✅ wallet ledger never exceeds ingested count (no double-count)
- ✅ zero NaN/±Inf anywhere in snapshot JSON (deep walk)
- ✅ impact attribution: 48/48 wallets; timing scores within [-1, 1]; scores within [0, 100]
- ✅ sniper pipeline: 39 wallets `snipedAt` → `klass: "sniper"` + `Early Sniper` label
- ✅ bundle detection (`Bundled` labels), SNIPE_CLUSTER / PUMP_BURST / DUMP_BURST / EXIT_CLUSTER signals firing
- ✅ flow buckets advancing, new/old money totals consistent
- ✅ idle-session self-shutdown after 90s without subscribers (verified accidentally-then-intentionally)
- ✅ key tester tri-state (ok / invalid / blocked-on-host) and `/api/net` pre-flight accurate


## Post-audit change (product decision)

**Simulation removed entirely.** The engine is live-only: if providers are unreachable, the session stays in
`connecting` phase and retries discovery with backoff — it never fabricates trades, prices, wallets or radar
items. `providers/sim.ts`, the `simulated` feed mode and all UI sim branches were deleted; `Snapshot` now
carries `phase: "connecting" | "tracking"` + `providerError`, and the SSE bus emits a fresh `snapshot` event
the moment discovery first succeeds.
