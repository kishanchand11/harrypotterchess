"use client";

import { useDash } from "@/store/dash";
import { fmtNum, fmtUsd, shortAddr } from "@/lib/format";

export default function HoldersPanel() {
  const holders = useDash((s) => s.holders);
  const sid = useDash((s) => s.sid);

  if (!holders) {
    return (
      <div className="panel p-4 min-h-[220px] flex items-center justify-center text-xs text-muted">
        Holders load with the session…
      </div>
    );
  }

  return (
    <div className="panel p-4 flex flex-col h-full min-h-[220px]">
      <div className="flex items-center justify-between mb-2">
        <span className="panel-title">Holder intelligence</span>
        <div className="flex items-center gap-1.5">
          {holders.source && (
            <span
              className={`text-[9px] rounded px-1.5 py-0.5 border ${
                holders.source === "derived"
                  ? "border-warn/30 text-warn bg-warn/5"
                  : "border-buy/30 text-buy bg-buy/5"
              }`}
            >
              {holders.source === "derived"
                ? "session-derived"
                : `on-chain · ${holders.source}`}
            </span>
          )}
          {holders.updatedAt && (
            <span className="text-[9px] text-muted num">
              {new Date(holders.updatedAt).toLocaleTimeString("en-US", { hour12: false })}
            </span>
          )}
        </div>
      </div>

      {holders.note && <p className="text-[10px] text-warn/80 mb-2 leading-relaxed">{holders.note}</p>}

      {!holders.available ? (
        <div className="text-xs text-muted flex-1 flex items-center justify-center text-center px-4">
          On-chain holder list needs a <span className="text-smart mx-1">Moralis key</span> (⚙ Keys) — the panel will
          light up with top holders + concentration automatically.
        </div>
      ) : (
        <>
          {holders.top10SharePct != null && holders.top10SharePct > 0 && (
            <div className="mb-2">
              <div className="flex justify-between text-[10px] text-muted num mb-1">
                <span>Top-10 concentration</span>
                <span className={holders.top10SharePct > 45 ? "text-warn" : "text-buy"}>
                  {holders.top10SharePct.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 rounded bg-panel2 overflow-hidden">
                <div
                  className={`h-full ${holders.top10SharePct > 45 ? "bg-warn/80" : "bg-buy/70"}`}
                  style={{ width: `${Math.min(100, holders.top10SharePct)}%` }}
                />
              </div>
            </div>
          )}
          <div className="overflow-y-auto flex-1">
            <table className="w-full text-[11px] num">
              <thead>
                <tr className="text-muted text-left">
                  <th className="py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-2 font-medium">holder</th>
                  <th className="py-1 pr-2 font-medium text-right">balance</th>
                  <th className="py-1 font-medium text-right">share</th>
                </tr>
              </thead>
              <tbody>
                {holders.rows.slice(0, 15).map((h) => (
                  <tr key={h.address} className="border-t border-edge/30">
                    <td className="py-1 pr-2 text-muted">{h.rank}</td>
                    <td className="py-1 pr-2">
                      {sid && holders.source === "derived" ? (
                        <span className="text-info">{shortAddr(h.address, 4)}</span>
                      ) : (
                        <a
                          href={`/api/wallet?sid=${encodeURIComponent(sid ?? "")}&wallet=${h.address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-info hover:underline"
                        >
                          {shortAddr(h.address, 4)}
                        </a>
                      )}
                      {h.isContract && <span className="text-[9px] text-muted ml-1">contract</span>}
                    </td>
                    <td className="py-1 pr-2 text-right">{fmtNum(h.balance)}</td>
                    <td className="py-1 text-right">
                      {h.sharePct >= 0 ? (
                        <span className={h.sharePct > 10 ? "text-warn" : ""}>{h.sharePct.toFixed(2)}%</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
