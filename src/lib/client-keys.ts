"use client";

/** Client-side BYO key storage (localStorage only — never persisted server-side). */

export interface ClientKeys {
  etherscan: string;
  moralis: string;
  gecko: string;
  birdeye: string;
  alchemy: string;
  discordWebhook: string;
  telegramToken: string;
  telegramChat: string;
}

const LS_KEY = "smi_keys_v2";

export const EMPTY_KEYS: ClientKeys = {
  etherscan: "",
  moralis: "",
  gecko: "",
  birdeye: "",
  alchemy: "",
  discordWebhook: "",
  telegramToken: "",
  telegramChat: "",
};

export function loadKeys(): ClientKeys {
  if (typeof window === "undefined") return EMPTY_KEYS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY_KEYS;
    return { ...EMPTY_KEYS, ...(JSON.parse(raw) as Partial<ClientKeys>) };
  } catch {
    return EMPTY_KEYS;
  }
}

export function saveKeys(k: ClientKeys): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(k));
}

/** Headers object for session POSTs. */
export function keysHeaders(k: ClientKeys): Record<string, string> {
  const filled = Object.fromEntries(Object.entries(k).filter(([, v]) => v && v.trim().length > 6));
  if (Object.keys(filled).length === 0) return {};
  return { "x-analyzer-keys": JSON.stringify(filled) };
}
