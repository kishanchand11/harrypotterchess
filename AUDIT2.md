# Audit #2 — Feature Build (Nansen-gap closures) + 3-Pass Re-Audit Loop

New features built (the "needed" gaps from the Nansen difference list):
1. **Persistence / history** (`engine/history.ts`) — JSONL trade tapes + signals per token, last-known
   positions per token, lifetime wallet aggregates (all tokens), session metas. Zero deps, path-safe,
   bounded (tape rotation 12MB, 50 tokens/wallet, 100k wallets, prune oldest).
2. **Cross-session old-holder recognition** — sessions seed `hadPositionAtStart` from saved positions;
   drawer shows "held N before this session → Old Holder" and lifetime record (sessions, PnL, W/L, tokens).
3. **Alerts** (`engine/alerts.ts`) — Discord webhook + Telegram push on signals, per-kind 60s cooldown,
   severity floor via env, SSRF guard (https-only, loopback/private hosts blocked), BYO config
   (env: `DISCORD_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` or ⚙ Keys fields).
4. **Watchlist + background tracking** — persisted `data/watchlist.json`; watchlisted tokens run
   keep-alive sessions (no idle shutdown, eviction-protected, auto-restart on any API touch), track with
   the browser closed, alerts included.
5. **Scanner panel** — all tracked sessions + watchlist in one table (phase, price, liq, wallets, fresh
   inflow 1m, last signal), click-to-open, ⭐ toggle; `GET /api/scan`, `GET/POST/DELETE /api/watchlist`,
   `GET /api/profile`.

## 3-pass audit loop results (11 fixes)

### Pass A — new-code correctness (4 fixes)
| Bug | Fix |
|---|---|
| `evict()` could kill keep-alive watchlist sessions (0 subscribers by design) | keep-alive protected in pass 2; last-resort pass 3 only when over capacity |
| `alertConfigFromKeys` hardcoded `minSeverity:"info"`, silently overriding env severity floor | keys config is now channel-fields only |
| `stop()` recomputed wins via a convoluted winRate back-calculation | use ledger counters directly |
| unused `tokenAddress` param / dead `priorPositions` field | removed (strict-clean) |

### Pass B — integration (4 fixes)
| Bug | Fix |
|---|---|
| Watchlist DELETE left the background session running for 4h | `stopSession()` on delete across all network sids |
| `.toLowerCase()` corrupted Solana base58 wallets (case-sensitive!) in GT trade parsing | lowercase only for non-Solana/Sui/TON networks |
| `/api/profile` lowercased any address → SOL profiles could never resolve | lowercase only `0x…`; strict regex per chain |
| `walletLifetime` lookup missed raw-case SOL entries | raw → lowercase fallback lookup |

### Pass C — robustness (3 fixes)
| Bug | Fix |
|---|---|
| **DATA LOSS**: `stop()` during `connecting` overwrote saved positions with `{}` | flush only when `phase==="tracking" && tradesIngested>0` |
| `wallets.json` unbounded growth | prune beyond 100k by lastSeen |
| corrupted `watchlist.json` crashed watchlist APIs | shape-validating loader |

## Runtime verification (this host)
- ✅ watchlist add / invalid-address 400 (path traversal rejected) / delete stops bg session (scan rows → 0)
- ✅ `/api/scan` lists keep-alive bg session with honest `connecting` phase (live-only respected)
- ✅ `/api/profile` clean response for unknown wallet
- ✅ SSRF host-guard logic verified (localhost/169.254/10.x blocked, discord.com allowed)
- ✅ strict `tsc --noUnusedLocals --noUnusedParameters` + `next build` green after every pass
- ⚠ Persistence write-path (tapes/aggregates) needs live trades — blocked in this sandbox; verified by
  review + typecheck; will exercise on first hosted run with real feed.
