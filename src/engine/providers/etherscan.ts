/**
 * Etherscan V2 multichain provider — BRING YOUR OWN KEY.
 * One key works across eth/bsc/base/polygon/arbitrum/optimism/avalanche.
 * https://docs.etherscan.io/etherscan-v2
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
    const r = await fetchJson<{ status: string; message: string; result: unknown }>(url);
    if (r.status !== "1" || !Array.isArray(r.result)) {
      // "No transactions found" is a benign empty state
      if (/no transactions found/i.test(r.message || "")) return ok(etherscanHealth, []);
      throw new Error(r.message || "etherscan error");
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

/** Quick contract-info probe — used to age wallets (first activity) when key present. */
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
