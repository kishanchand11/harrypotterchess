/**
 * DexScreener provider — keyless, multi-chain token/pair discovery + stats.
 * https://docs.dexscreener.com/api/reference
 */
import { fetchJson, makeHealth, ok, fail, toNum, type Health } from "./shared";
import type { PairNode, TokenMeta } from "../types";

const BASE = "https://api.dexscreener.com";
export const dexscreenerHealth: Health = makeHealth("DexScreener");

interface DsToken {
  address: string;
  name: string;
  symbol: string;
}
interface DsPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: DsToken;
  quoteToken: DsToken;
  priceNative: string;
  priceUsd?: string;
  txns: Record<string, { buys: number; sells: number }>;
  volume: Record<string, number>;
  priceChange: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string; websites?: { url: string }[] };
}

export interface DsLookup {
  token: TokenMeta;
  pairs: PairNode[]; // sorted by liquidity desc
  networks: string[]; // distinct chains this token trades on
}

/** Discover all pairs for a token across chains. Returns null if token unknown.
 *  Results are cached 3s for refresh calls (ticks) and 45s for meta/enrich calls. */
const cache = new Map<string, { at: number; v: DsLookup | null }>();
const CACHE_TTL_MS = 3_000;

export async function dsLookupToken(address: string, ttlMs = CACHE_TTL_MS): Promise<DsLookup | null> {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  try {
    const data = await fetchJson<{ pairs: DsPair[] | null }>(
      `${BASE}/latest/dex/tokens/${key}`,
      { health: dexscreenerHealth },
    );
    const v = ok(dexscreenerHealth, digest(key, data?.pairs ?? null));
    cache.set(key, { at: Date.now(), v });
    return v;
  } catch (e) {
    return fail(dexscreenerHealth, e, `lookup failed: ${e instanceof Error ? e.message : "?"}`);
  }
}

export async function dsRefreshPairs(address: string): Promise<DsLookup | null> {
  return dsLookupToken(address);
}

function digest(address: string, pairs: DsPair[] | null): DsLookup | null {
  if (!pairs || pairs.length === 0) return null;
  const addr = address.toLowerCase();
  // Only pairs where the analyzed token is the BASE: quote-side pairs would
  // report another token's price/identity for our TokenMeta and PairNodes.
  const relevant = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === addr);
  if (relevant.length === 0) return null; // token never traded as base → analyzer can't track it
  const sorted = [...relevant].sort((a, b) => toNum(b.liquidity?.usd) - toNum(a.liquidity?.usd));
  const best = sorted[0];
  const token: TokenMeta = {
    address: best.baseToken.address,
    symbol: best.baseToken.symbol,
    name: best.baseToken.name,
    network: best.chainId,
    priceUsd: toNum(best.priceUsd),
    fdvUsd: best.fdv ?? null,
    marketCapUsd: best.marketCap ?? null,
    liquidityUsd: sorted.reduce((s, p) => s + toNum(p.liquidity?.usd), 0),
    volume24hUsd: sorted.reduce((s, p) => s + toNum(p.volume?.h24), 0),
    volume6hUsd: sorted.reduce((s, p) => s + toNum(p.volume?.h6), 0),
    volume1hUsd: sorted.reduce((s, p) => s + toNum(p.volume?.h1), 0),
    txns24h: sorted.reduce((s, p) => s + (p.txns?.h24 ? p.txns.h24.buys + p.txns.h24.sells : 0), 0),
    buys24h: sorted.reduce((s, p) => s + (p.txns?.h24?.buys ?? 0), 0),
    sells24h: sorted.reduce((s, p) => s + (p.txns?.h24?.sells ?? 0), 0),
    priceChange24hPct: toNum(best.priceChange?.h24),
    priceChange1hPct: toNum(best.priceChange?.h1),
    priceChange5mPct: toNum(best.priceChange?.m5),
    imageUrl: best.info?.imageUrl ?? null,
  };

  const pairsOut: PairNode[] = sorted.map((p) => ({
    address: p.pairAddress,
    label: `${p.baseToken.symbol} / ${p.quoteToken.symbol}${p.labels?.length ? ` (${p.labels[0]})` : ""}`,
    dex: p.dexId,
    network: p.chainId,
    quoteSymbol: p.quoteToken.symbol,
    quoteAddress: p.quoteToken.address,
    baseSymbol: p.baseToken.symbol,
    priceUsd: toNum(p.priceUsd),
    liquidityUsd: toNum(p.liquidity?.usd),
    volume24hUsd: toNum(p.volume?.h24),
    txns24h: (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0),
    buys24h: p.txns?.h24?.buys ?? 0,
    sells24h: p.txns?.h24?.sells ?? 0,
    priceChange24hPct: toNum(p.priceChange?.h24),
    priceChange1hPct: toNum(p.priceChange?.h1),
    priceChange5mPct: toNum(p.priceChange?.m5),
    createdAt: p.pairCreatedAt ?? null,
    url: p.url,
    isPrimary: false,
  }));

  const quotes = new Map<string, { symbol: string; address: string; liquidityUsd: number; pairCount: number }>();
  for (const p of pairsOut) {
    const key = p.quoteAddress || p.quoteSymbol;
    const q = quotes.get(key) ?? { symbol: p.quoteSymbol, address: p.quoteAddress, liquidityUsd: 0, pairCount: 0 };
    q.liquidityUsd += p.liquidityUsd;
    q.pairCount++;
    quotes.set(key, q);
  }

  return { token, pairs: pairsOut, networks: [...new Set(pairsOut.map((p) => p.network))] };
}
