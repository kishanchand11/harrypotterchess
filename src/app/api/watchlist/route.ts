/**
 * Watchlist — persisted token list tracked in the background (no browser needed).
 * Stored at data/watchlist.json; sessions for listed tokens are keep-alive.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getOrCreateSession, stopSession } from "@/engine/registry";
import { resolveKeys } from "@/engine/keys";
import { validateAddress } from "@/engine/chains";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILE = path.join(process.cwd(), "data", "watchlist.json");

export interface WatchItem {
  address: string;
  network: string;
  label: string;
  addedAt: number;
}

function load(): WatchItem[] {
  try {
    const arr = JSON.parse(fs.readFileSync(FILE, "utf8")) as unknown;
    if (!Array.isArray(arr)) return [];
    return (arr as unknown[])
      .filter(
        (i): i is WatchItem =>
          typeof i === "object" &&
          i !== null &&
          typeof (i as WatchItem).address === "string" &&
          typeof (i as WatchItem).network === "string" &&
          typeof (i as WatchItem).addedAt === "number",
      )
      .map((i) => ({ ...i, label: typeof i.label === "string" ? i.label : "" }));
  } catch {
    return [];
  }
}

function save(items: WatchItem[]): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(items, null, 1));
  } catch {
    /* non-fatal */
  }
}

function trackAll(items: WatchItem[], keysHeader: string | null): void {
  const keys = resolveKeys(keysHeader);
  for (const it of items) {
    getOrCreateSession({ address: it.address, network: it.network, keys, keepAlive: true });
  }
}

export async function GET(req: NextRequest) {
  const items = load();
  trackAll(items, req.headers.get("x-analyzer-keys"));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  let body: { address?: string; network?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const address = (body.address ?? "").trim();
  const network = body.network && body.network !== "auto" ? body.network : "auto";
  const v = validateAddress(address, network);
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });

  const items = load();
  const exists = items.some((i) => i.address.toLowerCase() === address.toLowerCase());
  if (!exists) {
    items.push({
      address: address.toLowerCase(),
      network: network === "auto" ? "auto" : network,
      label: (body.label ?? "").slice(0, 40),
      addedAt: Date.now(),
    });
    save(items);
  }
  trackAll(items, req.headers.get("x-analyzer-keys"));
  getOrCreateSession({ address, network, keys: resolveKeys(req.headers.get("x-analyzer-keys")), keepAlive: true });
  return NextResponse.json({ items, added: !exists });
}

export async function DELETE(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get("address") ?? "").toLowerCase();
  const items = load().filter((i) => i.address.toLowerCase() !== address);
  save(items);
  stopSession(`auto:${address}`); // stop background tracking (any network variant)
  for (const n of ["ethereum", "bsc", "solana", "base", "polygon", "arbitrum", "optimism", "avalanche", "sui", "ton"]) {
    stopSession(`${n}:${address}`);
  }
  return NextResponse.json({ items });
}
