/** Chain-id mappings between providers (DexScreener ↔ GeckoTerminal ↔ Etherscan v2 ↔ Moralis). */

export interface ChainInfo {
  ds: string; // dexscreener chainId
  gt: string; // geckoterminal network
  etherscan: number | null; // etherscan v2 chainid
  moralis: string | null; // moralis chain hex/name
  label: string;
  explorer: string; // tx explorer base
  native: string;
}

export const CHAINS: Record<string, ChainInfo> = {
  ethereum: { ds: "ethereum", gt: "eth", etherscan: 1, moralis: "eth", label: "Ethereum", explorer: "https://etherscan.io", native: "ETH" },
  bsc: { ds: "bsc", gt: "bsc", etherscan: 56, moralis: "bsc", label: "BNB Chain", explorer: "https://bscscan.com", native: "BNB" },
  solana: { ds: "solana", gt: "solana", etherscan: null, moralis: null, label: "Solana", explorer: "https://solscan.io", native: "SOL" },
  base: { ds: "base", gt: "base", etherscan: 8453, moralis: "base", label: "Base", explorer: "https://basescan.org", native: "ETH" },
  polygon: { ds: "polygon", gt: "polygon_pos", etherscan: 137, moralis: "polygon", label: "Polygon", explorer: "https://polygonscan.com", native: "POL" },
  arbitrum: { ds: "arbitrum", gt: "arbitrum", etherscan: 42161, moralis: "arbitrum", label: "Arbitrum", explorer: "https://arbiscan.io", native: "ETH" },
  optimism: { ds: "optimism", gt: "optimism", etherscan: 10, moralis: "optimism", label: "Optimism", explorer: "https://optimistic.etherscan.io", native: "ETH" },
  avalanche: { ds: "avalanche", gt: "avax", etherscan: 43114, moralis: "avalanche", label: "Avalanche", explorer: "https://snowtrace.io", native: "AVAX" },
  sui: { ds: "sui", gt: "sui", etherscan: null, moralis: null, label: "Sui", explorer: "https://suiscan.xyz", native: "SUI" },
  ton: { ds: "ton", gt: "ton", etherscan: null, moralis: null, label: "TON", explorer: "https://tonviewer.com", native: "TON" },
};

export const chainByDs = (ds: string): ChainInfo | undefined =>
  Object.values(CHAINS).find((c) => c.ds === ds);

export const chainByGt = (gt: string): ChainInfo | undefined =>
  Object.values(CHAINS).find((c) => c.gt === gt);

/** Networks offered in the UI selector. */
export const SELECTABLE_NETWORKS = Object.values(CHAINS).map((c) => ({ id: c.ds, label: c.label }));

/** Heuristic shape checks for user-entered contract addresses. */
export function validateAddress(addr: string, network: string | null): { ok: boolean; reason?: string } {
  const a = addr.trim();
  if (!a) return { ok: false, reason: "Enter a token contract address" };
  const evm = /^0x[a-fA-F0-9]{40}$/;
  const sol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const sui = /^0x[a-fA-F0-9]{64}$/;
  const ton = /^-?[A-Za-z0-9_-]{48}$|^0:[a-fA-F0-9]{64}$/;
  if (network === "solana") return sol.test(a) ? { ok: true } : { ok: false, reason: "Not a valid Solana mint address" };
  if (network === "sui") return sui.test(a) || evm.test(a) ? { ok: true } : { ok: false, reason: "Not a valid Sui address" };
  if (network === "ton") return ton.test(a) ? { ok: true } : { ok: false, reason: "Not a valid TON address" };
  if (network && network !== "auto") return evm.test(a) ? { ok: true } : { ok: false, reason: "Not a valid EVM contract address" };
  if (evm.test(a) || sol.test(a) || sui.test(a)) return { ok: true };
  return { ok: false, reason: "Unrecognized address format" };
}
