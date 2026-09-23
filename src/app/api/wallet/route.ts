import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/engine/registry";
import { resolveKeys } from "@/engine/keys";
import { chainByDs } from "@/engine/chains";
import { esWalletEarliestTx, esWalletTokenTxs } from "@/engine/providers/etherscan";
import { morWalletSwaps } from "@/engine/providers/moralis";
import {
  alchemySupported,
  alchemyTokenBalanceOf,
  alchemyWalletTransfers,
} from "@/engine/providers/alchemy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/wallet?sid=...&wallet=0x...
 * Deep wallet intel: session-derived metrics + (with BYO keys) cross-chain
 * enrichment — wallet age, recent swaps, on-chain balance, transfer radar.
 */
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") ?? "";
  const wallet = (req.nextUrl.searchParams.get("wallet") ?? "").toLowerCase();
  const session = getSession(sid);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!/^0x[a-f0-9]{40}$|^[1-9a-z]{32,44}$/i.test(wallet))
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });

  const detail = session.walletDetail(wallet);
  if (!detail) return NextResponse.json({ error: "wallet not tracked in this session" }, { status: 404 });

  const keys = resolveKeys(req.headers.get("x-analyzer-keys"));
  const chain = chainByDs(session.networkDs);
  const enrichment: {
    walletAgeFirstTx?: number | null;
    recentSwaps?: { symbol: string; side: string; usd: number; ts: number; exchange: string }[];
    recentIncoming?: { symbol: string; ts: number; contract: string }[];
    onChainBalance?: { token: string; human: number; note: string } | null;
    recentTransfers?: { token: string; asset: string; value: number; direction: string; ts: number }[];
    source: string[];
  } = { source: [] };

  try {
    if (keys.etherscan && chain?.etherscan) {
      const age = await esWalletEarliestTx(chain.etherscan, wallet, keys.etherscan);
      enrichment.walletAgeFirstTx = age;
      const txs = await esWalletTokenTxs(chain.etherscan, wallet, keys.etherscan, undefined, 50);
      enrichment.recentIncoming = (txs ?? [])
        .filter((t) => t.to === wallet)
        .slice(0, 12)
        .map((t) => ({ symbol: t.symbol, ts: t.ts, contract: t.contract }));
      enrichment.source.push("etherscan");
    }
    if (keys.moralis && chain?.moralis) {
      const swaps = await morWalletSwaps(chain.moralis, wallet, keys.moralis).catch(() => null);
      enrichment.recentSwaps = (swaps ?? []).slice(0, 15).map((s) => ({
        symbol: s.baseSymbol,
        side: s.side,
        usd: s.usd,
        ts: s.ts,
        exchange: s.exchange,
      }));
      enrichment.source.push("moralis");
    }
    if (keys.alchemy && chain && alchemySupported(session.networkDs)) {
      const balance = await alchemyTokenBalanceOf(session.networkDs, session.address, wallet, keys.alchemy);
      if (balance) {
        enrichment.onChainBalance = {
          token: session.address,
          human: balance.human,
          note: "cross-check vs tape-derived position — a gap means pre-session holdings or non-DEX transfers",
        };
      }
      const transfers = await alchemyWalletTransfers(session.networkDs, wallet, keys.alchemy, {
        direction: "in",
        maxCount: 25,
      }).catch(() => null);
      enrichment.recentTransfers = (transfers ?? []).slice(0, 12).map((t) => ({
        token: t.token,
        asset: t.asset,
        value: t.value,
        direction: t.to === wallet ? "in" : "out",
        ts: t.ts,
      }));
      enrichment.source.push("alchemy");
    }
  } catch {
    /* enrichment best-effort */
  }

  return NextResponse.json({ ...detail, enrichment });
}
