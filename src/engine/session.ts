/**
 * AnalyzerSession — persistent per-token polling engine.
 *
 *  • DexScreener  (keyless): token/pair discovery + price/liquidity ticks
 *  • GeckoTerminal(keyless): live per-pool trade tape + holders (rate-limited)
 *  • Etherscan/Moralis/Alchemy (BYO key): wallet radar + holders fallback
 *
 * LIVE-ONLY: there is no simulated fallback. If providers are unreachable the
 * session stays in "connecting" phase and retries discovery with backoff until
 * the real feed answers. Data is never fabricated.
 *
 * All intervals are rate-limit aware via a shared TokenBucket and back off on
 * errors. Events fan out to SSE subscribers through a Bus.
 */
import { Bus, TokenBucket } from "./infra";
import { Ring } from "./ring";
import { chainByDs } from "./chains";
import { dexscreenerHealth, dsLookupToken, dsRefreshPairs, type DsLookup } from "./providers/dexscreener";
import { gtHealth, gtPoolTrades, gtTokenPools, gtTokenHolders, type GtPool } from "./providers/geckoterminal";
import { etherscanHealth } from "./providers/etherscan";
import { moralisHealth } from "./providers/moralis";
import { alchemyHealth } from "./providers/alchemy";
import { history } from "./history";
import { TokenIndexer } from "./indexer";
import { alertConfigFromKeys, alertConfigFromEnv, dispatcher } from "./alerts";
import { WalletLedger, type WalletRec } from "./analytics/wallets";
import { ImpactEngine } from "./analytics/impact";
import { FlowEngine } from "./analytics/flow";
import { ClusterEngine } from "./analytics/clusters";
import { SniperRadar } from "./analytics/sniper";
import type {
  FlowSnapshot,
  ScanInfo,
  HoldersSnapshot,
  ProviderHealth,
  SessionHealth,
  Signal,
  Snapshot,
  Tick,
  Trade,
  WalletSummary,
} from "./types";
import type { Keys } from "./keys";

const TICK_RING = 1_080; // price ticks kept (~1.5–2h)
const TRADE_RING = 600;
const SIGNAL_RING = 80;
const DS_INTERVAL_MS = 8_000;
const TRADE_INTERVAL_MS = 3_000;
const SECONDARY_TRADE_INTERVAL_MS = 45_000;
const HOLDERS_INTERVAL_MS = 120_000;
const RADAR_INTERVAL_MS = 30_000;
const FLOW_EMIT_MS = 8_000;
const HEALTH_EMIT_MS = 10_000;
const WALLET_EMIT_MS = 1_600;
const SUBSCRIBER_GRACE_MS = 90_000;
const MAX_AGE_MS = 4 * 60 * 60_000;

export class AnalyzerSession {
  readonly sid: string;
  readonly address: string;
  networkDs: string;
  readonly keys: Keys;

  phase: "connecting" | "tracking" = "connecting";
  providerError?: string;

  private bus = new Bus<{
    snapshot: Snapshot;
    tick: Tick;
    trades: Trade[];
    wallets: WalletSummary[];
    signal: Signal;
    flow: FlowSnapshot;
    holders: HoldersSnapshot;
    sniper: unknown[];
    health: SessionHealth;
    stopped: Record<string, never>;
  }>();
  private subscribers = new Set<(evt: { type: string; data: unknown }) => void>();
  private lastSubscriberLeftAt: number | null = null;

  private ledger = new WalletLedger();
  private impact!: ImpactEngine;
  private flow!: FlowEngine;
  private clusters!: ClusterEngine;
  private radar!: SniperRadar;

  private ticks = new Ring<Tick>(TICK_RING);
  private trades = new Ring<Trade>(TRADE_RING);
  private signals = new Ring<Signal>(SIGNAL_RING);

  private lookup: DsLookup | null = null;
  private gtPools: GtPool[] = [];
  private primaryPool: GtPool | null = null;
  private poolCreatedAt: number | null = null;
  private holdersSnap: HoldersSnapshot = { updatedAt: null, source: null, available: false, rows: [] };

