/**
 * Alchemy provider — BRING YOUR OWN KEY (free tier is generous: 300M CU/mo).
 *
 * Uses:
 *  • alchemy_getAssetTransfers — wallet-level ERC-20 transfer radar (in/out),
 *    the highest-quality keyless-auth path for "which wallets bought what".
 *  • alchemy_getTokenMetadata  — token symbol/decimals enrichment.
 *  • eth_call balanceOf        — on-chain balance cross-checks in the wallet drawer.
 *  • eth_blockNumber           — key health test.
 *
 * Docs: https://docs.alchemy.com/reference/alchemy-getassettransfers
 */
import { makeHealth, ok, fail, toNum, type Health } from "./shared";
import { chainByDs } from "../chains";

export const alchemyHealth: Health = makeHealth("Alchemy (BYO key)");

export const ALCHEMY_METADATA_CHAINS = new Set(["ethereum", "base", "polygon", "arbitrum", "optimism"]);

export function alchemySupported(networkDs: string): boolean {
  return chainByDs(networkDs)?.alchemy != null;
}

export function endpoint(networkDs: string, key: string): string {
  const slug = chainByDs(networkDs)?.alchemy ?? "eth-mainnet";
  return `https://${slug}.g.alchemy.com/v2/${encodeURIComponent(key)}`;
}

async function rpc<T>(networkDs: string, key: string, method: string, params: unknown[], timeoutMs = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint(networkDs, key), {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now() % 1e6, method, params }),
      cache: "no-store",
    });
    const j = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (!res.ok || j.error) {
      const err = new Error(j.error?.message ?? `HTTP ${res.status}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    alchemyHealth.state = "ok";
    alchemyHealth.lastOkAt = Date.now();
    alchemyHealth.calls++;
    return j.result as T;
  } catch (e) {
    alchemyHealth.errors++;
    alchemyHealth.state = "down";
    alchemyHealth.detail = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Key health test — cheap eth_blockNumber ping. */
export async function alchemyPing(key: string): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const t0 = Date.now();
  try {
    const block = await rpc<string>("ethereum", key, "eth_blockNumber", [], 8_000);
    return { ok: true, latencyMs: Date.now() - t0, detail: `latest block ${block}` };
  } catch (e) {
    const status = (e as { status?: number }).status;
    const networkish = !(status === 401 || status === 403) && /fetch|abort|network|ENOTFOUND|ECONNREFUSED/i.test(e instanceof Error ? e.message : String(e));
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      detail: networkish
        ? "server cannot reach alchemy.com — network egress blocked on this host (key itself may be fine)"
        : (e instanceof Error ? e.message : "key rejected"),
    };
  }
}

export interface AlchemyTransfer {
  token: string; // contract (lowercase, "" if unknown)
  asset: string; // symbol
  value: number; // decimal-adjusted
  from: string;
  to: string;
  hash: string;
  ts: number; // ms (approximate where withMetadata unsupported)
  blockNumHex: string;
}

interface RawTransfer {
  from?: string;
  to?: string;
  hash?: string;
  asset?: string;
  value?: number;
  blockNum?: string;
  rawContract?: { address?: string | null; value?: string };
  metadata?: { blockTimestamp?: string };
}

/**
 * Recent ERC-20 transfers for a wallet.
 * direction "in" = tokens received (buys from pools / airdrops),
 * direction "out" = tokens sent (sells / transfers).
 */
export async function alchemyWalletTransfers(
  networkDs: string,
  wallet: string,
  key: string,
  opts: { direction?: "in" | "out"; contractFilter?: string; maxCount?: number; withMetadata?: boolean } = {},
): Promise<AlchemyTransfer[] | null> {
  try {
    const withMetadata = opts.withMetadata ?? ALCHEMY_METADATA_CHAINS.has(networkDs);
    const param: Record<string, unknown> = {
      fromBlock: "0x0",
      toBlock: "latest",
      category: ["erc20"],
      excludeZeroValue: true,
      maxCount: `0x${(opts.maxCount ?? 50).toString(16)}`,
      order: "desc",
      withMetadata,
    };
    if (opts.direction === "in") param.toAddress = wallet;
    else param.fromAddress = wallet;
    if (opts.contractFilter) param.contractAddresses = [opts.contractFilter];

    const r = await rpc<{ transfers: RawTransfer[] }>(networkDs, key, "alchemy_getAssetTransfers", [param]);
    const rows: AlchemyTransfer[] = [];
    for (const t of r.transfers ?? []) {
      rows.push({
        token: String(t.rawContract?.address ?? "").toLowerCase(),
        asset: String(t.asset ?? "?"),
        value: toNum(t.value),
        from: String(t.from ?? "").toLowerCase(),
        to: String(t.to ?? "").toLowerCase(),
        hash: String(t.hash ?? ""),
        ts: t.metadata?.blockTimestamp ? Date.parse(t.metadata.blockTimestamp) : Date.now(),
        blockNumHex: String(t.blockNum ?? "0x0"),
      });
    }
    return ok(alchemyHealth, rows);
  } catch (e) {
    return fail(alchemyHealth, e, `assetTransfers: ${e instanceof Error ? e.message : "?"}`);
  }
}

/** Token metadata via alchemy_getTokenMetadata. */
export async function alchemyTokenMetadata(
  networkDs: string,
  token: string,
  key: string,
): Promise<{ symbol: string; name: string; decimals: number } | null> {
  try {
    const r = await rpc<{ symbol?: string; name?: string; decimals?: number }>(
      networkDs,
      key,
      "alchemy_getTokenMetadata",
      [token],
    );
    return ok(alchemyHealth, {
      symbol: r.symbol ?? "?",
      name: r.name ?? "?",
      decimals: r.decimals ?? 18,
    });
  } catch {
    return null; // enrichment only — never fatal
  }
}

/** On-chain ERC-20 balanceOf via raw eth_call (selector 0x70a08231). */
export async function alchemyTokenBalanceOf(
  networkDs: string,
  token: string,
  wallet: string,
  key: string,
): Promise<{ raw: bigint; decimals: number; human: number } | null> {
  try {
    const data = `0x70a08231000000000000000000000000${wallet.replace(/^0x/i, "").toLowerCase()}`;
    const hex = await rpc<string>(networkDs, key, "eth_call", [{ to: token, data }, "latest"]);
    const raw = BigInt(hex === "0x" ? "0x0" : hex);
    const meta = await alchemyTokenMetadata(networkDs, token, key);
    const decimals = meta?.decimals ?? 18;
    return { raw, decimals, human: Number(raw) / 10 ** decimals };
  } catch {
    return null;
  }
}
