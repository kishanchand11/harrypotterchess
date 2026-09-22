import { NextRequest, NextResponse } from "next/server";
import { keysFromHeader, keysFromEnv, type Keys } from "@/engine/keys";
import { esPing } from "@/engine/providers/etherscan";
import { morPing } from "@/engine/providers/moralis";
import { alchemyPing } from "@/engine/providers/alchemy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type TestResult = { ok: boolean; latencyMs: number; detail: string };

/**
 * POST /api/keys/test  { provider }  (keys via x-analyzer-keys header or env)
 * Actually pings the provider from the SERVER and reports validity + latency,
 * distinguishing auth failures from network egress blocks.
 */
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
      result = await esPing(keys.etherscan);
      break;
    }
    case "moralis": {
      if (!keys.moralis) return NextResponse.json({ error: "no moralis key provided" }, { status: 400 });
      result = await morPing(keys.moralis);
      break;
    }
    case "alchemy": {
      if (!keys.alchemy) return NextResponse.json({ error: "no alchemy key provided" }, { status: 400 });
      result = await alchemyPing(keys.alchemy);
      break;
    }
    default:
      return NextResponse.json({ error: `unknown provider: ${provider}` }, { status: 400 });
  }
  return NextResponse.json(result);
}