  private lastPrice = 0;
  private lastTick: Tick | null = null;
  private seenTradeIds = new Set<string>(); // dedupe re-delivered swaps (GT returns last-N per poll)
  private seenSwapKeys = new Set<string>(); // cross-source: tx|wallet|side counted once
  private seenOrder: string[] = []; // FIFO eviction index for both sets
  private tradesIngested = 0;
  private walletsDirty = true;
  private lastWalletEmit = 0;
  private startedAt = Date.now();
  private stopped = false;
  private timers: NodeJS.Timeout[] = [];
  private seq = 0;
  private gtBucket = new TokenBucket(28); // free tier 30/min shared
  private backoff = { ds: 1, gt: 1 };

  readonly keepAlive: boolean; // watchlist sessions persist without subscribers
  private indexer: TokenIndexer | null = null;
  private indexerReady = false;
  private indexerInitAttemptAt = 0;
  private oldHolderSeeded = false;
  private holderRebuildAt = 0;
  private indexerPersistAt = 0;
  private reconcileAt = 0;

  constructor(opts: { address: string; network: string | null; keys: Keys; sid: string; keepAlive?: boolean }) {
    this.address = opts.address.toLowerCase();
    this.networkDs = opts.network && opts.network !== "auto" ? opts.network : "";
    this.keys = opts.keys;
    this.sid = opts.sid;
    this.keepAlive = opts.keepAlive ?? false;
  }

  async start(): Promise<void> {
    this.impact = new ImpactEngine(this.ledger, (s) => this.pushSignal(s));
    this.flow = new FlowEngine(this.ledger, (s) => this.pushSignal(s));
    this.clusters = new ClusterEngine(this.ledger, () => this.lastTick?.liquidityUsd ?? 0, (s) => this.pushSignal(s));
    this.radar = new SniperRadar(this.networkDs || "ethereum", this.address);

    await this.tryDiscover();

    this.startedAt = Date.now();
    // idle-shutdown clock starts immediately — a session that is never
    // streamed must not burn provider quota for MAX_AGE hours
    this.lastSubscriberLeftAt = Date.now();
    this.startLoops();
  }

  /**
   * LIVE-ONLY discovery. On failure the session stays in "connecting" phase
   * and startLoops() retries until a real provider answers. No synthetic data.
   */
  private async tryDiscover(): Promise<boolean> {
    try {
      const lookup = await dsLookupToken(this.address);
      if (!lookup || lookup.pairs.length === 0) {
        this.providerError =
          dexscreenerHealth.errors > 0
            ? "Live providers are unreachable from this server (network egress blocked). Retrying automatically — the real feed activates the moment a provider answers."
            : "Token not found on tracked DEXs (yet). Retrying…";
        return false;
      }
      this.providerError = undefined;
      this.phase = "tracking";
      this.lookup = lookup;
      if (!this.networkDs) {
        this.networkDs = lookup.pairs[0].network; // chain with deepest liquidity
      }
      this.radar = new SniperRadar(this.networkDs, this.address);
      this.lastPrice = lookup.token.priceUsd;
      const netPairs = lookup.pairs.filter((p) => p.network === this.networkDs);
      this.lastTick = {
        ts: Date.now(),
        priceUsd: lookup.token.priceUsd,
        liquidityUsd: netPairs.reduce((s, p) => s + p.liquidityUsd, 0) || lookup.token.liquidityUsd,
        volume24hUsd: lookup.token.volume24hUsd,
        buys1m: 0,
        sells1m: 0,
        buyUsd1m: 0,
        sellUsd1m: 0,
      };
      this.ticks.push(this.lastTick);
      await this.discoverGtPools();
      // cross-session memory: wallets that still hold from a previous session
      // are OLD HOLDERS from the first observed trade (requirement: "old users selling")
      for (const [w, qty] of history.loadPriorPositions(this.address)) {
        const rec = this.ledger.rec(w);
        if (!rec.hadPositionAtStart) {
          rec.hadPositionAtStart = true;
          rec.priorNetQty = qty;
        }
      }
      this.startIndexer(netPairs);
      this.bus.emit("health", this.health());
      // push the discovered token/graph to connected clients immediately
      this.bus.emit("snapshot", this.snapshot());
      return true;
    } catch {
      // fetchJson throws on network failure — classify via provider health
      this.providerError =
        dexscreenerHealth.errors > 0
          ? "Live providers are unreachable from this server (network egress blocked). Retrying automatically — the real feed activates the moment a provider answers."
          : "Discovery request failed — retrying against live providers…";
      return false;
    }
  }

