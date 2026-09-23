import { NextRequest, NextResponse } from "next/server";
import { getOrCreateSession } from "@/engine/registry";
import { resolveKeys } from "@/engine/keys";
import { validateAddress } from "@/engine/chains";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/session  { address, network? }  (BYO keys via x-analyzer-keys header)
 * → { sid, mode, token, network }
 */
export async function POST(req: NextRequest) {
  let body: { address?: string; network?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const address = (body.address ?? "").trim();
  const network = body.network && body.network !== "auto" ? body.network : null;

  const v = validateAddress(address, network);
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });

  const keys = resolveKeys(req.headers.get("x-analyzer-keys"));
  const session = getOrCreateSession({ address, network, keys });

  // give discovery a beat so the first snapshot has data
  await new Promise((r) => setTimeout(r, 50));
  const snap = session.snapshot();
  return NextResponse.json({
    sid: session.sid,
    phase: snap.phase,
    providerError: snap.providerError ?? null,
    network: snap.graph.network,
    token: snap.token,
  });
}
