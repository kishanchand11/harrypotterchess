/**
 * Moralis Web3 Data provider — BRING YOUR OWN KEY.
 * Unlocks: full top-holders list + per-wallet DEX swap history (radar).
 * https://docs.moralis.io/
 */
import { fetchJson, makeHealth, ok, fail, toNum, type Health } from "./shared";
import type { HolderRow } from "../types";

export const moralisHealth: Health = makeHealth("Moralis (BYO key)");
const BASE = "https://deep-index.moralis.io/api/v2.2";

function headers(key: string): Record<string, string> {
  return { "X-API-Key": key };
}

/** Top holders of an ERC-20 via token owners endpoint. */
export async function morTokenHolders(
  chainHex: string,
  token: string,
  key: string,
): Promise<HolderRow[] | null> {
  try {
    const r = await fetchJson<{ result?: Record<string, unknown>[] }>(
      `${BASE}/token/${token}/owners?chain=${chainHex}&order=DESC`,
      { headers: headers(key), timeoutMs: 15_000 },
    );
    const rows: HolderRow[] = [];
    let rank = 1;
    for (const h of r.result ?? []) {
      const addr = String(h.owner_address ?? h.address ?? "").toLowerCase();
      if (!addr) continue;
      rows.push({
        rank: rank++,
        address: addr,
        balance: toNum(h.balance) / 10 ** (toNum(h.decimals) || 18),
        sharePct: toNum(h.percentage_relative_to_total_supply ?? h.owner_percentage ?? 0),
        isContract: Boolean(h.is_contract),
        source: "moralis",
      });
      if (rows.length >= 100) break;
    }
    return ok(moralisHealth, rows);
  } catch (e) {
    return fail(moralisHealth, e, `owners: ${e instanceof Error ? e.message : "?"}`);
  }
}

export interface MorSwap {
  wallet: string;
  txHash: string;
  ts: number;
  side: "buy" | "sell";
  baseSymbol: string;
  baseAddress: string;
  quoteSymbol: string;
  usd: number;
  pairLabel: string;
  exchange: string;
}

/** Key health test — cheap native-balance ping. */
export async function morPing(key: string): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const t0 = Date.now();
  try {
    await fetchJson<unknown>(
      `${BASE}/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/balance?chain=eth`,
      { headers: headers(key), timeoutMs: 8_000 },
    );
    return { ok: true, latencyMs: Date.now() - t0, detail: "key valid (moralis v2.2)" };
  } catch (e) {
    const status = (e as { status?: number }).status;
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      detail:
        status === 401 || status === 403
          ? "Moralis rejected this key (check your X-API-Key at moralis.io)"
          : "server cannot reach deep-index.moralis.io — network egress blocked on this host",
    };
  }
}

/** Recent DEX swaps of a wallet (used for smart-money cross-token radar). */
export async function morWalletSwaps(
  chain: string,
  wallet: string,
  key: string,
  limit = 25,
): Promise<MorSwap[] | null> {
  try {
    const r = await fetchJson<{ result?: Record<string, unknown>[] }>(
      `${BASE}/wallets/${wallet}/swaps?chain=${chain}&order=DESC&limit=${limit}`,
      { headers: headers(key), timeoutMs: 15_000 },
    );
    const swaps: MorSwap[] = [];
    for (const s of r.result ?? []) {
      const base = (s.base_token ?? {}) as Record<string, unknown>;
      const quote = (s.quote_token ?? {}) as Record<string, unknown>;
      const side = String(s.side ?? s.aggregator ?? "buy").toLowerCase() === "sell" ? "sell" : "buy";
      swaps.push({
        wallet: wallet.toLowerCase(),
        txHash: String(s.transaction_hash ?? ""),
        ts: s.block_timestamp ? Date.parse(String(s.block_timestamp)) : Date.now(),
        side: side as "buy" | "sell",
        baseSymbol: String(base.symbol ?? "?"),
        baseAddress: String(base.address ?? "").toLowerCase(),
        quoteSymbol: String(quote.symbol ?? ""),
        usd: toNum(s.total_value_usd ?? s.value_in_usd ?? 0),
        pairLabel: String(s.pair_label ?? `${base.symbol ?? "?"}/${quote.symbol ?? "?"}`),
        exchange: String(s.exchange ?? ""),
      });
    }
    return ok(moralisHealth, swaps);
  } catch (e) {
    return fail(moralisHealth, e, `swaps: ${e instanceof Error ? e.message : "?"}`);
  }
}
