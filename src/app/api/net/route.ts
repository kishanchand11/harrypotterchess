import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/net — pre-flight probe of every provider endpoint, run FROM THE SERVER.
 * Tells the UI (and you) whether this host can reach crypto APIs at all.
 * Cached 60s — probing is cheap but pointless to repeat per keystroke.
 */

interface ProbeTarget {
  id: string;
  label: string;
  url: string;
  init?: RequestInit;
}

const TARGETS: ProbeTarget[] = [
  { id: "dexscreener", label: "DexScreener (tape/ticks)", url: "https://api.dexscreener.com/latest/dex/search?q=eth" },
  { id: "geckoterminal", label: "GeckoTerminal (trades/holders)", url: "https://api.geckoterminal.com/api/v2/networks/eth/pools/0x11b815efb8f581194ae79006d24e0d814b7697f6" },
  { id: "alchemy", label: "Alchemy", url: "https://eth-mainnet.g.alchemy.com/v2/ping", init: { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' } },
  { id: "etherscan", label: "Etherscan V2", url: "https://api.etherscan.io/v2/api?chainid=1&module=block&action=ethblocknumber&apikey=Test" },
  { id: "moralis", label: "Moralis", url: "https://deep-index.moralis.io/api/v2.2/eth/block/latest" },
  { id: "publicrpc", label: "Public EVM RPC", url: "https://ethereum-rpc.publicnode.com", init: { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' } },
];

export interface NetProbe {
  id: string;
  label: string;
  reachable: boolean;
  latencyMs: number;
}

let cache: { at: number; data: { probes: NetProbe[]; allCryptoBlocked: boolean } } | null = null;

async function probe(t: ProbeTarget): Promise<NetProbe> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4_000);
  try {
    await fetch(t.url, {
      ...t.init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "SmartMoneyAnalyzer/1.0", ...(t.init?.headers as Record<string, string>) },
    });
    // ANY http response (even 401/403/429) proves the network path works.
    return { id: t.id, label: t.label, reachable: true, latencyMs: Date.now() - t0 };
  } catch {
    return { id: t.id, label: t.label, reachable: false, latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  if (cache && Date.now() - cache.at < 60_000) {
    return NextResponse.json(cache.data);
  }
  const probes = await Promise.all(TARGETS.map(probe));
  const allCryptoBlocked = probes
    .filter((p) => p.id !== "publicrpc")
    .every((p) => !p.reachable);
  cache = { at: Date.now(), data: { probes, allCryptoBlocked } };
  return NextResponse.json(cache.data);
}
