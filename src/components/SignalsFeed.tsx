"use client";

import { useDash } from "@/store/dash";
import type { Signal } from "@/engine/types";
import { fmtUsd, shortAddr, timeAgo } from "@/lib/format";

const KIND_META: Record<string, { icon: string; cls: string }> = {
  PUMP_BURST: { icon: "▲", cls: "border-smart/50 bg-smart/10 text-smart" },
  DUMP_BURST: { icon: "▼", cls: "border-sell/50 bg-sell/10 text-sell" },
  WHALE_BUY: { icon: "🐋", cls: "border-buy/50 bg-buy/10 text-buy" },
  WHALE_SELL: { icon: "🐋", cls: "border-sell/50 bg-sell/10 text-sell" },
  SNIPE_CLUSTER: { icon: "🎯", cls: "border-acc/50 bg-acc/10 text-acc" },
  EXIT_CLUSTER: { icon: "🏃", cls: "border-warn/50 bg-warn/10 text-warn" },
  SMART_BUY: { icon: "◆", cls: "border-smart/50 bg-smart/10 text-smart" },
  SMART_SELL: { icon: "◆", cls: "border-warn/50 bg-warn/10 text-warn" },
  FRESH_INFLOW_SPIKE: { icon: "✦", cls: "border-info/50 bg-info/10 text-info" },
  OLD_OUTFLOW_SPIKE: { icon: "⌛", cls: "border-warn/50 bg-warn/10 text-warn" },
  LIQUIDITY_MOVE: { icon: "💧", cls: "border-info/40 bg-info/5 text-info" },
  PRICE_BREAKOUT: { icon: "🚀", cls: "border-buy/50 bg-buy/10 text-buy" },
  PRICE_BREAKDOWN: { icon: "🩸", cls: "border-sell/50 bg-sell/10 text-sell" },
};

export default function SignalsFeed() {
  const signals = useDash((s) => s.signals);

  return (
    <div className="panel flex flex-col h-full min-h-[280px]">
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-edge/60">
        <span className="panel-title">Signal intelligence</span>
        <span className="text-[10px] text-muted num">{signals.length} events</span>
      </div>
      <div className="overflow-y-auto flex-1 p-2.5 space-y-2">
        {signals.length === 0 && (
          <div className="text-xs text-muted p-3">
            No signals yet — the engine raises events on pump/dump bursts, sniper bundles, whale moves, fresh-inflow
            spikes and liquidity changes.
          </div>
        )}
        {signals.map((s) => (
          <SignalCard key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}

function SignalCard({ s }: { s: Signal }) {
  const meta = KIND_META[s.kind] ?? { icon: "•", cls: "border-edge bg-panel2 text-muted" };
  return (
    <div className={`rounded-lg border px-3 py-2 slide-in ${meta.cls}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold flex items-center gap-1.5">
          <span>{meta.icon}</span>
          {s.title}
        </div>
        <span className="text-[9px] text-muted num whitespace-nowrap">{timeAgo(s.ts)}</span>
      </div>
      <div className="text-[10px] text-muted mt-1 leading-relaxed">{s.detail}</div>
      {s.wallets.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {s.wallets.slice(0, 5).map((w) => (
            <span key={w} className="text-[9px] num rounded bg-black/30 px-1.5 py-0.5 text-info">
              {shortAddr(w, 3)}
            </span>
          ))}
          {s.wallets.length > 5 && <span className="text-[9px] text-muted">+{s.wallets.length - 5}</span>}
        </div>
      )}
    </div>
  );
}
