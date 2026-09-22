/**
 * Bring-Your-Own-Keys resolution.
 * Priority: request headers (x-analyzer-keys JSON) → server env (.env.local).
 * Keys are never persisted server-side.
 */
export interface Keys {
  etherscan?: string;
  moralis?: string;
  gecko?: string;
  birdeye?: string;
}

export function keysFromHeader(headerVal: string | null): Keys {
  if (!headerVal) return {};
  try {
    const raw = JSON.parse(headerVal) as Record<string, unknown>;
    const clean = (v: unknown) => (typeof v === "string" && v.trim().length > 6 ? v.trim() : undefined);
    return {
      etherscan: clean(raw.etherscan),
      moralis: clean(raw.moralis),
      gecko: clean(raw.gecko),
      birdeye: clean(raw.birdeye),
    };
  } catch {
    return {};
  }
}

export function keysFromEnv(): Keys {
  return {
    etherscan: process.env.ETHERSCAN_API_KEY || undefined,
    moralis: process.env.MORALIS_API_KEY || undefined,
    gecko: process.env.GECKOTERMINAL_API_KEY || undefined,
    birdeye: process.env.BIRDEYE_API_KEY || undefined,
  };
}

export function resolveKeys(headerVal: string | null): Keys {
  const h = keysFromHeader(headerVal);
  const e = keysFromEnv();
  return {
    etherscan: h.etherscan ?? e.etherscan,
    moralis: h.moralis ?? e.moralis,
    gecko: h.gecko ?? e.gecko,
    birdeye: h.birdeye ?? e.birdeye,
  };
}

export function keyPresence(k: Keys): Record<keyof Keys, boolean> {
  return {
    etherscan: Boolean(k.etherscan),
    moralis: Boolean(k.moralis),
    gecko: Boolean(k.gecko),
    birdeye: Boolean(k.birdeye),
  };
}
