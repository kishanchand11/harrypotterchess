# 🧠 SmartMoney Terminal — DeFi Token Pair Analyzer & Smart-Money Tracker

Paste a token contract address → the terminal locks onto **every DEX pair** for that token, streams the
**live trade tape**, and builds **Nansen-style wallet intelligence** in real time.

![stack](https://img.shields.io/badge/Next.js-15.5-black) ![react](https://img.shields.io/badge/React-19.3-61dafb) ![tailwind](https://img.shields.io/badge/Tailwind-4.3-38bdf8) ![ts](https://img.shields.io/badge/TypeScript-5.9-3178c6)

## What it does

| # | Requirement | Where |
|---|-------------|-------|
| 1 | User enters token contract address | Search bar (EVM `0x…` / Solana / Sui / TON), chain auto-detect via DexScreener |
| 2 | Live trading data feed | GeckoTerminal per-pool swap tape + DexScreener price ticks → **SSE fan-out** (`/api/stream`) |
| 3 | Auto-grab & load the pair graph | All pools across DEXes/chains discovered automatically → interactive SVG pair graph |
| 4 | Persistent pulling + per-wallet movement analysis | Rate-limited polling loops (token bucket + backoff) feed a FIFO **wallet ledger** |
| 5 | Which wallets are pumping/dumping the price | **Impact engine**: each price tick is attributed across trades by USD weight & flow-explained fraction → `% price per $1k` per wallet |
| 6 | New users buying vs old users selling | **Flow engine**: fresh-wallet inflow vs old-holder distribution, 1-min buckets + spike signals |
| 7 | Price-movement intelligence inside the holder set | Pump/dump bursts, whale moves, breakout signals — each listing the wallets behind it |
| 8 | Nansen-style smart money | Composite **smart score** (realized PnL + market timing + price impact + win rate), wallet classes: Smart Money / Whale / Sniper / Pumper / Dumper / Fresh / Old Holder / Accumulator, sniper **bundle detection** (same-tx cluster) |
| 9 | What new tokens are holders buying (sniping) | **Sniper radar**: polls top-scoring wallets' activity (Moralis swaps / Etherscan transfers — BYO key) and surfaces the new tokens they enter |

## Governance: high performance, low latency, BYO keys

- **Latest stack**: Next.js 15 (App Router, Turbopack), React 19, Tailwind CSS 4, Zustand 5, TypeScript 5 strict.
- **Zero-poll UI**: one SSE connection (`text/event-stream`) pushes ticks, trades, wallets, signals, flow,
  holders and health — no client polling. Canvas chart renders on a dirty-flag rAF loop; ring buffers
  server-side make ingestion O(1) with no allocation churn.
- **Rate-limit aware**: shared token bucket for GeckoTerminal (30 req/min free tier), exponential backoff,
  per-provider health surfaced in `/api/health`-style events.
- **Bring your own keys**: paste keys in the ⚙ Keys modal (stored **only in your browser's localStorage**,
  sent per session request) or fill `.env.local` from `.env.example`. Server never persists keys.
  Keyless mode works via DexScreener + GeckoTerminal public APIs.

## Run it

```bash
cp .env.example .env.local   # optional — add your keys
npm install
npm run dev                  # http://localhost:3000  (Turbopack)
# or: npm run build && npm start
```

> **Note:** if your network blocks DexScreener/GeckoTerminal (some sandboxes/datacenters do), the terminal
> automatically falls back to a clearly-labeled **simulated tape** with realistic personas (whales, snipers,
> dumpers, fresh wallets) and flow-reactive price — every analytic still runs for real. Run it anywhere with
> normal egress and the same UI goes fully live, keyless.

## Architecture

```
src/
  engine/
    session.ts            per-token analyzer: discovery + polling loops + event bus
    registry.ts           shared session registry (LRU-capped, multi-client)
    infra.ts              token-bucket rate limiter + typed event bus
    ring.ts               O(1) ring buffers (ticks, trades, signals)
    providers/
      dexscreener.ts      keyless multi-chain token/pair discovery + ticks
      geckoterminal.ts    keyless live swap tape, pools, holders (Pro-optional)
      etherscan.ts        BYO key — wallet token transfers (radar), wallet age
      moralis.ts          BYO key — wallet swaps (radar), top holders
      sim.ts              simulated tape fallback (labeled, flow-reactive price)
    analytics/
      wallets.ts          FIFO ledger: positions, realized PnL, scoring, classes
      impact.ts           tick→trade price attribution + pump/dump bursts
      flow.ts             fresh-inflow vs old-holder distribution + spikes
      clusters.ts         sniper bundles (same-tx) + coordinated bursts
      sniper.ts           cross-token radar for tracked smart wallets
  app/
    api/session|stream|wallet|config/route.ts
    page.tsx + components/  dashboard UI (canvas chart, SVG graph, tables)
```

### SSE events

`snapshot` → `tick` · `trades` · `wallets` · `signal` · `flow` · `holders` · `sniper` · `health` · `stopped`

### Scoring model (transparent by design)

```
smartScore = 100 · ( 0.36·max(0, tanh(realizedPnl/scale))
                   + 0.26·(timing+1)/2
                   + 0.14·tanh(|impact|/1.2)
                   + 0.14·winRate
                   + 0.10·activity )
```

- **timing** ∈ [-1,1] — EMA of buy-before-pumps / sell-before-drops correlation
- **impact** — % of price move attributable per $1k traded (tick-window attribution)
- Classes: `smart-money` (score ≥ 65, ≥3 trades), `dumper`, `pumper`, `old-holder`, `accumulator`,
  `whale`, `fresh-wallet` — thresholds scale with pool liquidity.

### API

| Route | Description |
|-------|-------------|
| `POST /api/session` `{address, network?}` | discover pairs, start persistent polling, returns `sid` |
| `GET /api/stream?sid=` | SSE live feed |
| `GET /api/wallet?sid=&wallet=` | per-wallet deep dive + BYO-key enrichment (age, swaps) |
| `GET /api/config` | which server-side env keys are present (booleans only) |

*Derived data is analytics over observed DEX trades — not financial advice.*