  private async discoverGtPools(): Promise<void> {
    const chain = chainByDs(this.networkDs);
    if (!chain) return;
    try {
      const pools = await gtTokenPools(chain.gt, this.address, this.keys.gecko);
      if (pools && pools.length) {
        // align with dexscreener primary (deepest liquidity first from GT sort)
        this.gtPools = pools;
        const dsPrimary = this.lookup?.pairs.find((p) => p.network === this.networkDs);
        this.primaryPool =
          (dsPrimary && pools.find((p) => p.address.toLowerCase() === dsPrimary.address.toLowerCase())) ||
          pools[0];
        this.poolCreatedAt = this.primaryPool.createdAt;
      } else if (this.lookup) {
        // GT discovery failed; use DexScreener pair as pseudo-pool for tick math
        const p = this.lookup.pairs.find((x) => x.network === this.networkDs);
        if (p) {
          this.primaryPool = {
            address: p.address,
            name: p.label,
            dex: p.dex,
            createdAt: p.createdAt,
            baseTokenPriceUsd: p.priceUsd,
            priceChange5m: p.priceChange5mPct,
            priceChange1h: p.priceChange1hPct,
            priceChange24h: p.priceChange24hPct,
            volume24h: p.volume24hUsd,
            reserveUsd: p.liquidityUsd,
            buys24h: p.buys24h,
            sells24h: p.sells24h,
            buys5m: 0,
            sells5m: 0,
            fdvUsd: this.lookup.token.fdvUsd,
          };
          this.poolCreatedAt = p.createdAt;
        }
      }
    } catch {
      /* health tracked in provider */
    }
  }

  // ── Loops ─────────────────────────────────────────────────────────────────
  private every(ms: number, fn: () => void | Promise<void>): void {
    const t = setInterval(() => {
      if (this.stopped) return;
      Promise.resolve(fn()).catch(() => {});
    }, ms);
    this.timers.push(t);
  }

  private startLoops(): void {
    // discovery retry until the real feed answers, then price ticks
    this.every(DS_INTERVAL_MS, () => {
      if (this.phase === "tracking") void this.dsTick();
      else void this.tryDiscover();
    });
    this.every(TRADE_INTERVAL_MS, () => {
      if (this.phase === "tracking" && this.primaryPool) void this.gtTrades("primary");
    });
    this.every(SECONDARY_TRADE_INTERVAL_MS, () => {
      if (this.phase === "tracking" && this.primaryPool) void this.gtTrades("secondary");
    });
    this.every(4_000, () => void this.indexerTick());
    this.every(HOLDERS_INTERVAL_MS, () => this.refreshHolders());
    this.every(RADAR_INTERVAL_MS, () => this.runRadar());
    this.every(FLOW_EMIT_MS, () => this.bus.emit("flow", this.flow.snapshot(this.ledger)));
    this.every(HEALTH_EMIT_MS, () => this.bus.emit("health", this.health()));
    this.every(2_000, () => {
      if (this.walletsDirty && Date.now() - this.lastWalletEmit >= WALLET_EMIT_MS) {
        this.lastWalletEmit = Date.now();
        this.walletsDirty = false;
        this.bus.emit("wallets", this.walletSummaries());
      }
    });
    this.every(15_000, () => this.checkIdle());
    // initial emissions
    this.bus.emit("flow", this.flow.snapshot(this.ledger));
    this.bus.emit("health", this.health());
    void this.refreshHolders();
    void this.runRadar();
  }

