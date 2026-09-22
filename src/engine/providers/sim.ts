/**
 * Simulated market tape — automatic fallback when live providers are
 * unreachable (e.g. sandboxed networks). It reproduces a realistic meme-coin
 * order flow: fresh wallets, sniper bundles, whales, dumpers and smart money,
 * with price that actually REACTS to net flow — so the full analytics stack
 * (impact attribution, flow, clusters, scoring) runs on real math.
 *
 * The UI clearly labels simulated sessions: `mode: "simulated"`.
 */
import type { PairNode, SniperItem, Tick, TokenMeta, Trade } from "../types";

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const hex = (n: number) =>
  "0x" +
  Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

type Persona = "whale" | "sniper" | "smart" | "dumper" | "fresh" | "retail";

interface SimWallet {
  address: string;
  persona: Persona;
  qty: number; // token position
  avgPrice: number;
  nextAt: number;
  interval: [number, number];
  size: [number, number]; // usd range
  bias: number; // -1 sell-heavy .. +1 buy-heavy
  skill: number; // 0..1 entry timing skill
}

const FAKE_TOKENS: [string, string][] = [
  ["MOONPIG", "MoonPig"],
  ["TURBO2", "Turbo Two"],
  ["WIFDOG", "Dogwifdog"],
  ["GIGA", "Gigachad Coin"],
  ["RETARDIO", "Retardio"],
  ["POPcat2", "Popcat II"],
  ["NEIRO", "Neiro"],
  ["BOME", "Book of Memes"],
];

export class SimMarket {
  readonly mode = "simulated" as const;
  readonly startedAt = Date.now();
  private wallets: SimWallet[] = [];
  private price: number;
  private liquidity: number;
  private volume24h: number;
  private regime: { until: number; drift: number } | null = null;
  private nextRegimeAt: number;
  private seq = 0;
  private txSeq = 0;
  private tape: { ts: number; side: "buy" | "sell"; usd: number }[] = [];
  readonly token: TokenMeta;
  readonly pools: PairNode[];
  readonly poolCreatedAt: number;

