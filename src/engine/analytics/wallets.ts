/**
 * Wallet ledger — per-wallet position accounting (FIFO realized PnL),
 * behavioral scoring and Nansen-style classification.
 */
import type { Side, Trade, WalletClass, WalletSummary } from "../types";

interface Lot {
  qty: number;
  price: number;
  ts: number;
}

export class WalletRec {
  address: string;
  firstSeen = 0;
  lastActive = 0;
  trades = 0;
  buys = 0;
  sells = 0;
  buyUsd = 0;
  sellUsd = 0;
  buyQty = 0;
  sellQty = 0;
  avgBuyPrice = 0;
  avgSellPrice = 0;
  realizedPnl = 0;
  realizedKnown = false; // became true once a sell matched a tracked buy lot
  hadPositionAtStart = false; // sold tokens it never bought in our tape
  soldUntrackedQty = 0;
  positionQty = 0;
  maxPositionUsd = 0;
  realizedAtTrip = 0; // realized PnL accumulated during current position
  roundTrips = 0;
  wins = 0;
  losses = 0;
  impactEma = 0; // % price move per $1k traded, EMA
  timingEma = 0; // -1..1
  bundleCount = 0;
  lastSide: Side = "buy";
  lastTradeUsd = 0;
  snipedAt: number | null = null; // bought near pool creation
  private lots: Lot[] = [];

  constructor(address: string) {
    this.address = address;
  }

  apply(t: Trade, sessionStart: number, poolCreatedAt: number | null): void {
    this.trades++;
    this.lastActive = t.ts;
    this.lastSide = t.side;
    this.lastTradeUsd = t.usd;
    if (!this.firstSeen) this.firstSeen = t.ts;

    if (t.side === "buy") {
      this.buys++;
      this.buyUsd += t.usd;
      this.buyQty += t.qty;
      this.avgBuyPrice = this.buyQty > 0 ? this.buyUsd / this.buyQty : 0;
      this.lots.push({ qty: t.qty, price: t.priceUsd, ts: t.ts });
      this.positionQty += t.qty;
      if (poolCreatedAt && t.ts - poolCreatedAt < 30 * 60_000) {
        this.snipedAt = this.snipedAt ?? t.ts;
      }
    } else {
      this.sells++;
      this.sellUsd += t.usd;
      this.sellQty += t.qty;
      this.avgSellPrice = this.sellQty > 0 ? this.sellUsd / this.sellQty : 0;

      let remaining = t.qty;
      if (this.positionQty <= 1e-12 && this.trades > 1) {
        // selling with no tracked position → pre-existing (old holder)
        this.hadPositionAtStart = true;
        this.soldUntrackedQty += remaining;
      }
      while (remaining > 1e-12 && this.lots.length > 0) {
        const lot = this.lots[0];
        const take = Math.min(lot.qty, remaining);
        const pnl = take * (t.priceUsd - lot.price);
        this.realizedPnl += pnl;
        this.realizedKnown = true;
        this.realizedAtTrip += pnl;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-12) this.lots.shift();
      }
      if (remaining > 1e-12) {
        this.hadPositionAtStart = true;
        this.soldUntrackedQty += remaining;
      }
      this.positionQty = Math.max(0, this.positionQty - t.qty);
      if (this.positionQty <= 1e-9 && this.realizedAtTrip !== 0) {
        this.roundTrips++;
        if (this.realizedAtTrip > 0) this.wins++;
        else this.losses++;
        this.realizedAtTrip = 0;
      }
    }
  }

  get winRate(): number | null {
    return this.roundTrips > 0 ? this.wins / this.roundTrips : null;
  }

  applyImpact(pctPer1k: number): void {
    this.impactEma = this.impactEma === 0 ? pctPer1k : this.impactEma * 0.7 + pctPer1k * 0.3;
  }

  applyTiming(sign: -1 | 0 | 1): void {
    this.timingEma = this.timingEma * 0.75 + sign * 0.25;
  }

  markBundle(): void {
    this.bundleCount++;
  }

  summary(priceNow: number): WalletSummary {
    const isNew = this.firstSeen >= 0 && !this.hadPositionAtStart && this.trades > 0;
    const pos = this.positionQty * priceNow;
    if (pos > this.maxPositionUsd) this.maxPositionUsd = pos;
    const unrealized = this.positionQty * (priceNow - this.avgBuyPrice);
    return {
      address: this.address,
      firstSeen: this.firstSeen,
      lastActive: this.lastActive,
      trades: this.trades,
      buys: this.buys,
      sells: this.sells,
      buyUsd: this.buyUsd,
      sellUsd: this.sellUsd,
      netQty: this.positionQty,
      positionUsd: pos,
      avgBuyPrice: this.avgBuyPrice,
      avgSellPrice: this.avgSellPrice,
      realizedPnl: this.realizedKnown ? this.realizedPnl : this.realizedPnl || null,
      unrealizedPnl: this.avgBuyPrice > 0 ? unrealized : 0,
      hadPositionAtStart: this.hadPositionAtStart,
      isNew,
      winRate: this.winRate,
      impactScore: this.impactEma,
      timingScore: this.timingEma,
      smartScore: 0,
      labels: [],
      klass: "active",
      lastSide: this.lastSide,
      lastTradeUsd: this.lastTradeUsd,
      bundleCount: this.bundleCount,
    };
  }
}

