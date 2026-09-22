/**
 * Flow analytics — "new money vs old money" (requirement: new users buying,
 * old users selling), minute buckets and spike signals.
 */
import type { FlowSnapshot, Signal, Trade } from "../types";
import type { WalletLedger } from "./wallets";

const BUCKET_MS = 60_000;
const MAX_BUCKETS = 90;

interface Bucket {
  ts: number;
  newBuy: number;
  oldSell: number;
  newBuyers: Set<string>;
  oldSellers: Set<string>;
}

export class FlowEngine {
  private buckets = new Map<number, Bucket>();
  private seq = 0;
  private lastSpike = 0;

  constructor(private ledger: WalletLedger, private emitSignal: (s: Signal) => void) {}

  onTrade(t: Trade): void {
    const rec = this.ledger.rec(t.wallet);
    const b = this.bucket(t.ts);
    if (t.side === "buy" && !rec.hadPositionAtStart && rec.trades <= 2) {
      b.newBuy += t.usd;
      b.newBuyers.add(t.wallet);
    } else if (t.side === "sell" && (rec.hadPositionAtStart || rec.sells > rec.buys)) {
      b.oldSell += t.usd;
      b.oldSellers.add(t.wallet);
    }
    this.detectSpike(b);
  }

  private bucket(ts: number): Bucket {
    const k = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
    let b = this.buckets.get(k);
    if (!b) {
      b = { ts: k, newBuy: 0, oldSell: 0, newBuyers: new Set(), oldSellers: new Set() };
      this.buckets.set(k, b);
      if (this.buckets.size > MAX_BUCKETS + 5) {
        const cutoff = k - MAX_BUCKETS * BUCKET_MS;
        for (const key of this.buckets.keys()) if (key < cutoff) this.buckets.delete(key);
      }
    }
    return b;
  }

  private detectSpike(b: Bucket): void {
    const now = Date.now();
    if (now - this.lastSpike < 45_000) return;
    const sorted = [...this.buckets.values()].sort((a, x) => a.ts - x.ts);
    const closed = sorted.filter((x) => x.ts < b.ts);
    const trailing = closed.slice(-10);
    if (trailing.length < 5) return;
    const avgNew = trailing.reduce((s, x) => s + x.newBuy, 0) / trailing.length;
    const avgOld = trailing.reduce((s, x) => s + x.oldSell, 0) / trailing.length;
    if (b.newBuy > Math.max(3_000, avgNew * 3) && b.newBuyers.size >= 4) {
      this.lastSpike = now;
      this.emitSignal({
        id: `FRESH_INFLOW-${now}-${this.seq++}`,
        ts: now,
        kind: "FRESH_INFLOW_SPIKE",
        severity: "info",
        title: `Fresh-wallet inflow spike — $${Math.round(b.newBuy).toLocaleString()} in a minute`,
        detail: `${b.newBuyers.size} first-seen wallets bought this window (trailing avg $${Math.round(avgNew).toLocaleString()}). Organic interest or coordinated marketing — watch continuation.`,
        wallets: [...b.newBuyers].slice(0, 10),
        usd: b.newBuy,
      });
    }
    if (b.oldSell > Math.max(3_000, avgOld * 3) && b.oldSellers.size >= 3) {
      this.lastSpike = now;
      this.emitSignal({
        id: `OLD_OUTFLOW-${now}-${this.seq++}`,
        ts: now,
        kind: "OLD_OUTFLOW_SPIKE",
        severity: "warn",
        title: `Old-holder distribution — $${Math.round(b.oldSell).toLocaleString()} sold in a minute`,
        detail: `${b.oldSellers.size} wallets that held before tracking dumped this window (trailing avg $${Math.round(avgOld).toLocaleString()}). Distribution risk rising.`,
        wallets: [...b.oldSellers].slice(0, 10),
        usd: b.oldSell,
      });
    }
  }

  snapshot(ledger: WalletLedger): FlowSnapshot {
    const now = Date.now();
    const buckets = [...this.buckets.values()].sort((a, b) => a.ts - b.ts).slice(-MAX_BUCKETS);
    const out: [number, number, number][] = buckets.map((b) => [b.ts, Math.round(b.newBuy), Math.round(b.oldSell)]);
    let newBuyTotal = 0;
    let oldSellTotal = 0;
    let newWallets = 0;
    let oldWallets = 0;
    for (const rec of ledger.all()) {
      if (rec.hadPositionAtStart) {
        oldWallets++;
        oldSellTotal += rec.sellUsd;
      } else {
        newWallets++;
        newBuyTotal += rec.buyUsd;
      }
    }
    const last = buckets[buckets.length - 1];
    return {
      ts: now,
      newBuyUsd1m: last?.newBuy ?? 0,
      oldSellUsd1m: last?.oldSell ?? 0,
      newBuyers1m: last?.newBuyers.size ?? 0,
      oldSellers1m: last?.oldSellers.size ?? 0,
      newBuyUsdTotal: Math.round(newBuyTotal),
      oldSellUsdTotal: Math.round(oldSellTotal),
      newWallets,
      oldWallets,
      buckets: out, // includes the currently-open bucket for a live feel
    };
  }
}
