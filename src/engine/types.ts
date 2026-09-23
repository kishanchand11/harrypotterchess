/**
 * Shared engine vocabulary — used by providers, analytics and API routes.
 * Everything crossing the SSE wire is JSON-serializable.
 */

export type Side = "buy" | "sell";
export type FeedPhase = "connecting" | "tracking";

/** A single swap on a pair involving the analyzed token. */
export interface Trade {
  id: string;
  ts: number; // ms epoch
  wallet: string; // maker/tx-from wallet address
  txHash: string;
  side: Side; // buy = token received, sell = token sold
  priceUsd: number; // execution price of the analyzed token
  qty: number; // quantity of analyzed token
  usd: number; // USD notional
  pool: string; // pair address
  poolLabel: string; // e.g. "PEPE / WETH"
  dex: string; // e.g. "Uniswap V3"
  quoteSymbol: string; // e.g. WETH
  source: string; // provider id: gecko | dexscreener | moralis
  sameTxWallets?: number; // trades sharing txHash (bundle detection)
}

export interface PairNode {
  address: string;
  label: string; // "PEPE / WETH"
  dex: string;
  network: string; // dexscreener chain id
  quoteSymbol: string;
  quoteAddress: string;
  baseSymbol: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  txns24h: number;
  buys24h: number;
  sells24h: number;
  priceChange24hPct: number;
  priceChange1hPct: number;
  priceChange5mPct: number;
  createdAt: number | null; // pool created at (ms)
  url: string;
  isPrimary: boolean;
}

/** Static pair-graph snapshot sent on connect / refresh. */
export interface PairGraph {
  network: string;
  token: TokenMeta;
  pairs: PairNode[];
  quotes: { symbol: string; address: string; liquidityUsd: number; pairCount: number }[];
}

export interface TokenMeta {
  address: string;
  symbol: string;
  name: string;
  network: string; // dexscreener chain id
  priceUsd: number;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number;
  volume24hUsd: number;
  volume6hUsd: number;
  volume1hUsd: number;
  txns24h: number;
  buys24h: number;
  sells24h: number;
  priceChange24hPct: number;
  priceChange1hPct: number;
  priceChange5mPct: number;
  imageUrl: string | null;
}

export type WalletClass =
  | "smart-money"
  | "whale"
  | "sniper"
  | "pumper"
  | "dumper"
  | "fresh-wallet"
  | "old-holder"
  | "accumulator"
  | "distributor"
  | "active";

export interface WalletSummary {
  address: string;
  firstSeen: number;
  lastActive: number;
  trades: number;
  buys: number;
  sells: number;
  buyUsd: number;
  sellUsd: number;
  netQty: number;
  positionUsd: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  realizedPnl: number | null;
  unrealizedPnl: number;
  hadPositionAtStart: boolean;
  isNew: boolean;
  winRate: number | null;
  impactScore: number; // % price move attributable per $1k traded (EMA)
  timingScore: number; // -1..1 entry/exit skill
  smartScore: number; // 0..100 composite
  labels: string[];
  klass: WalletClass;
  lastSide: Side;
  lastTradeUsd: number;
  bundleCount: number;
  snipedAt: number | null; // bought within 30min of pool creation
  priorNetQty?: number; // position held before this session (from history)
}

export type SignalKind =
  | "PUMP_BURST"
  | "DUMP_BURST"
  | "WHALE_BUY"
  | "WHALE_SELL"
  | "SNIPE_CLUSTER"
  | "EXIT_CLUSTER"
  | "SMART_BUY"
  | "SMART_SELL"
  | "FRESH_INFLOW_SPIKE"
  | "OLD_OUTFLOW_SPIKE"
  | "LIQUIDITY_MOVE"
  | "PRICE_BREAKOUT"
  | "PRICE_BREAKDOWN";

export interface Signal {
  id: string;
  ts: number;
  kind: SignalKind;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  wallets: string[];
  usd?: number;
  priceUsd?: number;
  priceDeltaPct?: number;
}

export interface Tick {
  ts: number;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  buys1m: number;
  sells1m: number;
  buyUsd1m: number;
  sellUsd1m: number;
}

export interface FlowSnapshot {
  ts: number;
  newBuyUsd1m: number; // USD bought by wallets first seen this session
  oldSellUsd1m: number; // USD sold by wallets that held before tracking
  newBuyers1m: number;
  oldSellers1m: number;
  newBuyUsdTotal: number;
  oldSellUsdTotal: number;
  newWallets: number;
  oldWallets: number;
  /** 1-min buckets for sparklines: [ts, newBuyUsd, oldSellUsd] */
  buckets: [number, number, number][];
}

export interface HolderRow {
  rank: number;
  address: string;
  balance: number;
  sharePct: number;
  isContract: boolean;
  source: "geckoterminal" | "moralis" | "derived" | "chain";
}

export interface HoldersSnapshot {
  updatedAt: number | null;
  source: HolderRow["source"] | null;
  available: boolean;
  note?: string;
  rows: HolderRow[];
  top10SharePct?: number;
}

export interface SniperItem {
  id: string; // wallet:token
  wallet: string;
  walletScore: number;
  walletLabels: string[];
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  network: string;
  usd: number | null;
  qty?: number;
  ts: number;
  side: Side;
  url: string;
}

export interface ProviderHealth {
  id: string;
  label: string;
  state: "ok" | "degraded" | "down" | "idle" | "needs-key";
  detail: string;
  lastOkAt: number | null;
  calls: number;
  errors: number;
}

export interface SessionHealth {
  phase: FeedPhase;
  startedAt: number;
  uptimeMs: number;
  tradesIngested: number;
  providers: ProviderHealth[];
  pollers: { name: string; intervalMs: number; lastRunAt: number | null; running: boolean }[];
}

/** Light per-token row for the global scanner / watchlist view. */
export interface ScanInfo {
  sid: string;
  address: string;
  symbol: string;
  network: string;
  phase: FeedPhase;
  price: number;
  liquidity: number;
  wallets: number;
  trades: number;
  freshInflow1m: number;
  keepAlive: boolean;
  lastSignal: { kind: string; title: string; ts: number; severity: string } | null;
  stopped: boolean;
}

/** Full state push on SSE connect and whenever discovery first succeeds. */
export interface Snapshot {
  sid: string;
  phase: FeedPhase;
  providerError?: string;
  token: TokenMeta;
  graph: PairGraph;
  wallets: WalletSummary[];
  trades: Trade[];
  ticks: Tick[];
  signals: Signal[];
  flow: FlowSnapshot;
  holders: HoldersSnapshot;
  sniper: SniperItem[];
  radarEnabled: boolean;
  health: SessionHealth;
  price: number;
}
