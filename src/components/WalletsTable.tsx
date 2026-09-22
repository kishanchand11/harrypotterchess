"use client";

import { useEffect, useMemo, useState } from "react";
import { useDash } from "@/store/dash";
import type { WalletSummary } from "@/engine/types";
import { clockTime, fmtNum, fmtPrice, fmtUsd, shortAddr, timeAgo } from "@/lib/format";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "smart-money", label: "◆ Smart" },
  { id: "whale", label: "🐋 Whales" },
  { id: "sniper", label: "🎯 Snipers" },
  { id: "pumper", label: "▲ Pumpers" },
  { id: "dumper", label: "▼ Dumpers" },
  { id: "fresh-wallet", label: "✦ Fresh" },
  { id: "old-holder", label: "⌛ Old Holders" },
  { id: "accumulator", label: "＋ Accumulators" },
];

export const CLASS_META: Record<string, { label: string; color: string }> = {
  "smart-money": { label: "Smart", color: "text-smart border-smart/40 bg-smart/10" },
  whale: { label: "Whale", color: "text-warn border-warn/40 bg-warn/10" },
  sniper: { label: "Sniper", color: "text-acc border-acc/40 bg-acc/10" },
  pumper: { label: "Pumper", color: "text-buy border-buy/40 bg-buy/10" },
  dumper: { label: "Dumper", color: "text-sell border-sell/40 bg-sell/10" },
  "fresh-wallet": { label: "Fresh", color: "text-info border-info/40 bg-info/10" },
  "old-holder": { label: "Old Holder", color: "text-warn border-warn/30 bg-warn/5" },
  accumulator: { label: "Accum.", color: "text-buy border-buy/30 bg-buy/5" },
  distributor: { label: "Distrib.", color: "text-sell border-sell/30 bg-sell/5" },
  active: { label: "Active", color: "text-muted border-edge bg-panel2" },
};

function ScoreBar({ v }: { v: number }) {
  const color = v >= 65 ? "#a78bfa" : v >= 40 ? "#38bdf8" : "#64748f";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-10 h-1.5 rounded bg-panel2 overflow-hidden">
        <div className="h-full rounded" style={{ width: `${Math.min(100, v)}%`, background: color }} />
      </div>
      <span className="text-[10px] num" style={{ color }}>
        {v.toFixed(0)}
      </span>
    </div>
  );
}

function TimingBar({ v }: { v: number }) {
  // -1..1 → centered bar
  const pct = ((v + 1) / 2) * 100;
  const color = v > 0.15 ? "bg-buy" : v < -0.15 ? "bg-sell" : "bg-muted";
  return (
    <div className="w-12 h-1.5 rounded bg-panel2 relative overflow-hidden" title={`timing ${v.toFixed(2)}`}>
      <div className="absolute top-0 bottom-0 w-0.5 bg-edge2 left-1/2" />
      <div
        className={`absolute top-0 bottom-0 ${color}`}
        style={v >= 0 ? { left: "50%", width: `${pct - 50}%` } : { right: "50%", width: `${50 - pct}%` }}
      />
    </div>
  );
}

