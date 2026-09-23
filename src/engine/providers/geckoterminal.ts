/**
 * GeckoTerminal provider — keyless live per-pool trade tape, pools, OHLCV, holders.
 * Free tier ~30 req/min (raise with GECKOTERMINAL_API_KEY).
 * https://www.geckoterminal.com/dex-api
 */
import { fetchJson, makeHealth, ok, fail, toNum, type Health } from "./shared";
import type { HolderRow } from "../types";

const BASE = "https://api.geckoterminal.com/api/v2";

export const gtHealth: Health = makeHealth("GeckoTerminal");

export function gtHeaders(key?: string): Record<string, string> {
  if (!key) return {};
  // GeckoTerminal demo/pro plans authenticate via these headers
  return key.toLowerCase().startsWith("cgdemo_")
    ? { "x-cg-demo-api-key": key }
    : { "x-cg-pro-api-key": key };
}

interface GtRel {
  data?: { id?: string; type?: string } | null;
}
interface GtObj {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, GtRel>;
}
interface GtResp {
  data?: GtObj[] | GtObj;
  included?: GtObj[];
  meta?: Record<string, unknown>;
  errors?: { detail?: string; title?: string }[];
}

/** Get pools for a token on a GT network; returns pool objects with parsed attrs. */
export async function gtTokenPools(
  network: string,
  token: string,
  key?: string,
): Promise<GtPool[] | null> {
  try {
    const r = await fetchJson<GtResp>(
      `${BASE}/networks/${network}/tokens/${token}/pools?page=1&sort=h24_volume_usd_liquidity_desc`,
      { headers: gtHeaders(key) },
    );
    const arr = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
    const pools = arr
      .filter((o) => o.type === "pool")
      .map((o) => parsePool(o))
      .filter((p): p is GtPool => p !== null);
    return ok(gtHealth, pools);
  } catch (e) {
    return fail(gtHealth, e, `pools: ${e instanceof Error ? e.message : "?"}`);
  }
}

export interface GtPool {
  address: string;
  name: string;
  dex: string;
  createdAt: number | null;
  baseTokenPriceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  reserveUsd: number;
  buys24h: number;
  sells24h: number;
  buys5m: number;
  sells5m: number;
  fdvUsd: number | null;
}

function parsePool(o: GtObj): GtPool | null {
  const a = o.attributes ?? {};
  const addr = String(a.address ?? o.id.split(":")[1] ?? "");
  if (!addr) return null;
  const pc = (a.price_change_percentage ?? {}) as Record<string, unknown>;
  const tx = (a.transactions ?? {}) as Record<string, { buys?: number; sells?: number }>;
  const vol = (a.volume_usd ?? {}) as Record<string, unknown>;
  const dexId = o.relationships?.dex?.data?.id ?? "";
  return {
    address: addr,
    name: String(a.name ?? ""),
    dex: dexId.includes("_") ? dexId.split("_").slice(1).join(" ") : dexId,
    createdAt: a.pool_created_at ? Date.parse(String(a.pool_created_at)) : null,
    baseTokenPriceUsd: toNum(a.base_token_price_usd),
    priceChange5m: toNum(pc.m5),
    priceChange1h: toNum(pc.h1),
    priceChange24h: toNum(pc.h24),
    volume24h: toNum(vol.h24),
    reserveUsd: toNum(a.reserve_in_usd),
    buys24h: tx.h24?.buys ?? 0,
    sells24h: tx.h24?.sells ?? 0,
    buys5m: tx.m5?.buys ?? 0,
    sells5m: tx.m5?.sells ?? 0,
    fdvUsd: a.fdv_usd != null ? toNum(a.fdv_usd) : null,
  };
}

export interface GtTrade {
  wallet: string;
  txHash: string;
  side: "buy" | "sell";
  qty: number; // in analyzed token
  usd: number;
  priceUsd: number;
  ts: number;
}

/**
 * Live trade tape for one pool, parsed defensively to the analyzed base token.
 * `baseTokenId` = GT token id of the analyzed token (e.g. "eth:0x...").
 */