  private async dsTick(): Promise<void> {
    if (!this.lookup) return;
    try {
      const fresh = await dsRefreshPairs(this.address);
      if (!fresh) return;
      this.lookup = fresh;
      const netPairs = fresh.pairs.filter((p) => p.network === this.networkDs);
      const primary = netPairs[0];
      const price = primary?.priceUsd || fresh.token.priceUsd;
      const liquidity = netPairs.reduce((s, p) => s + p.liquidityUsd, 0) || fresh.token.liquidityUsd;
      const tick: Tick = {
        ts: Date.now(),
        priceUsd: price,
        liquidityUsd: liquidity,
        volume24hUsd: fresh.token.volume24hUsd,
        buys1m: 0,
        sells1m: 0,
        buyUsd1m: 0,
        sellUsd1m: 0,
      };
      this.lastPrice = price;
      this.lastTick = tick;
      this.ticks.push(tick);
      this.impact.onTick(tick);
      this.bus.emit("tick", tick);
      this.walletsDirty = true;
      this.backoff.ds = 1;
      // liquidity move detection
      const prev = this.ticks.last(2)[0];
      if (prev && prev.liquidityUsd > 0) {
        const d = (liquidity - prev.liquidityUsd) / prev.liquidityUsd;
        if (Math.abs(d) > 0.05) {
          this.pushSignal({
            id: `LIQ-${Date.now()}-${this.seq++}`,
            ts: Date.now(),
            kind: "LIQUIDITY_MOVE",
            severity: Math.abs(d) > 0.15 ? "critical" : "warn",
            title: `Liquidity ${d > 0 ? "added" : "removed"} ${Math.abs(d * 100).toFixed(1)}%`,
            detail: `Pool liquidity moved from $${Math.round(prev.liquidityUsd).toLocaleString()} to $${Math.round(liquidity).toLocaleString()}. ${d < 0 ? "Rug-risk watch." : "Fresh ammo for market makers."}`,
            wallets: [],
            priceUsd: price,
          });
        }
      }
    } catch {
      this.backoff.ds = Math.min(this.backoff.ds * 2, 8);
      dexscreenerHealth.state = "degraded";
    }
  }

  private async gtTrades(which: "primary" | "secondary"): Promise<void> {
    const chain = chainByDs(this.networkDs);
    if (!chain || !this.primaryPool) return;
    let pool = this.primaryPool;
    if (which === "secondary") {
      const others = this.gtPools.filter((p) => p.address !== this.primaryPool?.address);
      if (!others.length) return;
      const idx = Math.floor(Math.random() * others.length);
      pool = others[idx];
    }
    await this.gtBucket.take();
    const baseTokenId = `${chain.gt}:${this.address}`;
    try {
      const trades = await gtPoolTrades(chain.gt, pool.address, baseTokenId, this.keys.gecko);
      this.backoff.gt = 1;
      if (trades && trades.length) {
        const poolLabel = pool.name || `${this.lookup?.token.symbol ?? "token"} pair`;
        const dex = pool.dex;
        const quoteSymbol = poolLabel.split("/")[1]?.trim() || "";
        this.ingest(
          trades.map((t) => ({
            id: `${t.txHash}:${t.wallet}:${t.side}:${Math.round(t.usd * 100)}`,
            ts: t.ts,
            wallet: t.wallet,
            txHash: t.txHash,
            side: t.side,
            priceUsd: t.priceUsd || this.lastPrice,
            qty: t.qty,
            usd: t.usd,
            pool: pool.address,
            poolLabel,
            dex,
            quoteSymbol,
            source: "gecko",
          })),
        );
      }
    } catch {
      this.backoff.gt = Math.min(this.backoff.gt * 2, 8);
    }
  }

