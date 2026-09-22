/**
 * Impact engine — attributes price movement to the wallets trading in each
 * tick window, producing per-wallet "price impact" and market timing scores,
 * plus pump/dump burst signals.
 */
import type { Signal, Tick, Trade } from "../types";
import type { WalletLedger } from "./wallets";

interface WindowTrade {
  wallet: string;
  usd: number;
  side: "buy" | "sell";
  ts: number;
  txHash: string;
}

export class ImpactEngine {
  private window: WindowTrade[] = [];
  private lastTick: Tick | null = null;
  private recentDeltas: number[] = []; // for volatility baseline
  private priceAtWindowStart = 0;
  private burstCooldown = new Map<string, number>();
  private seq = 0;

  constructor(
    private ledger: WalletLedger,
    private emitSignal: (s: Signal) => void,
  ) {}

  pushTrade(t: Trade): void {
    this.window.push({ wallet: t.wallet, usd: t.usd, side: t.side, ts: t.ts, txHash: t.txHash });
  }

  /** Called on every price tick. Attributes delta to window trades and closes the window. */
  onTick(tick: Tick): void {
    const prev = this.lastTick;
    this.lastTick = tick;
    if (!prev) {
      this.priceAtWindowStart = tick.priceUsd;
      return;
    }
    const deltaPct = prev.priceUsd > 0 ? ((tick.priceUsd - prev.priceUsd) / prev.priceUsd) * 100 : 0;
    this.recentDeltas.push(deltaPct);
    if (this.recentDeltas.length > 60) this.recentDeltas.shift();

    const trades = this.window;
    this.window = [];
    this.priceAtWindowStart = tick.priceUsd;
    if (trades.length === 0) return;

    // weight trades by USD; bigger trades "explain" more of the move
    const totalUsd = trades.reduce((s, t) => s + t.usd, 0);
    if (totalUsd <= 0) return;

    const netBuyUsd = trades.reduce((s, t) => s + (t.side === "buy" ? t.usd : -t.usd), 0);
    const sameDir = (netBuyUsd > 0 && deltaPct > 0) || (netBuyUsd < 0 && deltaPct < 0);
    // share of move attributable to flow vs noise (simple R-squared proxy)
    const liquidity = Math.max(tick.liquidityUsd, 1);
    const expectedPct = ((netBuyUsd / liquidity) * 100) * 1.8; // k=1.8 flow→price elasticity
    const explained = Math.sign(expectedPct) === Math.sign(deltaPct)
      ? Math.min(1, Math.abs(expectedPct) / Math.max(Math.abs(deltaPct), 1e-9))
      : 0.15;
    const attribution = sameDir ? 0.5 + 0.5 * explained : 0.15 * explained;

    for (const t of trades) {
      const rec = this.ledger.rec(t.wallet);
      const share = (t.usd / totalUsd) * deltaPct * attribution; // % of price move
      const per1k = (share / Math.max(t.usd / 1000, 0.001));
      rec.applyImpact(per1k);
      const sign: -1 | 0 | 1 = deltaPct === 0 ? 0 : (t.side === "buy" ? (deltaPct > 0 ? 1 : -1) : deltaPct < 0 ? 1 : -1);
      rec.applyTiming(sign);
    }

    // ── Burst detection ──────────────────────────────────────────────────────
    const vol = this.volBaseline();
    const burstThreshold = Math.max(2.2, vol * 4);
    if (Math.abs(deltaPct) >= burstThreshold) {
      const kind = deltaPct > 0 ? "PUMP_BURST" : "DUMP_BURST";
      const now = Date.now();
      if ((this.burstCooldown.get(kind) ?? 0) < now - 20_000) {
        this.burstCooldown.set(kind, now);
        const top = [...trades].sort((a, b) => b.usd - a.usd).slice(0, 6);
        this.emitSignal({
          id: `${kind}-${now}-${this.seq++}`,
          ts: now,
          kind,
          severity: Math.abs(deltaPct) > burstThreshold * 2 ? "critical" : "warn",
          title: deltaPct > 0 ? `▲ Pump burst ${deltaPct.toFixed(2)}%` : `▼ Dump burst ${deltaPct.toFixed(2)}%`,
          detail:
            `${netBuyUsd > 0 ? "Net buying" : "Net selling"} of $${Math.abs(netBuyUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })} ` +
            `across ${trades.length} trades in the tick window. Top: ` +
            top.map((t) => `${t.wallet.slice(0, 6)}…($${Math.round(t.usd).toLocaleString()})`).join(", "),
          wallets: [...new Set(trades.map((t) => t.wallet))].slice(0, 10),
          usd: totalUsd,
          priceUsd: tick.priceUsd,
          priceDeltaPct: deltaPct,
        });
      }
    }
  }

  private volBaseline(): number {
    if (this.recentDeltas.length < 8) return 0.8;
    const mean = this.recentDeltas.reduce((s, d) => s + d, 0) / this.recentDeltas.length;
    const variance =
      this.recentDeltas.reduce((s, d) => s + (d - mean) ** 2, 0) / this.recentDeltas.length;
    return Math.sqrt(variance);
  }
}