  constructor(tokenAddress: string, network: string) {
    const isSol = network === "solana";
    const addr = (s: string) => (isSol ? s.slice(0, 44) : s);
    this.price = rand(0.0000042, 0.00019);
    this.liquidity = rand(180_000, 1_400_000);
    this.volume24h = this.liquidity * rand(0.4, 2.6);
    this.poolCreatedAt = this.startedAt - 47 * 60_000;

    this.token = {
      address: tokenAddress,
      symbol: "DEMO",
      name: "Demo Token (simulated)",
      network,
      priceUsd: this.price,
      fdvUsd: this.price * 420_690_000_000,
      marketCapUsd: this.price * 420_690_000_000 * 0.93,
      liquidityUsd: this.liquidity,
      volume24hUsd: this.volume24h,
      volume6hUsd: this.volume24h * 0.42,
      volume1hUsd: this.volume24h * 0.08,
      txns24h: 9_412,
      buys24h: 5_288,
      sells24h: 4_124,
      priceChange24hPct: rand(-18, 64),
      priceChange1hPct: rand(-9, 14),
      priceChange5mPct: rand(-4, 4),
      imageUrl: null,
    };

    const q1 = isSol ? "SOL" : "WETH";
    const q2 = "USDC";
    this.pools = [
      {
        address: hex(40),
        label: `DEMO / ${q1}`,
        dex: "uniswap v3",
        network,
        quoteSymbol: q1,
        quoteAddress: hex(40),
        baseSymbol: "DEMO",
        priceUsd: this.price,
        liquidityUsd: this.liquidity,
        volume24hUsd: this.volume24h * 0.82,
        txns24h: 8_102,
        buys24h: 4_500,
        sells24h: 3_602,
        priceChange24hPct: this.token.priceChange24hPct,
        priceChange1hPct: this.token.priceChange1hPct,
        priceChange5mPct: 0,
        createdAt: this.poolCreatedAt,
        url: "#",
        isPrimary: true,
      },
      {
        address: hex(40),
        label: `DEMO / ${q2}`,
        dex: "uniswap v2",
        network,
        quoteSymbol: q2,
        quoteAddress: hex(40),
        baseSymbol: "DEMO",
        priceUsd: this.price * 1.001,
        liquidityUsd: this.liquidity * 0.21,
        volume24hUsd: this.volume24h * 0.14,
        txns24h: 1_210,
        buys24h: 690,
        sells24h: 520,
        priceChange24hPct: this.token.priceChange24hPct,
        priceChange1hPct: this.token.priceChange1hPct,
        priceChange5mPct: 0,
        createdAt: this.poolCreatedAt + 22 * 60_000,
        url: "#",
        isPrimary: false,
      },
      {
        address: hex(40),
        label: `DEMO / ${q1}`,
        dex: "aerodrome",
        network,
        quoteSymbol: q1,
        quoteAddress: hex(40),
        baseSymbol: "DEMO",
        priceUsd: this.price * 0.997,
        liquidityUsd: this.liquidity * 0.09,
        volume24hUsd: this.volume24h * 0.04,
        txns24h: 100,
        buys24h: 98,
        sells24h: 2,
        priceChange24hPct: this.token.priceChange24hPct,
        priceChange1hPct: this.token.priceChange1hPct,
        priceChange5mPct: 0,
        createdAt: this.poolCreatedAt + 40 * 60_000,
        url: "#",
        isPrimary: false,
      },
    ];
    void addr;

    // ── Population ──────────────────────────────────────────────────────────
    const spawn = (persona: Persona, n: number, p: Partial<SimWallet>) => {
      for (let i = 0; i < n; i++) {
        this.wallets.push({
          address: hex(40),
          persona,
          qty: 0,
          avgPrice: 0,
          nextAt: this.startedAt + rand(200, 30_000),
          interval: [4_000, 40_000],
          size: [80, 900],
          bias: rand(-0.2, 0.5),
          skill: rand(0.3, 0.6),
          ...p,
        });
      }
    };
    spawn("whale", 4, { interval: [25_000, 90_000], size: [15_000, 60_000], skill: 0.55, bias: 0.1 });
    spawn("sniper", 7, { interval: [60_000, 300_000], size: [3_000, 14_000], skill: 0.7, bias: 0.15 });
    spawn("smart", 8, { interval: [20_000, 80_000], size: [1_200, 8_000], skill: 0.9, bias: 0.2 });
    spawn("dumper", 9, { interval: [30_000, 120_000], size: [2_000, 12_000], skill: 0.35, bias: -0.7 });
    spawn("retail", 22, { interval: [3_000, 20_000], size: [60, 900], skill: 0.45, bias: 0.15 });
    // fresh wallets spawn over time
    for (let i = 0; i < 26; i++) {
      this.wallets.push({
        address: hex(40),
        persona: "fresh",
        qty: 0,
        avgPrice: 0,
        nextAt: this.startedAt + rand(5_000, 25 * 60_000),
        interval: [8_000, 60_000],
        size: [40, 700],
        bias: rand(0.3, 0.9),
        skill: rand(0.1, 0.5),
      });
    }
    // snipers open with a bundle at start
    const snipers = this.wallets.filter((w) => w.persona === "sniper");
    for (const s of snipers) {
      s.qty = rand(3_000, 14_000) / this.price;
      s.avgPrice = this.price;
      s.nextAt = this.startedAt + rand(90_000, 400_000);
    }
    // old holders pre-seed (they will sell)
    for (const w of this.wallets.filter((x) => x.persona === "dumper")) {
      w.qty = rand(4_000, 18_000) / this.price;
      w.avgPrice = this.price * rand(0.3, 0.75);
    }
    this.nextRegimeAt = this.startedAt + rand(20_000, 60_000);
  }

