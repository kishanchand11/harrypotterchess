"use client";

import { useDash } from "@/store/dash";
import { chainByDs } from "@/engine/chains";
import { fmtNum, fmtPct, fmtPrice, fmtUsd, timeAgo } from "@/lib/format";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 first:pl-0">
      <span className="text-[10px] uppercase tracking-wider text-muted whitespace-nowrap">{label}</span>
      <span className="num text-sm font-medium whitespace-nowrap">{children}</span>
    </div>
  );
}

function Delta({ v }: { v: number | null | undefined }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-muted">—</span>;
  const cls = v > 0 ? "text-buy" : v < 0 ? "text-sell" : "text-muted";
  return <span className={`num ${cls}`}>{fmtPct(v, 1)}</span>;
}

export default function StatsHeader() {
  const token = useDash((s) => s.token);
  const price = useDash((s) => s.price);
  const phase = useDash((s) => s.phase);
  const health = useDash((s) => s.health);
  const wallets = useDash((s) => s.wallets);
  const status = useDash((s) => s.status);

  if (!token) return null;
  const chain = chainByDs(token.network);
  const p24 = token.priceUsd > 0 ? ((price - token.priceUsd) / token.priceUsd) * 100 : 0;

  return (
    <div className="panel glow px-4 py-3 flex flex-wrap items-center gap-y-3">
      {token.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={token.imageUrl} alt="" className="w-9 h-9 rounded-full mr-3 border border-edge" />
      ) : (
        <div className="w-9 h-9 rounded-full mr-3 border border-edge bg-panel2 flex items-center justify-center text-xs font-bold text-smart">
          {token.symbol.slice(0, 3)}
        </div>
      )}
      <div className="mr-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{token.symbol}</span>
          <span className="text-xs text-muted">{chain?.label ?? token.network}</span>
          {phase === "tracking" ? (
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-buy/10 text-buy border border-buy/30 font-semibold">
              <span className="pulse-dot mr-1">●</span>LIVE
            </span>
          ) : (
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-warn/15 text-warn border border-warn/30 font-semibold">
              <span className="pulse-dot mr-1">◌</span>CONNECTING…
            </span>
          )}
          {status === "reconnecting" && (
            <span className="text-[10px] rounded px-1.5 py-0.5 bg-warn/10 text-warn border border-warn/20">reconnecting…</span>
          )}
        </div>
        <div className="text-[11px] text-muted num">{token.name}</div>
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 flex-1">
        <Stat label="Price">
          <span className="text-base">{fmtPrice(price)}</span>{" "}
          <Delta v={p24 !== 0 ? p24 : token.priceChange24hPct} />
        </Stat>
        <Stat label="5m">
          <Delta v={token.priceChange5mPct} />
        </Stat>
        <Stat label="1h">
          <Delta v={token.priceChange1hPct} />
        </Stat>
        <Stat label="24h">
          <Delta v={token.priceChange24hPct} />
        </Stat>
        <Stat label="Liquidity">{fmtUsd(token.liquidityUsd)}</Stat>
        <Stat label="Vol 24h">{fmtUsd(token.volume24hUsd)}</Stat>
        <Stat label="Txns 24h">
          <span className="text-buy">{fmtNum(token.buys24h)}</span>
          <span className="text-muted"> / </span>
          <span className="text-sell">{fmtNum(token.sells24h)}</span>
        </Stat>
        <Stat label="FDV">{token.fdvUsd ? fmtUsd(token.fdvUsd) : "—"}</Stat>
        <Stat label="Wallets tracked">
          <span className="text-smart">{wallets.length}</span>
        </Stat>
        <Stat label="Tape">{health ? `${fmtNum(health.tradesIngested)} trades` : "—"}</Stat>
        <Stat label="Uptime">{health ? timeAgo(health.startedAt).replace("now", "0s") : "—"}</Stat>
      </div>
    </div>
  );
}
