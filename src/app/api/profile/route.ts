import { NextRequest, NextResponse } from "next/server";
import { history } from "@/engine/history";
import { activeSessions } from "@/engine/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/profile?address=0x… — cross-session wallet profile (any address).
 * Merges lifetime aggregates from history with the live session view if the
 * wallet is currently tracked. BYO-key on-chain enrichment lives in /api/wallet.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("address") ?? "";
  // EVM addresses normalize to lowercase; Solana/Sui base58 must keep casing
  const address = /^0x[0-9a-fA-F]{40}$/.test(raw) ? raw.toLowerCase() : raw;
  if (!/^0x[a-f0-9]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }
  const lifetime = history.walletLifetime(address);
  const tokensTraded = lifetime ? Object.keys(lifetime.tokens).length : 0;

  // live merge: which tracked session knows this wallet right now?
  let live: { sid: string; klass: string; smartScore: number; netQty: number; priorNetQty?: number } | null = null;
  for (const s of activeSessions()) {
    const detail = s.walletDetail(address);
    if (detail) {
      live = {
        sid: s.sid,
        klass: detail.summary.klass,
        smartScore: detail.summary.smartScore,
        netQty: detail.summary.netQty,
        priorNetQty: detail.summary.priorNetQty,
      };
      break;
    }
  }

  return NextResponse.json({
    address,
    lifetime: lifetime
      ? {
          sessions: lifetime.sessions,
          firstSeen: lifetime.firstSeen,
          lastSeen: lifetime.lastSeen,
          buyUsd: lifetime.buyUsd,
          sellUsd: lifetime.sellUsd,
          realizedPnl: lifetime.realizedPnl,
          wins: lifetime.wins,
          losses: lifetime.losses,
          trades: lifetime.trades,
          tokensTraded,
          tokens: Object.entries(lifetime.tokens)
            .sort((a, b) => b[1].n - a[1].n)
            .slice(0, 10)
            .map(([token, t]) => ({ token, sessions: t.n, pnl: t.pnl })),
        }
      : null,
    live,
  });
}
