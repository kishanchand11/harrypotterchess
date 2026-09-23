import { NextRequest, NextResponse } from "next/server";
import { activeSessions } from "@/engine/registry";
import { getSession } from "@/engine/registry";
import type { ScanInfo } from "@/engine/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/scan — one row per tracked session (dashboard tabs + watchlist).
 * Watchlist restore happens in /api/watchlist; here we only report live state.
 */
export async function GET(_req: NextRequest) {
  const rows: ScanInfo[] = [];
  for (const s of activeSessions()) {
    const sid = s.sid;
    const live = getSession(sid);
    if (!live || live.isStopped) continue;
    rows.push(live.scanInfo());
  }
  rows.sort((a, b) => Number(b.keepAlive) - Number(a.keepAlive) || b.trades - a.trades);
  return NextResponse.json({ rows, ts: Date.now() });
}
