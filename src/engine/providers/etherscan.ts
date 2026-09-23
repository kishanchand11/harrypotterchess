/**
 * Etherscan V2 multichain provider — BRING YOUR OWN KEY.
 * One key works across eth/bsc/base/polygon/arbitrum/optimism/avalanche.
 * https://docs.etherscan.io/etherscan-v2
 *
 * Notes:
 *  • `tokentx` (free tier) powers the wallet transfer radar + wallet-age lookups.
 *  • Top-holders via `module=token&action=topholders` is a PRO-plan endpoint —
 *    use Moralis (free tier) or GeckoTerminal for holder lists instead.
 */
import { fetchJson, makeHealth, ok, fail, type Health } from "./shared";

export const etherscanHealth: Health = makeHealth("Etherscan (BYO key)");

export interface TokenTransfer {
  contract: string;
  symbol: string;
  decimals: number;
  from: string;
  to: string;
  value: string; // raw units
  ts: number;
  hash: string;
}

export async function esWalletTokenTxs(
  chainId: number,
  wallet: string,
  key: string,
  contractAddress?: string,
  offset = 100,
): Promise<TokenTransfer[] | null> {
  try {
    const url =
      `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=tokentx` +
      `&address=${wallet}${contractAddress ? `&contractaddress=${contractAddress}` : ""}` +
      `&page=1&offset=${offset}&sort=desc&apikey=${encodeURIComponent(key)}`;
    const r = await fetchJson<{ status: string; message: string; result: unknown }>(url, {
      health: etherscanHealth,
    });
    if (r.status !== "1" || !Array.isArray(r.result)) {
      // "No transactions found" is a benign empty state
      if (/no transactions found/i.test(r.message || "")) return ok(etherscanHealth, []);
      const err = new Error(r.message || "etherscan error");
      (err as Error & { status?: number }).status = /invalid api key|missing api key/i.test(r.message ?? "") ? 401 : 400;
      throw err;
    }
    const rows = (r.result as Record<string, unknown>[]).map((t) => ({
      contract: String(t.contractAddress ?? "").toLowerCase(),
      symbol: String(t.tokenSymbol ?? "?"),
      decimals: Number(t.tokenDecimal ?? 18),
      from: String(t.from ?? "").toLowerCase(),
      to: String(t.to ?? "").toLowerCase(),
      value: String(t.value ?? "0"),
      ts: Number(t.timeStamp ?? 0) * 1000,
      hash: String(t.hash ?? ""),
    }));
    return ok(etherscanHealth, rows);
  } catch (e) {
    return fail(etherscanHealth, e, `tokentx: ${e instanceof Error ? e.message : "?"}`);
  }
}

/** Quick wallet-age probe (first token tx, ascending). */
export async function esWalletEarliestTx(
  chainId: number,
  wallet: string,
  key: string,
): Promise<number | null> {
  try {
    const url =
      `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=tokentx` +
      `&address=${wallet}&page=1&offset=1&sort=asc&apikey=${encodeURIComponent(key)}`;
    const r = await fetchJson<{ status: string; result: { timeStamp?: string }[] }>(url);
    if (r.status === "1" && Array.isArray(r.result) && r.result[0]?.timeStamp) {
      return Number(r.result[0].timeStamp) * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

/** Key health test — free `stats/ethsupply` ping. Distinguishes auth vs network errors. */
export async function esPing(key: string): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const t0 = Date.now();
  try {
    const r = await fetchJson<{ status: string; message: string; result?: unknown }>(
      `https://api.etherscan.io/v2/api?chainid=1&module=stats&action=ethsupply&apikey=${encodeURIComponent(key)}`,
      { timeoutMs: 8_000 },
    );
    if (r.status === "1") return { ok: true, latencyMs: Date.now() - t0, detail: "key valid (etherscan v2)" };
    const auth = /invalid api key|missing api key/i.test(r.message ?? "");
    return { ok: false, latencyMs: Date.now() - t0, detail: auth ? "Etherscan rejected this key (check it at etherscan.io/apis)" : r.message || "unknown etherscan error" };
  } catch (e) {
    const status = (e as { status?: number }).status;
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      detail:
        status != null
          ? `Etherscan answered HTTP ${status} — ${status === 401 || status === 403 ? "key rejected" : "request refused"}`
          : "server cannot reach api.etherscan.io — network egress blocked on this host (the key itself may be fine; run where Etherscan is reachable)",
    };
  }
}