  /** Single ingestion path for all sources — everything downstream is uniform. */
  private ingest(trades: Trade[]): void {
    const ctx = {
      priceNow: this.lastPrice,
      liquidityUsd: this.lastTick?.liquidityUsd ?? 0,
      poolCreatedAt: this.poolCreatedAt,
      sessionStart: this.startedAt,
    };
    const fresh: Trade[] = [];
    for (const t of trades) {
      if (t.ts < this.startedAt - 5 * 60_000) continue; // ignore ancient replays
      if (this.seenTradeIds.has(t.id)) continue; // provider re-delivered the same swap
      // cross-source dedupe: GT tape and chain index deliver the SAME swap with
      // different ids — one wallet/side/tx must only ever count once
      const xKey = `${t.txHash}|${t.wallet}|${t.side}`;
      if (this.seenSwapKeys.has(xKey)) continue;
      this.seenSwapKeys.add(xKey);
      this.seenOrder.push(xKey);
      this.seenTradeIds.add(t.id);
      this.seenOrder.push(t.id);
      if (this.seenOrder.length > 5_000) {
        for (const evicted of this.seenOrder.splice(0, 2_500)) {
          this.seenTradeIds.delete(evicted);
          this.seenSwapKeys.delete(evicted); // order array holds both key kinds
        }
      }
      this.trades.push(t);
      fresh.push(t);
      const rec = this.ledger.apply(t, ctx);
      this.impact.pushTrade(t);
      this.flow.onTrade(t);
      this.clusters.onTrade(t);
      if (rec.hadPositionAtStart || rec.trades > 1) this.walletsDirty = true;
    }
    if (fresh.length) {
      this.tradesIngested += fresh.length;
      this.walletsDirty = true;
      this.bus.emit("trades", fresh);
      history.recordTrades(this.address, fresh);
    }
  }

  private async refreshHolders(): Promise<void> {
    if (this.phase !== "tracking") return; // no fabricated holders while connecting
    // the chain index (live, keyless) wins over derived; Moralis/GT refreshes
    // still outrank it — but they must not clobber a live chain index either
    if (this.indexerReady && this.holdersSnap.source === "chain") return;
    const chain = chainByDs(this.networkDs);
    if (!chain) return;
    // 1) Moralis (BYO key) — best
    if (this.keys.moralis && chain.moralis) {
      const { morTokenHolders } = await import("./providers/moralis");
      const rows = await morTokenHolders(chain.moralis, this.address, this.keys.moralis).catch(() => null);
      if (rows && rows.length) {
        this.holdersSnap = {
          updatedAt: Date.now(),
          source: "moralis",
          available: true,
          rows,
          top10SharePct: rows.slice(0, 10).reduce((s, r) => s + r.sharePct, 0),
        };
        this.bus.emit("holders", this.holdersSnap);
        return;
      }
    }
    // 2) GeckoTerminal (free tier may gate)
    const res = await gtTokenHolders(chain.gt, this.address, this.keys.gecko).catch(() => null);
    if (res && res.rows.length) {
      this.holdersSnap = {
        updatedAt: Date.now(),
        source: "geckoterminal",
        available: true,
        rows: res.rows,
        top10SharePct: res.rows.slice(0, 10).reduce((s, r) => s + r.sharePct, 0),
      };
    } else if (!this.holdersSnap.available) {
      // 3) derived from session ledger
      const rows: HoldersSnapshot["rows"] = this.walletSummaries()
        .filter((w) => w.netQty > 0)
        .slice(0, 20)
        .map((w, i) => ({
          rank: i + 1,
          address: w.address,
          balance: w.netQty,
          sharePct: -1, // unknown supply
          isContract: false,
          source: "derived",
        }));
      this.holdersSnap = {
        updatedAt: Date.now(),
        source: "derived",
        available: rows.length > 0,
        note:
          "On-chain holder list needs a Moralis key (or GeckoTerminal Pro). Showing live-tracked holders derived from the session tape.",
        rows,
      };
    }
    this.bus.emit("holders", this.holdersSnap);
  }

  private async runRadar(): Promise<void> {
    if (this.phase !== "tracking") return;
    const tops = this.walletSummaries().slice(0, 10);
    const hasKey = Boolean(this.keys.moralis || this.keys.alchemy || this.keys.etherscan);
    if (!hasKey) return;
    const fresh = await this.radar.poll(tops, {
      moralis: this.keys.moralis,
      etherscan: this.keys.etherscan,
      alchemy: this.keys.alchemy,
    });
    if (fresh.length) this.bus.emit("sniper", this.radar.list());
  }

  private pushSignal(s: Signal): void {
    this.signals.push(s);
    this.bus.emit("signal", s);
    history.recordSignal(this.address, s);
    void dispatcher.dispatch(this.sid, this.lookup?.token.symbol ?? this.address.slice(0, 8), s, {
      ...alertConfigFromEnv(),
      ...alertConfigFromKeys(this.keys), // session keys win per-field over env
    });
  }