export default function WalletsTable() {
  const wallets = useDash((s) => s.wallets);
  const classFilter = useDash((s) => s.classFilter);
  const setClassFilter = useDash((s) => s.setClassFilter);
  const sid = useDash((s) => s.sid);
  const [selected, setSelected] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: wallets.length };
    for (const w of wallets) c[w.klass] = (c[w.klass] ?? 0) + 1;
    // also count label-based for smart money chips
    c["smart-money"] = wallets.filter((w) => w.smartScore >= 65 && w.trades >= 3).length;
    return c;
  }, [wallets]);

  const rows = useMemo(() => {
    let list = wallets;
    if (classFilter === "smart-money") list = list.filter((w) => w.smartScore >= 65 && w.trades >= 3);
    else if (classFilter !== "all") list = list.filter((w) => w.klass === classFilter);
    return list.slice(0, 100);
  }, [wallets, classFilter]);

  return (
    <div className="panel flex flex-col h-full min-h-[360px]">
      <div className="px-4 pt-3 pb-2 border-b border-edge/60 flex flex-wrap items-center gap-1.5">
        <span className="panel-title mr-2">Wallet intelligence</span>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setClassFilter(f.id)}
            className={`text-[10px] rounded-full px-2.5 py-0.5 border transition-colors num ${
              classFilter === f.id ? "border-smart/60 bg-smart/10 text-smart" : "border-edge text-muted hover:text-ink hover:border-edge2"
            }`}
          >
            {f.label} <span className="opacity-60">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-[11px] num">
          <thead className="sticky top-0 bg-panel z-10">
            <tr className="text-muted text-left whitespace-nowrap">
              <th className="px-3 py-1.5 font-medium">#</th>
              <th className="px-2 py-1.5 font-medium">wallet</th>
              <th className="px-2 py-1.5 font-medium">class</th>
              <th className="px-2 py-1.5 font-medium">score</th>
              <th className="px-2 py-1.5 font-medium text-right">trades</th>
              <th className="px-2 py-1.5 font-medium text-right">bought</th>
              <th className="px-2 py-1.5 font-medium text-right">sold</th>
              <th className="px-2 py-1.5 font-medium text-right">position</th>
              <th className="px-2 py-1.5 font-medium text-right">realized PnL</th>
              <th className="px-2 py-1.5 font-medium text-center">timing</th>
              <th className="px-2 py-1.5 font-medium text-right">impact /$1k</th>
              <th className="px-2 py-1.5 font-medium text-right">active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr
                key={w.address}
                onClick={() => setSelected(w.address)}
                className={`border-t border-edge/30 cursor-pointer hover:bg-panel2/70 ${selected === w.address ? "bg-panel2" : ""}`}
              >
                <td className="px-3 py-1 text-muted">{i + 1}</td>
                <td className="px-2 py-1 text-info whitespace-nowrap">{shortAddr(w.address, 4)}</td>
                <td className="px-2 py-1">
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold border ${CLASS_META[w.klass].color}`}>
                    {CLASS_META[w.klass].label}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <ScoreBar v={w.smartScore} />
                </td>
                <td className="px-2 py-1 text-right">
                  <span className="text-buy">{w.buys}</span>/<span className="text-sell">{w.sells}</span>
                </td>
                <td className="px-2 py-1 text-right">{fmtUsd(w.buyUsd)}</td>
                <td className="px-2 py-1 text-right">{fmtUsd(w.sellUsd)}</td>
                <td className="px-2 py-1 text-right">{w.netQty > 0 ? fmtUsd(w.positionUsd) : "—"}</td>
                <td className={`px-2 py-1 text-right ${(w.realizedPnl ?? 0) > 0 ? "text-buy" : (w.realizedPnl ?? 0) < 0 ? "text-sell" : "text-muted"}`}>
                  {w.realizedPnl != null ? fmtUsd(w.realizedPnl, { sign: true }) : "—"}
                </td>
                <td className="px-2 py-1">
                  <div className="flex justify-center">
                    <TimingBar v={w.timingScore} />
                  </div>
                </td>
                <td className={`px-2 py-1 text-right ${w.impactScore > 0.1 ? "text-buy" : w.impactScore < -0.1 ? "text-sell" : "text-muted"}`}>
                  {w.impactScore === 0 ? "—" : w.impactScore.toFixed(2)}
                </td>
                <td className="px-2 py-1 text-right text-muted">{timeAgo(w.lastActive)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-muted">
                  {wallets.length === 0 ? "Waiting for trades…" : "No wallets match this filter yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selected && <WalletDrawer sid={sid} wallet={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

interface WalletIntel {
  summary: WalletSummary;
  trades: { id: string; ts: number; side: string; usd: number; qty: number; priceUsd: number; poolLabel: string }[];
  enrichment: {
    walletAgeFirstTx?: number | null;
    recentSwaps?: { symbol: string; side: string; usd: number; ts: number; exchange: string }[];
    recentIncoming?: { symbol: string; ts: number; contract: string }[];
    source: string[];
  };
}

function WalletDrawer({ sid, wallet, onClose }: { sid: string | null; wallet: string; onClose: () => void }) {
  const [intel, setIntel] = useState<WalletIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const price = useDash((s) => s.price);

  useMemo(() => {
    if (!sid) return;
    setLoading(true);
    fetch(`/api/wallet?sid=${encodeURIComponent(sid)}&wallet=${wallet}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setIntel(j))
      .catch(() => setIntel(null))
      .finally(() => setLoading(false));
  }, [sid, wallet]);

  const w = intel?.summary;
  const unrealized = w ? w.netQty * (price - w.avgBuyPrice) : 0;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-panel border-l border-edge overflow-y-auto slide-in">
        <div className="sticky top-0 bg-panel/95 backdrop-blur px-5 py-4 border-b border-edge flex items-start justify-between z-10">
          <div>
            <div className="text-xs text-muted">Wallet deep dive</div>
            <div className="num text-sm text-info break-all">{wallet}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>

        {loading || !w ? (
          <div className="p-5 text-xs text-muted">loading…</div>
        ) : (
          <div className="p-5 space-y-5">
            <div className="flex flex-wrap gap-1.5">
              <span className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${CLASS_META[w.klass]?.color ?? ""}`}>
                {CLASS_META[w.klass]?.label ?? w.klass}
              </span>
              {w.labels.map((l) => (
                <span key={l} className="rounded px-2 py-0.5 text-[10px] border border-edge text-muted">
                  {l}
                </span>
              ))}
              {intel.enrichment.source.length > 0 && (
                <span className="rounded px-2 py-0.5 text-[10px] border border-info/30 text-info">
                  enriched via {intel.enrichment.source.join(", ")}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs num">
              <Cell label="Smart score" value={`${w.smartScore.toFixed(1)}/100`} />
              <Cell label="Trades (b/s)" value={`${w.trades} (${w.buys}/${w.sells})`} />
              <Cell label="Bought" value={fmtUsd(w.buyUsd)} />
              <Cell label="Sold" value={fmtUsd(w.sellUsd)} />
              <Cell label="Avg buy" value={fmtPrice(w.avgBuyPrice)} />
              <Cell label="Avg sell" value={fmtPrice(w.avgSellPrice)} />
              <Cell label="Open position" value={w.netQty > 0 ? fmtUsd(w.positionUsd) : "flat"} />
              <Cell
                label="Realized PnL"
                value={w.realizedPnl != null ? fmtUsd(w.realizedPnl, { sign: true }) : "n/a (old holder)"}
                cls={(w.realizedPnl ?? 0) > 0 ? "text-buy" : (w.realizedPnl ?? 0) < 0 ? "text-sell" : ""}
              />
              <Cell
                label="Unrealized PnL"
                value={w.netQty > 0 ? fmtUsd(unrealized, { sign: true }) : "—"}
                cls={unrealized > 0 ? "text-buy" : unrealized < 0 ? "text-sell" : ""}
              />
              <Cell label="Win rate" value={w.winRate != null ? `${(w.winRate * 100).toFixed(0)}% (${fmtNum(w.trades)} rt)` : "—"} />
              <Cell label="Price impact" value={`${w.impactScore.toFixed(2)}%/$1k`} cls={w.impactScore > 0 ? "text-buy" : "text-sell"} />
              <Cell label="Timing skill" value={w.timingScore.toFixed(2)} cls={w.timingScore > 0.15 ? "text-buy" : w.timingScore < -0.15 ? "text-sell" : ""} />
              <Cell label="First seen (tape)" value={new Date(w.firstSeen).toLocaleTimeString("en-US", { hour12: false })} />
              <Cell
                label="Wallet age"
                value={
                  intel.enrichment.walletAgeFirstTx
                    ? timeAgo(intel.enrichment.walletAgeFirstTx).replace("now", "0s") + " old"
                    : "add Etherscan key"
                }
              />
            </div>

            {intel.enrichment.recentSwaps && intel.enrichment.recentSwaps.length > 0 && (
              <Section title="Recent swaps (all tokens — radar)">
                {intel.enrichment.recentSwaps.slice(0, 10).map((s, i) => (
                  <div key={i} className="flex justify-between text-[11px] num py-0.5">
                    <span>
                      <span className={s.side === "buy" ? "text-buy" : "text-sell"}>{s.side.toUpperCase()}</span> {s.symbol}
                      <span className="text-muted"> · {s.exchange}</span>
                    </span>
                    <span className="text-muted">{fmtUsd(s.usd)}</span>
                  </div>
                ))}
              </Section>
            )}

            <Section title={`Trades in this token (${intel.trades.length})`}>
              {intel.trades.slice(0, 20).map((t) => (
                <div key={t.id} className="flex justify-between text-[11px] num py-0.5">
                  <span>
                    <span className={t.side === "buy" ? "text-buy" : "text-sell"}>{t.side === "buy" ? "BUY " : "SELL"}</span>{" "}
                    {fmtUsd(t.usd)} @ {fmtPrice(t.priceUsd)}
                  </span>
                  <span className="text-muted">
                    {clockTime(t.ts)} · {t.poolLabel}
                  </span>
                </div>
              ))}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel2 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xs font-medium mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="panel-title mb-1.5">{title}</div>
      <div className="rounded-lg border border-edge bg-panel2 px-3 py-2">{children}</div>
    </div>
  );
}
