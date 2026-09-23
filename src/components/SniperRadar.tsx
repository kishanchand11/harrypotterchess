"use client";

import { useDash } from "@/store/dash";
import { fmtUsd, shortAddr, timeAgo } from "@/lib/format";

export default function SniperRadar() {
  const items = useDash((s) => s.sniper);
  const radarEnabled = useDash((s) => s.radarEnabled);
  const keysNeeded = !radarEnabled;

  return (
    <div className="panel p-4 flex flex-col h-full min-h-[220px]">
      <div className="flex items-center justify-between mb-2">
        <span className="panel-title">🎯 Sniper radar — what smart money buys next</span>
        <span className="text-[10px] text-muted num">{items.length} tokens</span>
      </div>

      <p className="text-[10px] text-muted leading-relaxed mb-2">
        Watches the top-scoring wallets from this session and surfaces the <span className="text-ink">new tokens they
        are buying elsewhere</span> — early entries worth sniping.
      </p>

      {keysNeeded ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-2">
          <span className="text-2xl">🛰️</span>
          <p className="text-xs text-muted leading-relaxed">
            Add a <span className="text-smart">Moralis</span> or <span className="text-smart">Etherscan</span> key in{" "}
            <span className="text-ink">⚙ Keys</span> to activate cross-token wallet radar. Without keys this stays idle
            — we never fabricate on-chain data.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted">
          Scanning tracked smart wallets for fresh token activity…
        </div>
      ) : (
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-[11px] num">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-muted text-left">
                <th className="py-1 pr-2 font-medium">when</th>
                <th className="py-1 pr-2 font-medium">smart wallet</th>
                <th className="py-1 pr-2 font-medium">bought</th>
                <th className="py-1 pr-2 font-medium text-right">usd</th>
                <th className="py-1 font-medium text-right">score</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 25).map((it) => (
                <tr key={it.id} className="border-t border-edge/30 slide-in">
                  <td className="py-1 pr-2 text-muted">{timeAgo(it.ts)}</td>
                  <td className="py-1 pr-2 text-info">{shortAddr(it.wallet, 3)}</td>
                  <td className="py-1 pr-2">
                    <span className="text-acc font-semibold">{it.tokenSymbol}</span>
                    <span className="text-muted hidden md:inline"> {it.tokenName.slice(0, 18)}</span>
                  </td>
                  <td className="py-1 pr-2 text-right">{it.usd ? fmtUsd(it.usd) : "—"}</td>
                  <td className="py-1 text-right text-smart">{it.walletScore.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