  private walletSummaries(): WalletSummary[] {
    return this.ledger.summarize(this.lastPrice, this.lastTick?.liquidityUsd ?? 0).slice(0, 150);
  }

  private checkIdle(): void {
    if (!this.keepAlive && this.subscribers.size === 0 && this.lastSubscriberLeftAt && Date.now() - this.lastSubscriberLeftAt > SUBSCRIBER_GRACE_MS) {
      this.stop();
    }
    // interactive sessions: 4h · watchlist bg-tracking: 24h (re-created on next touch)
    const maxAge = this.keepAlive ? 24 * 3_600_000 : MAX_AGE_MS;
    if (Date.now() - this.startedAt > maxAge) this.stop();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  refreshKeys(keys: Keys): void {
    (this as { keys: Keys }).keys = keys;
  }

  /** Watchlist promotion: survive idle shutdowns (bounded by the keepAlive max-age). */
  promoteKeepAlive(): void {
    (this as { keepAlive: boolean }).keepAlive = true;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  subscribe(fn: (evt: { type: string; data: unknown }) => void): () => void {
    const un = this.bus.subscribe(fn as (event: { type: keyof never & string; data: unknown }) => void);
    this.subscribers.add(fn);
    this.lastSubscriberLeftAt = null;
    return () => {
      this.subscribers.delete(fn);
      un();
      if (this.subscribers.size === 0) this.lastSubscriberLeftAt = Date.now();
    };
  }

  health(): SessionHealth {
    const providers: ProviderHealth[] = [
      { id: "dexscreener", ...dexscreenerHealth },
      { id: "geckoterminal", ...gtHealth },
      { id: "etherscan", ...etherscanHealth, state: this.keys.etherscan ? etherscanHealth.state : "needs-key" },
      { id: "moralis", ...moralisHealth, state: this.keys.moralis ? moralisHealth.state : "needs-key" },
      { id: "alchemy", ...alchemyHealth, state: this.keys.alchemy ? alchemyHealth.state : "needs-key" },
      {
        id: "indexer",
        label: "Chain indexer",
        state: !this.indexer ? "idle" : this.indexer.phase === "live" ? "ok" : this.indexer.phase === "error" ? "down" : "degraded",
        detail: this.indexer ? this.indexer.statusLine() : "starts after pair discovery (EVM chains)",
        lastOkAt: this.indexer?.lastPollAt ?? null,
        calls: this.indexer?.events ?? 0,
        errors: this.indexer?.errors ?? 0,
      },
    ];
    return {
      phase: this.phase,
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      tradesIngested: this.tradesIngested,
      providers,
      pollers: [
        this.phase === "connecting"
          ? { name: "discovery retry", intervalMs: DS_INTERVAL_MS, lastRunAt: null, running: !this.stopped }
          : { name: "dexscreener ticks", intervalMs: DS_INTERVAL_MS, lastRunAt: this.ticks.last(1)[0]?.ts ?? null, running: !this.stopped },
        { name: "live trade tape", intervalMs: TRADE_INTERVAL_MS, lastRunAt: this.trades.last(1)[0]?.ts ?? null, running: !this.stopped },
        { name: "holders", intervalMs: HOLDERS_INTERVAL_MS, lastRunAt: this.holdersSnap.updatedAt, running: !this.stopped },
        { name: "chain indexer", intervalMs: 4_000, lastRunAt: this.indexer?.lastPollAt ?? null, running: !this.stopped && Boolean(this.indexer) },
      ],
    };
  }

  walletDetail(address: string): { summary: WalletSummary; trades: Trade[] } | null {
    const rec: WalletRec | undefined = this.ledger.all().find((r) => r.address === address.toLowerCase());
    if (!rec) return null;
    const price = this.lastPrice;
    const s = rec.summary(price);
    s.smartScore = smartScoreOf(s);
    const liq = this.lastTick?.liquidityUsd ?? 0;
    const { klass, labels } = classifyOf(s, liq);
    s.klass = klass;
    s.labels = labels;
    const trades = this.trades
      .toArray()
      .filter((t) => t.wallet === s.address)
      .slice(-50)
      .reverse();
    return { summary: s, trades };
  }

  snapshot(): Snapshot {
    const price = this.lastPrice || this.lookup?.token.priceUsd || 0;
    const graph = this.buildGraph();
    return {
      sid: this.sid,
      phase: this.phase,
      providerError: this.providerError,
      token: this.lookup?.token ?? emptyToken(this.address, this.networkDs),
      graph,
      wallets: this.walletSummaries(),
      trades: this.trades.toArray().slice(-120).reverse(),
      ticks: downsample(this.ticks.toArray(), 720),
      signals: this.signals.toArray().slice(-60).reverse(),
      flow: this.flow.snapshot(this.ledger),
      holders: this.holdersSnap,
      sniper: this.radar.list(),
      radarEnabled: Boolean(this.keys.moralis || this.keys.alchemy || this.keys.etherscan),
      health: this.health(),
      price,
    };
  }

  private buildGraph() {
    if (!this.lookup) {
      return { network: this.networkDs, token: emptyToken(this.address, this.networkDs), pairs: [], quotes: [] };
    }
    const pairs = this.lookup.pairs.map((p) => ({ ...p, isPrimary: p.address === this.lookup!.pairs[0]?.address && p.network === this.networkDs }));
    return {
      network: this.networkDs,
      token: this.lookup.token,
      pairs,
      quotes: aggregateQuotes(pairs),
    };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    try {
      // flush the chain-index checkpoint so a restart resumes exactly here
      if (this.indexer && this.indexerReady) history.saveIndexerState(this.address, this.indexer.serializeState());
      // never overwrite saved history when the session died before tracking
      if (this.phase === "tracking" && this.tradesIngested > 0) {
        const wallets = this.ledger.all().map((r) => ({
          address: r.address,
          netQty: r.positionQty,
          buyUsd: r.buyUsd,
          sellUsd: r.sellUsd,
          realizedPnl: r.realizedPnl,
          trades: r.trades,
          wins: r.wins,
          losses: r.losses,
        }));
        history.recordSessionEnd(this.address, {
          sid: this.sid,
          network: this.networkDs,
          endedAt: Date.now(),
          trades: this.tradesIngested,
          price: this.lastPrice,
          wallets: wallets.length,
        }, wallets);
      }
    } catch {
      /* history is best-effort */
    }
    this.bus.emit("stopped", {} as Record<string, never>);
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  // ── Chain indexer (single-token Moralis-lite, keyless) ────────────────────
  private startIndexer(netPairs: { address: string; label: string }[]): void {
    const chain = chainByDs(this.networkDs);
    if (!chain || chain.rpc.length === 0) return; // EVM only
    const pools = new Map<string, string>();
    for (const p of netPairs) pools.set(p.address.toLowerCase(), p.label);
    for (const g of this.gtPools) pools.set(g.address.toLowerCase(), g.name || g.address);
    const endpoints = this.keys.alchemy && chain.alchemy ? [`https://${chain.alchemy}.g.alchemy.com/v2/${this.keys.alchemy}`, ...chain.rpc] : chain.rpc;
    this.indexer = new TokenIndexer({
      token: this.address,
      endpoints,
      pools,
      maxBackfillDays: Number(process.env.INDEXER_MAX_BACKFILL_DAYS ?? 14) || 14,
      liveSince: Date.now(),
    });
    if (this.poolCreatedAt) this.indexer.anchorTs = this.poolCreatedAt;
    void this.indexer.init().then((ok) => {
      this.indexerReady = ok;
      this.bus.emit("health", this.health());
    });
  }

  private async indexerTick(): Promise<void> {
    if (!this.indexer) return;
    if (!this.indexerReady) {
      // retry boot (RPC hiccup / cold start) every 60s
      const now = Date.now();
      if (now - this.indexerInitAttemptAt > 60_000) {
        this.indexerInitAttemptAt = now;
        const ok = await this.indexer.init().catch(() => false);
        if (ok) {
          this.indexerReady = true;
          this.bus.emit("health", this.health());
        }
      }
      return;
    }
    try {
      const res = await this.indexer.poll(this.lastPrice);
      if (res.trades.length) this.ingest(res.trades); // dedupe guard inside ingest
      if (res.backfillCompleted && !this.oldHolderSeeded) {
        this.oldHolderSeeded = true;
        // anyone holding after full backfill was holding BEFORE this session started
        for (const [addr, bal] of this.indexer.balances) {
          if (bal > 0n) {
            const rec = this.ledger.rec(addr);
            if (!rec.hadPositionAtStart) {
              rec.hadPositionAtStart = true;
              rec.priorNetQty = Number(bal) / 10 ** this.indexer.decimals;
            }
          }
        }
        this.rebuildHoldersFromIndex();
        this.bus.emit("holders", this.holdersSnap);
        this.bus.emit("health", this.health());
      }
      const now = Date.now();
      if (this.indexer.phase === "live" && now - this.holderRebuildAt > 30_000) {
        this.holderRebuildAt = now;
        this.rebuildHoldersFromIndex();
      }
      if (now - this.indexerPersistAt > 60_000 && this.indexer) {
        this.indexerPersistAt = now;
        history.saveIndexerState(this.address, this.indexer.serializeState());
      }
      if (now - this.reconcileAt > 300_000 && this.indexer.phase === "live") {
        this.reconcileAt = now;
        void this.indexer.reconcile();
      }
    } catch {
      /* indexer health is surfaced in health() */
    }
  }

  private rebuildHoldersFromIndex(): void {
    if (!this.indexer) return;
    // never downgrade a better on-chain source (moralis / geckoterminal)
    if (this.holdersSnap.source === "moralis" || this.holdersSnap.source === "geckoterminal") return;
    const rows = this.indexer.holders(100);
    if (rows.length === 0) return; // keep derived/previous until the index has data
    this.holdersSnap = {
      updatedAt: Date.now(),
      source: "chain",
      available: true,
      rows,
      top10SharePct: rows.slice(0, 10).reduce((s, r) => s + (r.sharePct > 0 ? r.sharePct : 0), 0),
    };
  }

  /** Light-weight projection for the global scanner (no heavy snapshot()). */
  scanInfo(): ScanInfo {
    const lastSig = this.signals.last(1)[0] ?? null;
    return {
      sid: this.sid,
      address: this.address,
      symbol: this.lookup?.token.symbol ?? "—",
      network: this.networkDs,
      phase: this.phase,
      price: this.lastPrice,
      liquidity: this.lastTick?.liquidityUsd ?? 0,
      wallets: this.ledger.size,
      trades: this.tradesIngested,
      freshInflow1m: this.flow ? this.flow.snapshot(this.ledger).newBuyUsd1m : 0,
      keepAlive: this.keepAlive,
      lastSignal: lastSig ? { kind: lastSig.kind, title: lastSig.title, ts: lastSig.ts, severity: lastSig.severity } : null,
      stopped: this.stopped,
    };
  }
}

// local imports to avoid cycles
import { smartScore as smartScoreOf, classify as classifyOf } from "./analytics/wallets";

function aggregateQuotes(pairs: { quoteSymbol: string; quoteAddress: string; liquidityUsd: number }[]) {
  const m = new Map<string, { symbol: string; address: string; liquidityUsd: number; pairCount: number }>();
  for (const p of pairs) {
    const k = p.quoteAddress || p.quoteSymbol;
    const q = m.get(k) ?? { symbol: p.quoteSymbol, address: p.quoteAddress, liquidityUsd: 0, pairCount: 0 };
    q.liquidityUsd += p.liquidityUsd;
    q.pairCount++;
    m.set(k, q);
  }
  return [...m.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function emptyToken(address: string, network: string) {
  return {
    address,
    symbol: "—",
    name: "Unknown token",
    network,
    priceUsd: 0,
    fdvUsd: null,
    marketCapUsd: null,
    liquidityUsd: 0,
    volume24hUsd: 0,
    volume6hUsd: 0,
    volume1hUsd: 0,
    txns24h: 0,
    buys24h: 0,
    sells24h: 0,
    priceChange24hPct: 0,
    priceChange1hPct: 0,
    priceChange5mPct: 0,
    imageUrl: null,
  };
}
