import { NextResponse } from "next/server";
import { keyPresence, keysFromEnv } from "@/engine/keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/config — which BYO keys exist server-side (presence only, never values). */
export async function GET() {
  return NextResponse.json({ envKeys: keyPresence(keysFromEnv()) });
}
