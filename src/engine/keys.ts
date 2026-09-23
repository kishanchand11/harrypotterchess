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
  alchemy?: string;
  discordWebhook?: string;
  telegramToken?: string;
  telegramChat?: string;
}

export function keysFromHeader(headerVal: string | null): Keys {
  if (!headerVal) return {};
  try {
    const raw = JSON.parse(headerVal) as Record<string, unknown>;
    const clean = (v: unknown) => {
      if (typeof v !== "string") return undefined;
      // accept raw keys OR full URLs pasted by mistake (e.g. https://eth-mainnet.g.alchemy.com/v2/KEY)
      const urlMatch = /\/v2\/([A-Za-z0-9_-]{20,})$/.exec(v.trim());
      const val = urlMatch ? urlMatch[1] : v.trim();
      return val.length > 6 ? val : undefined;
    };
    return {
      etherscan: clean(raw.etherscan),
      moralis: clean(raw.moralis),
      gecko: clean(raw.gecko),
      birdeye: clean(raw.birdeye),
      alchemy: clean(raw.alchemy),
      discordWebhook: clean(raw.discordWebhook),
      telegramToken: clean(raw.telegramToken),
      telegramChat: clean(raw.telegramChat),
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
    alchemy: process.env.ALCHEMY_API_KEY || undefined,
    discordWebhook: process.env.DISCORD_WEBHOOK_URL || undefined,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChat: process.env.TELEGRAM_CHAT_ID || undefined,
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
    alchemy: h.alchemy ?? e.alchemy,
    discordWebhook: h.discordWebhook ?? e.discordWebhook,
    telegramToken: h.telegramToken ?? e.telegramToken,
    telegramChat: h.telegramChat ?? e.telegramChat,
  };
}

export function keyPresence(k: Keys): Record<keyof Keys, boolean> {
  return {
    etherscan: Boolean(k.etherscan),
    moralis: Boolean(k.moralis),
    gecko: Boolean(k.gecko),
    birdeye: Boolean(k.birdeye),
    alchemy: Boolean(k.alchemy),
    discordWebhook: Boolean(k.discordWebhook),
    telegramToken: Boolean(k.telegramToken),
    telegramChat: Boolean(k.telegramChat),
  };
}
