# Audit #3 — Chain Indexer build ("Moralis-lite", single token/chain) — 3 passes

## What was built
`src/engine/indexer.ts` — a self-sufficient per-token on-chain indexer that replaces the hard Moralis
dependency for the single-token use case:

- **Pool-membership swap classifier**: `eth_getLogs(Transfer)` on the token → `from ∈ pools` = BUY,
  `to ∈ pools` = BUY/SELL inverse, neither = TRANSFER (forensics only). No DEX decoding needed.
- **Balance map** → real top-100 holders with supply % (`source: "chain"`, keyless).
- **Backfill** from pool-creation block (binary-searched by timestamp, capped by
  `INDEXER_MAX_BACKFILL_DAYS`, default 14) with **checkpoint resume** (`data/history/*.index.json`).
- **Live tail** emits trades into the normal `ingest()` (dedupe-safe ids `chain-{tx}-{logIndex}`);
  backfilled history moves balances but **never fabricates trades/signals**.
- **Keyless-first RPC**: public endpoints per chain (chains.ts), Alchemy prepended when a key exists;
  endpoint rotation on failure; adaptive chunk sizing (halve on range errors, regrow on success).
- **Drift correction**: periodic `balanceOf` reconciliation for top-5 wallets.
- **Old holders, upgraded**: wallets holding after full backfill are `hadPositionAtStart` from trade one.
- Holder-source priority chain enforced: Moralis > GeckoTerminal > chain-index > derived (no clobbering).

## Verification
- **16 invariant assertions** on the real code (decoder, classifier, balance machine, live-vs-backfill
  emission, transfer non-flow, holder ordering/share math, checkpoint serialization) — all pass.
  Run: `npx tsc scripts/indexer.smoke.ts --outDir /tmp/t --module commonjs --target es2022
  --moduleResolution node --skipLibCheck --esModuleInterop && node /tmp/t/scripts/indexer.smoke.js`
- Health surface verified live: `indexer` provider row + `chain indexer` poller row; correctly idle
  until pair discovery succeeds (blocked-host behavior confirmed honest).
- Strict tsc (`noUnusedLocals/Parameters`) + `next build` green after every pass.

## Findings & fixes per pass

### Pass 1 — new-code correctness (5 fixes)
1. Dead code in `init()` (leftover `poolCreatedAt` no-op lines) — removed.
2. Wallet↔wallet transfers were only counted — now persisted (bounded 100/tick, `kind:"x"` tape lines)
   for future wash-trade forensics.
3. **Cross-source double-count**: GT tape and chain index deliver the SAME swap with different ids —
   added cross-source dedupe key `tx|wallet|side` (both sets FIFO-bounded).
4. Unused `processed` counter — removed.
5. Duplicate `Trade` type import — merged.

### Pass 2 — integration (2 fixes)
6. **Checkpoint not flushed on `stop()`** → restart re-scanned the last ≤60s and re-ingested those
   swaps (cross-restart double-count). `stop()` now saves the indexer checkpoint first.
7. Health row hardcoded `errors: 0` — indexer now counts real errors (chunk-shrinks + poll failures).

### Pass 3 — source-priority conflicts (2 fixes)
8. 2-min `refreshHolders` could overwrite live chain-index holders with session-derived rows —
   refresh now yields while the chain index is the active source.
9. Chain-index rebuild could downgrade better on-chain sources — guarded (never replaces
   moralis/geckoterminal holder lists).

## Test-data bugs caught during verification (not shipped)
- Smoke test initially used `10n ** 18n` (= 1 token, not 10) and asserted a wallet↔wallet transfer as
  a buy — both were test bugs; the engine's zero-floor on oversell and transfer classification are
  correct behavior (assertions fixed, 16/16 green).

## Known limits (documented, by design)
- EVM chains only (`rpc: []` on Solana/Sui/TON — different recipe, later).
- Backfilled historical USD is approximate (qty exact; priced at session price when emitted live).
- Backfill depth capped (default 14d) — older tokens index from the cap, not genesis.
