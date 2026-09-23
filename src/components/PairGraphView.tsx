"use client";

import { useMemo, useState } from "react";
import { useDash } from "@/store/dash";
import { fmtPrice, fmtUsd, shortAddr } from "@/lib/format";

const DEX_COLORS: Record<string, string> = {
  uniswap: "#ff007a",
  "uniswap v2": "#ff007a",
  "uniswap v3": "#ff007a",
  "uniswap v4": "#ff007a",
  pancakeswap: "#d7a86e",
  raydium: "#2f9e6e",
  aerodrome: "#4da6ff",
  orca: "#ffd42a",
  sushiswap: "#0e9f6e",
  curve: "#facc15",
  "fluid dex": "#00c2ff",
  "meteora dlmm": "#14b8a6",
};

function dexColor(dex: string): string {
  const key = Object.keys(DEX_COLORS).find((k) => dex.toLowerCase().includes(k));
  return DEX_COLORS[key ?? ""] ?? "#38bdf8";
}

export default function PairGraphView() {
  const graph = useDash((s) => s.graph);
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    if (!graph || graph.pairs.length === 0) return null;
    const W = 460;
    const H = 320;
    const cx = W / 2;
    const cy = H / 2;
    const pairs = graph.pairs.slice(0, 10).map((p, i, arr) => {
      const angle = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
      const maxLiq = Math.max(...arr.map((x) => x.liquidityUsd), 1);
      const r = 70 + 60 * (1 - p.liquidityUsd / maxLiq) + (i % 2) * 12;
      return {
        ...p,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r * 0.82,
        r: 9 + 10 * (p.liquidityUsd / maxLiq),
      };
    });
    return { W, H, cx, cy, pairs };
  }, [graph]);

  if (!graph || !layout)
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted min-h-[240px]">
        Pair graph loads with the first live snapshot…
      </div>
    );

  const { W, H, cx, cy, pairs } = layout;
  const maxLiq = Math.max(...pairs.map((p) => p.liquidityUsd), 1);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <radialGradient id="tokGlow">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.15" />
          </radialGradient>
        </defs>

        {pairs.map((p, pi) => {
          const isPrimary = p.isPrimary;
          const lw = 1 + 4 * (p.liquidityUsd / maxLiq);
          const dim = hover && hover !== p.address;
          return (
            <g key={`${p.address}-${pi}`} opacity={dim ? 0.25 : 1} className="transition-opacity">
              <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={dexColor(p.dex)} strokeWidth={lw} strokeOpacity={isPrimary ? 0.85 : 0.5} />
              <circle
                cx={p.x}
                cy={p.y}
                r={p.r}
                fill="#0c1220"
                stroke={dexColor(p.dex)}
                strokeWidth={isPrimary ? 2.5 : 1.5}
                onMouseEnter={() => setHover(p.address)}
                onMouseLeave={() => setHover(null)}
                className="cursor-pointer"
              />
              <text x={p.x} y={p.y - p.r - 6} textAnchor="middle" fontSize="10" fill="#e6edfb" className="num">
                {p.quoteSymbol}
              </text>
              <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize="8" fill="#64748f">
                {p.dex.split(" ")[0].slice(0, 8)}
              </text>
            </g>
          );
        })}

        <circle cx={cx} cy={cy} r={34} fill="url(#tokGlow)" />
        <circle cx={cx} cy={cy} r={30} fill="#160f2e" stroke="#a78bfa" strokeWidth="1.5" />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="12" fontWeight="700" fill="#e6edfb">
          {graph.token.symbol.slice(0, 7)}
        </text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize="8.5" fill="#a78bfa" className="num">
          {fmtPrice(graph.token.priceUsd)}
        </text>
      </svg>

      {hover && (
        <div className="absolute top-1 right-1 panel px-3 py-2 text-[11px] num space-y-0.5 max-w-[230px]">
          {(() => {
            const p = pairs.find((x) => x.address === hover);
            if (!p) return null;
            return (
              <>
                <div className="font-semibold">{p.label}</div>
                <div className="text-muted">{p.dex} · {p.network}</div>
                <div>price {fmtPrice(p.priceUsd)}</div>
                <div>liq <span className="text-info">{fmtUsd(p.liquidityUsd)}</span></div>
                <div>vol24h {fmtUsd(p.volume24hUsd)}</div>
                <div>
                  <span className="text-buy">{p.buys24h} buys</span> / <span className="text-sell">{p.sells24h} sells</span>
                </div>
                {p.createdAt && <div className="text-muted">pool {new Date(p.createdAt).toLocaleDateString()}</div>}
                {p.url.startsWith("http") && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-smart underline">
                    open on dexscreener ↗
                  </a>
                )}
              </>
            );
          })()}
        </div>
      )}
      <div className="mt-1 text-[10px] text-muted num px-1">
        {graph.pairs.length} pair{graph.pairs.length === 1 ? "" : "s"} · edge = liquidity · {shortAddr(graph.token.address, 6)}
      </div>
    </div>
  );
}
