/**
 * Sniper radar — watches the tracked smart-money wallets and surfaces the
 * NEW tokens they are buying elsewhere (early-entry signals for sniping).
 *
 * Providers, in order of quality:
 *   1. Moralis swaps        (BYO key) — USD values, DEX-aware
 *   2. Alchemy transfers    (BYO key) — raw ERC-20 inbounds, generous free tier
 *   3. Etherscan token txs  (BYO key) — free tier, no USD
 * Symbols/USD are enriched keylessly via DexScreener.
 */
import type { SniperItem } from "../types";
import type { WalletSummary } from "../types";
import { morWalletSwaps } from "../providers/moralis";
import { esWalletTokenTxs } from "../providers/etherscan";
import { alchemyTokenMetadata, alchemyWalletTransfers, alchemySupported } from "../providers/alchemy";
import { chainByDs } from "../chains";
import { dsLookupToken } from "../providers/dexscreener";

export interface RadarKeys {
  moralis?: string;
  etherscan?: string;
  alchemy?: string;
}

export class SniperRadar {
  private seen = new Set<string>();
  private items: SniperItem[] = [];
  private queueIndex = 0;
  private lastRunAt: number | null = null;
  private running = false;

  constructor(private chainDs: string, private analyzedToken: string) {}

  get lastRun(): number | null {
    return this.lastRunAt;
  }

  get enabled(): boolean {
    return true;
  }

  /** Poll a couple of tracked wallets per cycle (staggered to respect limits). */
  async poll(wallets: WalletSummary[], keys: RadarKeys): Promise<SniperItem[]> {
    if (this.running) return [];
    this.running = true;
    this.lastRunAt = Date.now();
    const fresh: SniperItem[] = [];
    try {
      const candidates = wallets.filter((w) => w.smartScore >= 40 && w.trades >= 2).slice(0, 10);
      if (candidates.length === 0) return [];
      const batch = candidates.slice(this.queueIndex, this.queueIndex + 2);
      this.queueIndex = (this.queueIndex + 2) % Math.max(candidates.length, 1);

      const chain = chainByDs(this.chainDs);
      for (const w of batch) {
        if (keys.moralis && chain?.moralis) {
          const swaps = await morWalletSwaps(chain.moralis, w.address, keys.moralis).catch(() => null);
          for (const s of swaps ?? []) {
            if (s.baseAddress === this.analyzedToken.toLowerCase()) continue;
            if (s.side !== "buy") continue;
            fresh.push(this.push({
              wallet: w.address,
              walletScore: w.smartScore,
              walletLabels: w.labels,
              tokenAddress: s.baseAddress,
              tokenSymbol: s.baseSymbol,
              tokenName: s.baseSymbol,
              network: this.chainDs,
              usd: s.usd || null,
              ts: s.ts,
              side: "buy",
              url: `/token/${s.baseAddress}`,
            }));
          }
        } else if (keys.alchemy && alchemySupported(this.chainDs)) {
          const transfers = await alchemyWalletTransfers(this.chainDs, w.address, keys.alchemy, {
            direction: "in",
            maxCount: 50,
          }).catch(() => null);
          if (transfers) {
            // inbound transfers = tokens the wallet received = buys (from pools or peers)
            const byToken = new Map<string, { ts: number; qty: number; asset: string }>();
            for (const t of transfers) {
              if (!t.token || t.token === this.analyzedToken.toLowerCase()) continue;
              const prev = byToken.get(t.token);
              if (prev) {
                prev.qty += t.value;
                prev.ts = Math.max(prev.ts, t.ts);
              } else {
                byToken.set(t.token, { ts: t.ts, qty: t.value, asset: t.asset });
              }
            }
            for (const [token, info] of byToken) {
              fresh.push(this.push({
                wallet: w.address,
                walletScore: w.smartScore,
                walletLabels: w.labels,
                tokenAddress: token,
                tokenSymbol: info.asset === "?" ? "" : info.asset,
                tokenName: info.asset,
                network: this.chainDs,
                usd: null,
                qty: info.qty,
                ts: info.ts,
                side: "buy",
                url: `/token/${token}`,
              }));
            }
          }
        } else if (keys.etherscan && chain?.etherscan) {
          const txs = await esWalletTokenTxs(chain.etherscan, w.address, keys.etherscan, undefined, 100).catch(() => null);
          if (txs) {
            const recent = txs
              .filter((t) => t.to === w.address.toLowerCase() && t.contract !== this.analyzedToken.toLowerCase())
              .slice(0, 12);
            const byToken = new Map<string, { ts: number; symbol: string }>();
            for (const t of recent) {
              const prev = byToken.get(t.contract);
              if (!prev || t.ts > prev.ts) byToken.set(t.contract, { ts: t.ts, symbol: t.symbol });
            }
            for (const [token, info] of byToken) {
              fresh.push(this.push({
                wallet: w.address,
                walletScore: w.smartScore,
                walletLabels: w.labels,
                tokenAddress: token,
                tokenSymbol: info.symbol,
                tokenName: info.symbol,
                network: this.chainDs,
                usd: null,
                ts: info.ts,
                side: "buy",
                url: `/token/${token}`,
              }));
            }
          }
        }
      }
      await this.enrich(keys.alchemy);
      this.items.sort((a, b) => b.ts - a.ts);
      this.items = this.items.slice(0, 120);
      return fresh;
    } finally {
      this.running = false;
    }
  }

  /** Fill missing symbols/USD via DexScreener (keyless) or Alchemy metadata. */
  private async enrich(alchemyKey?: string): Promise<void> {
    const unknown = [
      ...new Set(
        this.items
          .filter((f) => !f.tokenSymbol || f.tokenSymbol === "?" || f.usd == null)
          .map((f) => f.tokenAddress),
      ),
    ].slice(0, 6);
    for (const addr of unknown) {
      const meta = await dsLookupToken(addr).catch(() => null);
      if (meta) {
        for (const f of this.items) {
          if (f.tokenAddress !== addr) continue;
          if (!f.tokenSymbol || f.tokenSymbol === "?") f.tokenSymbol = meta.token.symbol;
          if (f.usd == null && f.qty && meta.token.priceUsd > 0) f.usd = f.qty * meta.token.priceUsd;
        }
      } else if (alchemyKey && alchemySupported(this.chainDs)) {
        const m = await alchemyTokenMetadata(this.chainDs, addr, alchemyKey);
        if (m) for (const f of this.items) if (f.tokenAddress === addr && (!f.tokenSymbol || f.tokenSymbol === "?")) f.tokenSymbol = m.symbol;
      }
    }
  }

  private push(p: Omit<SniperItem, "id">): SniperItem {
    const id = `${p.wallet}:${p.tokenAddress}`;
    const existing = this.items.find((i) => i.id === id);
    if (existing) {
      existing.ts = Math.max(existing.ts, p.ts);
      return existing;
    }
    const item: SniperItem = { ...p, id };
    this.seen.add(id);
    this.items.unshift(item);
    return item;
  }

  /** Demo-mode radar powered by the simulator. */
  pushSim(items: SniperItem[]): SniperItem[] {
    const fresh: SniperItem[] = [];
    for (const it of items) {
      if (!this.items.some((i) => i.id === it.id)) {
        this.items.unshift(it);
        this.seen.add(it.id);
        fresh.push(it);
      }
    }
    this.items = this.items.slice(0, 120);
    return fresh;
  }

  list(): SniperItem[] {
    return this.items;
  }
}
