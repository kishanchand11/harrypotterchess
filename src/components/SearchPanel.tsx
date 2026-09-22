"use client";

import { useState } from "react";
import { useDash } from "@/store/dash";
import { SELECTABLE_NETWORKS } from "@/engine/chains";
import { keysHeaders, loadKeys } from "@/lib/client-keys";
import { useStream } from "@/hooks/useStream";

const EXAMPLES = [
  { label: "PEPE · Ethereum", address: "0x6982508145454ce325ddbe47a25d4ec3d2311933", network: "ethereum" },
  { label: "SHIB · Ethereum", address: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", network: "ethereum" },
  { label: "BONK · Solana", address: "DezXAJ8wg7yG3m6xS6VsktzADqnM4ggeHkCeDmjGftD", network: "solana" },
  { label: "TOSHI · Base", address: "0xac1b249665a493f9cc9ca0c640cc7f310c3bf4d2", network: "base" },
];

export default function SearchPanel({ compact = false }: { compact?: boolean }) {
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState("auto");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const status = useDash((s) => s.status);
  useStream();

  const analyze = async (addr: string, net: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", ...keysHeaders(loadKeys()) },
        body: JSON.stringify({ address: addr.trim(), network: net }),
      });
      const j = (await res.json()) as { sid?: string; error?: string };
      if (!res.ok || !j.sid) {
        setError(j.error ?? "Failed to start session");
        return;
      }
      useDash.getState().openSession(j.sid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "" : "w-full max-w-3xl"}>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && address.trim() && analyze(address, network)}
          placeholder="Enter token contract address — 0x… (EVM) or Solana mint"
          spellCheck={false}
          className="num flex-1 rounded-lg bg-panel2 border border-edge px-4 py-3 text-sm outline-none focus:border-edge2 focus:ring-1 focus:ring-smart/40 placeholder:text-muted/70 transition"
        />
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value)}
          className="rounded-lg bg-panel2 border border-edge px-3 py-3 text-sm outline-none focus:border-edge2 cursor-pointer"
        >
          <option value="auto">🌐 Auto-detect chain</option>
          {SELECTABLE_NETWORKS.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => address.trim() && analyze(address, network)}
          disabled={busy || !address.trim()}
          className="rounded-lg bg-smart/90 hover:bg-smart disabled:opacity-40 disabled:cursor-not-allowed text-[#14002b] font-semibold px-6 py-3 text-sm transition-colors"
        >
          {busy ? "Scanning…" : status === "live" || status === "connecting" ? "Analyze ▸" : "Analyze"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-sell">{error}</p>}
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-[11px] text-muted py-1">Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.address}
              onClick={() => {
                setAddress(ex.address);
                setNetwork(ex.network);
                analyze(ex.address, ex.network);
              }}
              className="text-[11px] rounded-full border border-edge bg-panel2 hover:border-smart/50 hover:text-smart px-3 py-1 text-muted transition-colors"
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
