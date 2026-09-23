"use client";

import { useCallback, useEffect, useState } from "react";
import { useDash } from "@/store/dash";
import type { ScanInfo } from "@/engine/types";
import { fmtNum, fmtPrice, fmtUsd, timeAgo } from "@/lib/format";
import { keysHeaders, loadKeys } from "@/lib/client-keys";

/** Global scanner: every tracked session + watchlist rows, light-polling. */
export default function ScannerPanel() {
  const [rows, setRows] = useState<ScanInfo[]>([]);
  const [watch, setWatch] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const currentSid = useDash((s) => s.sid);
  const refreshTick = useCallback(async () => {
    try {
      const r = await fetch("/api/scan");
      const j = (await r.json()) as { rows: ScanInfo[] };
      setRows(j.rows ?? []);
    } catch {
      /* keep last */
    }
  }, []);

  const loadWatch = useCallback(async () => {
    try {
      const r = await fetch("/api/watchlist", { headers: { ...keysHeaders(loadKeys()) } });
      const j = (await r.json()) as { items: { address: string }[] };
      setWatch(new Set((j.items ?? []).map((i) => i.address)));
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    void refreshTick();
    void loadWatch();
    const t = setInterval(refreshTick, 10_000);
    return () => clearInterval(t);
  }, [refreshTick, loadWatch, currentSid]);

  const open = async (address: string, network: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json", ...keysHeaders(loadKeys()) },
        body: JSON.stringify({ address, network }),
      });
      const j = (await res.json()) as { sid?: string };
      if (j.sid) {
        useDash.getState().openSession(j.sid);
        void refreshTick();
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleWatch = async (address: string, network: string) => {
    setBusy(true);
    try {
      if (watch.has(address)) {
        await fetch(`/api/watchlist?address=${encodeURIComponent(address)}`, { method: "DELETE" });
      } else {
        await fetch("/api/watchlist", {
          method: "POST",
          headers: { "content-type": "application/json", ...keysHeaders(loadKeys()) },
          body: JSON.stringify({ address, network }),
        });
      }
      await loadWatch();
      await refreshTick();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="panel-title">Scanner — tracked tokens & watchlist</span>
        <span className="text-[10px] text-muted num">{rows.length} sessions · watchlist ⭐ persists server-side</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted py-3">
          Nothing tracked yet. Analyze a token and star it ⭐ — watchlisted tokens keep tracking in the background and
          fire alerts even with this page closed.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] num">
            <thead>
              <tr className="text-muted text-left whitespace-nowrap">
                <th className="py-1 pr-2 font-medium">⭐</th>
                <th className="py-1 pr-2 font-medium">token</th>
                <th className="py-1 pr-2 font-medium">chain</th>
                <th className="py-1 pr-2 font-medium">feed</th>
                <th className="py-1 pr-2 font-medium text-right">price</th>
                <th className="py-1 pr-2 font-medium text-right">liq</th>
                <th className="py-1 pr-2 font-medium text-right">wallets</th>
                <th className="py-1 pr-2 font-medium text-right">fresh 1m</th>
                <th className="py-1 font-medium">last signal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sid} className="border-t border-edge/30 hover:bg-panel2/60 cursor-pointer" onClick={() => !busy && open(r.address, r.network)}>
                  <td className="py-1 pr-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleWatch(r.address, r.network);
                      }}
                      className={watch.has(r.address) ? "text-warn" : "text-muted hover:text-warn"}
                      title={watch.has(r.address) ? "remove from watchlist" : "add to watchlist (background tracking)"}
                    >
                      {watch.has(r.address) ? "★" : "☆"}
                    </button>
                  </td>
                  <td className="py-1 pr-2 font-semibold">
                    {r.symbol}
                    {currentSid === r.sid && <span className="text-smart ml-1">●</span>}
                  </td>
                  <td className="py-1 pr-2 text-muted">{r.network}</td>
                  <td className="py-1 pr-2">
                    {r.phase === "tracking" ? (
                      <span className="text-buy">● live</span>
                    ) : (
                      <span className="text-warn pulse-dot">◌ connecting</span>
                    )}
                    {r.keepAlive && <span className="text-warn ml-1" title="watchlist keep-alive">bg</span>}
                  </td>
                  <td className="py-1 pr-2 text-right">{fmtPrice(r.price)}</td>
                  <td className="py-1 pr-2 text-right text-muted">{fmtUsd(r.liquidity)}</td>
                  <td className="py-1 pr-2 text-right text-smart">{fmtNum(r.wallets)}</td>
                  <td className="py-1 pr-2 text-right text-buy">{r.freshInflow1m > 0 ? fmtUsd(r.freshInflow1m) : "—"}</td>
                  <td className="py-1">
                    {r.lastSignal ? (
                      <span className="text-muted">
                        <span className={r.lastSignal.severity === "critical" ? "text-sell" : r.lastSignal.severity === "warn" ? "text-warn" : "text-info"}>
                          {r.lastSignal.kind}
                        </span>{" "}
                        · {timeAgo(r.lastSignal.ts)}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