export interface LedgerCtx {
  priceNow: number;
  liquidityUsd: number;
  poolCreatedAt: number | null;
  sessionStart: number;
}

export class WalletLedger {
  private map = new Map<string, WalletRec>();

  get size(): number {
    return this.map.size;
  }

  rec(address: string): WalletRec {
    let r = this.map.get(address);
    if (!r) {
      r = new WalletRec(address);
      this.map.set(address, r);
    }
    return r;
  }

  apply(t: Trade, ctx: LedgerCtx): WalletRec {
    const r = this.rec(t.wallet);
    r.apply(t, ctx.sessionStart, ctx.poolCreatedAt);
    return r;
  }

  all(): WalletRec[] {
    return [...this.map.values()];
  }

  /** Scored + classified summaries, sorted by smartScore then activity. */
  summarize(priceNow: number, liquidityUsd: number): WalletSummary[] {
    const out = this.all().map((r) => r.summary(priceNow));
    for (const s of out) {
      s.smartScore = smartScore(s);
      const { klass, labels } = classify(s, liquidityUsd);
      s.klass = klass;
      s.labels = labels;
    }
    out.sort((a, b) => b.smartScore - a.smartScore || b.trades - a.trades);
    return out;
  }
}

/** Composite 0..100 smart-money score. */
export function smartScore(s: WalletSummary): number {
  if (s.trades < 2) return 0;
  const pnlScale = Math.max(2_000, s.sellUsd * 0.25);
  const pnl01 = s.realizedPnl != null ? Math.tanh(s.realizedPnl / pnlScale) : 0;
  const timing01 = (s.timingScore + 1) / 2;
  const impact01 = Math.tanh(Math.abs(s.impactScore) / 1.2); // magnitude of footprint
  const wr01 = s.winRate ?? 0.5;
  const activity01 = Math.min(s.trades / 12, 1);
  const raw =
    0.36 * Math.max(0, pnl01) +
    0.26 * timing01 +
    0.14 * impact01 +
    0.14 * wr01 +
    0.1 * activity01;
  return Math.round(Math.min(100, Math.max(0, raw * 100)) * 10) / 10;
}

export function classify(
  s: WalletSummary,
  liquidityUsd: number,
): { klass: WalletClass; labels: string[] } {
  const labels: string[] = [];
  const whaleUsd = Math.max(25_000, liquidityUsd * 0.02);
  const bigUsd = Math.max(5_000, liquidityUsd * 0.005);

  if (s.lastTradeUsd >= whaleUsd || s.buyUsd >= whaleUsd) labels.push("Whale");
  if (s.bundleCount >= 2) labels.push("Bundled");
  if (s.trades >= 3 && s.smartScore >= 65) labels.push("Smart Money");
  if (s.hadPositionAtStart) labels.push("Old Holder");
  if (s.isNew) labels.push("Fresh");

  let klass: WalletClass = "active";
  if (s.trades >= 3 && s.smartScore >= 65) klass = "smart-money";
  else if (s.sellUsd >= bigUsd && (s.realizedPnl ?? 0) > 0 && s.sells >= s.buys && s.timingScore < 0.1 && s.impactScore < 0)
    klass = "dumper";
  else if (s.buyUsd >= bigUsd && s.impactScore > 0.15) klass = "pumper";
  else if (s.hadPositionAtStart && s.sells >= 2) klass = "old-holder";
  else if (s.buys >= 3 && s.sells === 0 && s.buyUsd >= bigUsd * 0.5) klass = "accumulator";
  else if (s.sells >= 3 && s.netQty <= 1e-9) klass = "distributor";
  else if (labels.includes("Whale")) klass = "whale";
  else if (s.isNew && s.buys >= 1) klass = "fresh-wallet";
  return { klass, labels };
}