export async function gtPoolTrades(
  network: string,
  poolAddress: string,
  baseTokenId: string,
  key?: string,
): Promise<GtTrade[] | null> {
  try {
    const r = await fetchJson<GtResp>(
      `${BASE}/networks/${network}/pools/${poolAddress}/trades?trade_volume_in_usd_greater_than=0`,
      { headers: gtHeaders(key), timeoutMs: 10_000 },
    );
    const arr = Array.isArray(r.data) ? r.data : [];
    const trades: GtTrade[] = [];
    for (const t of arr) {
      const a = (t.attributes ?? {}) as Record<string, unknown>;
      const rel = t.relationships ?? {};
      const walletId = rel.tx_from_wallet?.data?.id ?? "";
      const wallet = walletId.includes(":") ? walletId.split(":").slice(1).join(":") : walletId;
      if (!wallet) continue;
      const fromTok = (rel.from_token?.data?.id ?? "").toLowerCase();
      const toTok = (rel.to_token?.data?.id ?? "").toLowerCase();
      const base = baseTokenId.toLowerCase();
      const fromVol = toNum(a.from_volume_in_token);
      const toVol = toNum(a.to_volume_in_token);
      const usd = toNum(a.volume_in_usd);
      let side: "buy" | "sell" | null = null;
      let qty = 0;
      if (base && toTok === base) {
        side = "buy";
        qty = toVol;
      } else if (base && fromTok === base) {
        side = "sell";
        qty = fromVol;
      } else {
        const s = String(a.side ?? "").toLowerCase();
        if (s === "buy") {
          side = "buy";
          qty = toVol || (usd && toNum(a.to_token_price_usd) ? usd / toNum(a.to_token_price_usd) : 0);
        } else if (s === "sell") {
          side = "sell";
          qty = fromVol || (usd && toNum(a.from_token_price_usd) ? usd / toNum(a.from_token_price_usd) : 0);
        }
      }
      if (!side || qty <= 0) continue;
      const priceUsd = usd > 0 && qty > 0 ? usd / qty : toNum(side === "buy" ? a.to_token_price_usd : a.from_token_price_usd);
      const tsMs = a.block_timestamp ? Date.parse(String(a.block_timestamp)) : Date.now();
      trades.push({
        // Solana base58 is case-sensitive — only EVM wallets normalize to lowercase
        wallet: network === "solana" || network === "sui" || network === "ton" ? wallet : wallet.toLowerCase(),
        txHash: String(a.tx_hash ?? ""),
        side,
        qty,
        usd,
        priceUsd,
        ts: Number.isFinite(tsMs) ? tsMs : Date.now(),
      });
    }
    return ok(gtHealth, trades);
  } catch (e) {
    return fail(gtHealth, e, `trades: ${e instanceof Error ? e.message : "?"}`);
  }
}

/** Top holders — Pro-gated on GeckoTerminal; gracefully reports unavailability. */
export async function gtTokenHolders(
  network: string,
  token: string,
  key?: string,
): Promise<{ rows: HolderRow[]; supply: number } | null> {
  try {
    const r = await fetchJson<GtResp>(
      `${BASE}/networks/${network}/tokens/${token}/holders?page=1`,
      { headers: gtHeaders(key), timeoutMs: 12_000 },
    );
    const arr = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
    const supply = toNum((r.meta?.["total_supply"] as string) ?? (r.meta?.["token.total_supply"] as string) ?? 0);
    const rows: HolderRow[] = [];
    let rank = 1;
    for (const h of arr) {
      const a = (h.attributes ?? {}) as Record<string, unknown>;
      const addr = String(a.address ?? h.id.split(":")[1] ?? "");
      if (!addr) continue;
      const bal = toNum(a.balance);
      rows.push({
        rank: rank++,
        address: addr.toLowerCase(),
        balance: bal,
        sharePct: supply > 0 ? (bal / supply) * 100 : toNum(a.share ?? 0),
        isContract: Boolean(a.is_contract),
        source: "geckoterminal",
      });
      if (rows.length >= 100) break;
    }
    return ok(gtHealth, { rows, supply });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) {
      gtHealth.state = "degraded";
      gtHealth.detail = "holders endpoint is Pro-gated (free tier)";
      return null;
    }
    return fail(gtHealth, e, `holders: ${e instanceof Error ? e.message : "?"}`);
  }
}
