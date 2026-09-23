/**
 * Cluster detection — sniper bundles (multiple wallets, same tx) and
 * coordinated buy/sell bursts inside a short window.
 */
import type { Signal, Trade } from "../types";
import type { WalletLedger } from "./wallets";

const WINDOW_MS = 6_000;

export class ClusterEngine {
  private buf: Trade[] = [];
  private lastFire = 0;
  private seq = 0;

  constructor(
    private ledger: WalletLedger,
    private liquidityUsd: () => number,
    private emitSignal: (s: Signal) => void,
  ) {}

  onTrade(t: Trade): void {
    this.buf.push(t);
    const cutoff = t.ts - WINDOW_MS * 4;
    this.buf = this.buf.filter((x) => x.ts >= cutoff);
    this.evaluate(t.ts);
  }

  private evaluate(now: number): void {
    const recent = this.buf.filter((x) => x.ts >= now - WINDOW_MS);
    if (recent.length < 3) return;
    for (const side of ["buy", "sell"] as const) {
      const sideTrades = recent.filter((t) => t.side === side);
      if (sideTrades.length < 3) continue;
      const wallets = new Set(sideTrades.map((t) => t.wallet));
      if (wallets.size < 3) continue;
      const totalUsd = sideTrades.reduce((s, t) => s + t.usd, 0);
      const minUsd = Math.max(4_000, this.liquidityUsd() * 0.004);
      if (totalUsd < minUsd) continue;

      // bundle: ≥2 wallets in the exact same tx
      const byTx = new Map<string, Set<string>>();
      for (const t of sideTrades) {
        const set = byTx.get(t.txHash) ?? new Set<string>();
        set.add(t.wallet);
        byTx.set(t.txHash, set);
      }
      let bundled = 0;
      for (const set of byTx.values()) {
        if (set.size >= 2) {
          bundled += set.size;
          for (const w of set) this.ledger.rec(w).markBundle();
        }
      }
      if (now - this.lastFire < 12_000) continue;
      this.lastFire = now;
      const isBuy = side === "buy";
      this.emitSignal({
        id: `${isBuy ? "SNIPE_CLUSTER" : "EXIT_CLUSTER"}-${now}-${this.seq++}`,
        ts: now,
        kind: isBuy ? "SNIPE_CLUSTER" : "EXIT_CLUSTER",
        severity: isBuy ? "info" : "warn",
        title: isBuy
          ? `Sniper cluster — ${wallets.size} wallets bought $${Math.round(totalUsd).toLocaleString()} together`
          : `Exit cluster — ${wallets.size} wallets dumped $${Math.round(totalUsd).toLocaleString()} together`,
        detail:
          (bundled >= 2 ? `${bundled} wallets share the same transaction hash (bundle). ` : "") +
          `${wallets.size} distinct wallets ${isBuy ? "bought" : "sold"} within ${WINDOW_MS / 1000}s — likely coordinated (bundle bot or alpha group).`,
        wallets: [...wallets].slice(0, 12),
        usd: totalUsd,
      });
    }
  }
}
