"use client";

import { useEffect, useRef, useState } from "react";
import { useDash } from "@/store/dash";
import { clockTime, fmtNum, fmtPrice, fmtUsd, shortAddr } from "@/lib/format";

export default function TradesFeed() {
  const trades = useDash((s) => s.trades);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<typeof trades | null>(null);
  const [filterWallet, setFilterWallet] = useState<string | null>(null);
  const prevIds = useRef<Set<string>>(new Set());
  const freshIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const cur = new Set(trades.slice(0, 40).map((t) => t.id));
    const fresh = new Set<string>();
    for (const id of cur) if (!prevIds.current.has(id)) fresh.add(id);
    freshIds.current = fresh;
    prevIds.current = cur;
    if (paused) setFrozen(trades);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades]);

  useEffect(() => {
    if (!paused) setFrozen(null);
  }, [paused]);

  const base = paused && frozen ? frozen : trades;
  const shown = (filterWallet ? base.filter((t) => t.wallet === filterWallet) : base).slice(0, 90);

  return (
    <div className="panel flex flex-col h-full min-h-[280px]">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-edge/60">
        <div className="flex items-center gap-2">
          <span className="panel-title">Live trades tape</span>
          <span className="text-[10px] text-muted num">{fmtNum(trades.length)} buffered</span>
        </div>
        <button
          onClick={() => setPaused((p) => !p)}
          className="text-[10px] rounded border border-edge px-2 py-0.5 text-muted hover:text-ink hover:border-edge2"
        >
          {paused ? "▶ resume" : "❚❚ pause"}
        </button>
      </div>
      <div className="overflow-y-auto flex-1">
        <table className="w-full text-[11px] num">
          <thead className="sticky top-0 bg-panel z-10">
            <tr className="text-muted text-left">
              <th className="px-3 py-1.5 font-medium">time</th>
              <th className="px-2 py-1.5 font-medium">side</th>
              <th className="px-2 py-1.5 font-medium text-right">USD</th>
              <th className="px-2 py-1.5 font-medium text-right">qty</th>
              <th className="px-2 py-1.5 font-medium text-right">price</th>
              <th className="px-2 py-1.5 font-medium">wallet</th>
              <th className="px-2 py-1.5 font-medium hidden md:table-cell">pair</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const isNew = prevIds.current.has(t.id) && !paused;
              return (
                <tr
                  key={t.id}
                  className={`border-t border-edge/30 hover:bg-panel2/70 cursor-pointer ${isNew ? (t.side === "buy" ? "flash-buy" : "flash-sell") : ""}`}
                  onClick={() => setFilterWallet(filterWallet === t.wallet ? null : t.wallet)}
                  title="click to filter by wallet"
                >
                  <td className="px-3 py-1 text-muted">{clockTime(t.ts)}</td>
                  <td className="px-2 py-1">
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${t.side === "buy" ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell"}`}>
                      {t.side === "buy" ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td className={`px-2 py-1 text-right font-medium ${t.usd >= 10_000 ? (t.side === "buy" ? "text-buy" : "text-sell") : ""}`}>
                    {fmtUsd(t.usd)}
                  </td>
                  <td className="px-2 py-1 text-right text-muted">{fmtNum(t.qty)}</td>
                  <td className="px-2 py-1 text-right text-muted">{fmtPrice(t.priceUsd)}</td>
                  <td className="px-2 py-1">
                    <span className={filterWallet === t.wallet ? "text-smart" : "text-info"}>{shortAddr(t.wallet, 4)}</span>
                  </td>
                  <td className="px-2 py-1 text-muted hidden md:table-cell">{t.poolLabel} · {t.dex}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filterWallet && (
          <button
            onClick={() => setFilterWallet(null)}
            className="w-full text-center text-[10px] text-warn py-1.5 hover:bg-panel2"
          >
            filter: {shortAddr(filterWallet, 6)} — clear ✕
          </button>
        )}
      </div>
    </div>
  );
}
