import { NextRequest, NextResponse } from "next/server";
import { keysFromHeader, keysFromEnv, type Keys } from "@/engine/keys";
import { esPing } from "@/engine/providers/etherscan";
import { morPing } from "@/engine/providers/moralis";
import { alchemyPing } from "@/engine/providers/alchemy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/keys/test  { provider }  (keys via x-analyzer-keys header or env)
 *
 * Returns a TRI-STATE result so the UI never calls a network problem
 * "your key failed":
 *   ok      — the provider accepted the key
 *   invalid — the provider answered and rejected the key (real key problem)
 *   blocked — this host cannot reach the provider at all (network problem;
 *             the key itself may be perfectly fine — self-host to use it)
 */
export type TestState = "ok" | "invalid" | "blocked";
export type TestResult = { state: TestState; ok: boolean; latencyMs: number; detail: string };

function classify(
  r: { ok: boolean; latencyMs: number; detail: string },
  networkHint: RegExp,
): TestResult {
  if (r.ok) return { state: "ok", ok: true, latencyMs: r.latencyMs, detail: r.detail };
  const blocked = networkHint.test(r.detail);
  return {
    state: blocked ? "blocked" : "invalid",
    ok: false,
    latencyMs: r.latencyMs,
    detail: r.detail,
  };
}

export async function POST(req: NextRequest) {
  let body: { provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const headerKeys = keysFromHeader(req.headers.get("x-analyzer-keys"));
  const envKeys = keysFromEnv();
  const keys: Keys = {
    etherscan: headerKeys.etherscan ?? envKeys.etherscan,
    moralis: headerKeys.moralis ?? envKeys.moralis,
    gecko: headerKeys.gecko ?? envKeys.gecko,
    birdeye: headerKeys.birdeye ?? envKeys.birdeye,
    alchemy: headerKeys.alchemy ?? envKeys.alchemy,
  };

  const provider = body.provider;
  let result: TestResult;
  switch (provider) {
    case "etherscan": {
      if (!keys.etherscan) return NextResponse.json({ error: "no etherscan key provided" }, { status: 400 });
      result = classify(await esPing(keys.etherscan), /cannot reach api\.etherscan\.io|egress blocked|fetch failed|network/i);
      break;
    }
    case "moralis": {
      if (!keys.moralis) return NextResponse.json({ error: "no moralis key provided" }, { status: 400 });
      result = classify(await morPing(keys.moralis), /cannot reach deep-index\.moralis\.io|egress blocked|fetch failed|network/i);
      break;
    }
    case "alchemy": {
      if (!keys.alchemy) return NextResponse.json({ error: "no alchemy key provided" }, { status: 400 });
      result = classify(await alchemyPing(keys.alchemy), /cannot reach alchemy\.com|egress blocked|fetch failed|network|ENOTFOUND|ECONNREFUSED/i);
      break;
    }
    default:
      return NextResponse.json({ error: `unknown provider: ${provider}` }, { status: 400 });
  }
  return NextResponse.json(result);
}