  /** Advance the market by one step; returns new trades since last call. */
  step(now: number): { trades: Trade[]; tick: Tick } {
    // regime shifts create pump/dump phases
    if (now > this.nextRegimeAt) {
      const pump = Math.random() < 0.5;
      this.regime = { until: now + rand(15_000, 70_000), drift: pump ? rand(0.0004, 0.0016) : -rand(0.0005, 0.0018) };
      this.nextRegimeAt = this.regime.until + rand(10_000, 60_000);
    }
    const drift = this.regime && now < this.regime.until ? this.regime.drift : rand(-0.0004, 0.0005);

    // persona behavior
    const trades: Trade[] = [];
    let netUsd = 0;
    for (const w of this.wallets) {
      if (now < w.nextAt) continue;
      w.nextAt = now + rand(w.interval[0], w.interval[1]);
      // fresh wallets only buy (they are entering)
      let side: "buy" | "sell";
      const inProfit = w.avgPrice > 0 && this.price > w.avgPrice * 1.25;
      if (w.persona === "fresh") side = "buy";
      else if (w.persona === "smart") {
        // smart: buy dips, sell pumps
        side = this.price < w.avgPrice * 0.99 || Math.random() < 0.55 ? (w.qty < 1 ? "buy" : Math.random() < 0.5 ? "buy" : "sell") : "sell";
      } else if (w.persona === "dumper") {
        side = inProfit || Math.random() < 0.7 ? (w.qty > 0 ? "sell" : "buy") : "buy";
      } else {
        side = Math.random() < 0.5 + w.bias * 0.5 ? "buy" : "sell";
        if (side === "sell" && w.qty <= 0) side = "buy";
      }
      const usd = rand(w.size[0], w.size[1]) * (0.6 + Math.random() * 0.8);
      const qty = usd / this.price;
      if (side === "buy") {
        w.qty += qty;
        w.avgPrice = w.avgPrice > 0 ? (w.avgPrice * (w.qty - qty) + this.price * qty) / w.qty : this.price;
      } else {
        const sellQty = Math.min(qty, w.qty);
        if (sellQty <= 0) continue;
        w.qty -= sellQty;
      }
      netUsd += side === "buy" ? usd : -usd;
      const pool = pick(this.pools);
      trades.push({
        id: `sim-${this.seq++}`,
        ts: now,
        wallet: w.address,
        txHash: `0xsim${(this.txSeq++).toString(36)}`,
        side,
        priceUsd: this.price,
        qty,
        usd,
        pool: pool.address,
        poolLabel: pool.label,
        dex: pool.dex,
        quoteSymbol: pool.quoteSymbol,
        source: "sim",
      });
    }

    // occasional sniper bundle (3-5 wallets, one tx)
    if (Math.random() < 0.012) {
      const bundle = this.wallets.filter((w) => w.persona === "retail").slice(0, 3 + Math.floor(Math.random() * 3));
      const txHash = `0xbundle${(this.txSeq++).toString(36)}`;
      for (const w of bundle) {
        const usd = rand(800, 5_000);
        const qty = usd / this.price;
        w.qty += qty;
        w.avgPrice = this.price;
        netUsd += usd;
        trades.push({
          id: `sim-${this.seq++}`,
          ts: now,
          wallet: w.address,
          txHash,
          side: "buy",
          priceUsd: this.price,
          qty,
          usd,
          pool: this.pools[0].address,
          poolLabel: this.pools[0].label,
          dex: this.pools[0].dex,
          quoteSymbol: this.pools[0].quoteSymbol,
          source: "sim",
        });
      }
    }

    // price reacts to net flow + noise + drift (flow → price elasticity)
    const impact = (netUsd / this.liquidity) * 1.9;
    this.price = Math.max(1e-9, this.price * (1 + drift + impact + rand(-0.002, 0.002)));
    this.volume24h += trades.reduce((s, t) => s + t.usd, 0) * 2.4; // extrapolate
    this.liquidity *= 1 + rand(-0.0008, 0.0009);
    this.liquidity = Math.max(20_000, this.liquidity);

    // rolling 1m tape for tick aggregates
    this.tape.push(...trades.map((t) => ({ ts: t.ts, side: t.side, usd: t.usd })));
    this.tape = this.tape.filter((t) => t.ts >= now - 60_000);
    const buys1m = this.tape.filter((t) => t.side === "buy").length;
    const sells1m = this.tape.length - buys1m;

    // sync public meta + pools
    this.token.priceUsd = this.price;
    this.token.liquidityUsd = this.liquidity;
    this.token.volume24hUsd = this.volume24h;
    for (const p of this.pools) {
      p.priceUsd = this.price * rand(0.999, 1.001);
      p.liquidityUsd = p === this.pools[0] ? this.liquidity : this.liquidity * 0.15;
    }

    const tick: Tick = {
      ts: now,
      priceUsd: this.price,
      liquidityUsd: this.liquidity,
      volume24hUsd: this.volume24h,
      buys1m,
      sells1m,
      buyUsd1m: this.tape.filter((t) => t.side === "buy").reduce((s, t) => s + t.usd, 0),
      sellUsd1m: this.tape.filter((t) => t.side === "sell").reduce((s, t) => s + t.usd, 0),
    };
    return { trades, tick };
  }

  /** Fake cross-token radar for tracked smart wallets (sim mode). */
  radarItems(smartWallets: { address: string; smartScore: number; labels: string[] }[]): SniperItem[] {
    if (Math.random() > 0.4 || smartWallets.length === 0) return [];
    const w = pick(smartWallets);
    const [sym, name] = pick(FAKE_TOKENS);
    return [
      {
        id: `${w.address}:${sym}`,
        wallet: w.address,
        walletScore: w.smartScore,
        walletLabels: w.labels,
        tokenAddress: hex(40),
        tokenSymbol: sym,
        tokenName: `${name} (simulated)`,
        network: this.token.network,
        usd: Math.round(rand(300, 9_000)),
        ts: Date.now(),
        side: "buy",
        url: "#",
      },
    ];
  }
}
