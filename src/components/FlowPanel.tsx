"use client";

import { useEffect, useRef } from "react";
import { useDash } from "@/store/dash";
import { fmtNum, fmtUsd } from "@/lib/format";

export default function FlowPanel() {
  const flow = useDash((s) => s.flow);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !flow || flow.buckets.length < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(200, rect.width);
    const h = Math.max(70, rect.height);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const buckets = flow.buckets.slice(-40);
    const maxV = Math.max(...buckets.map((b) => Math.max(b[1], b[2])), 1);
    const bw = w / buckets.length;
    const mid = h / 2;
    for (let i = 0; i < buckets.length; i++) {
      const [ , newBuy, oldSell ] = buckets[i];
      const hb = (newBuy / maxV) * (mid - 4);
      const hs = (oldSell / maxV) * (mid - 4);
      ctx.fillStyle = "rgba(16,185,129,0.8)";
      ctx.fillRect(i * bw + 0.5, mid - hb, Math.max(bw - 1.5, 1), hb);
      ctx.fillStyle = "rgba(244,63,94,0.8)";
      ctx.fillRect(i * bw + 0.5, mid + 1, Math.max(bw - 1.5, 1), hs);
    }
    ctx.strokeStyle = "#1a2740";
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();
  }, [flow]);

  if (!flow) return null;
  const total = flow.newBuyUsdTotal + flow.oldSellUsdTotal;
  const newShare = total > 0 ? (flow.newBuyUsdTotal / total) * 100 : 50;

  return (
    <div className="panel p-4 flex flex-col h-full min-h-[220px]">
      <div className="flex items-center justify-between mb-3">
        <span className="panel-title">New money vs old money</span>
        <span className="text-[10px] text-muted num">{fmtNum(flow.newWallets)} fresh · {fmtNum(flow.oldWallets)} old</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-buy/30 bg-buy/5 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-buy/80">New users buying</div>
          <div className="num text-lg font-semibold text-buy">{fmtUsd(flow.newBuyUsdTotal)}</div>
          <div className="text-[10px] text-muted num">
            +{fmtUsd(flow.newBuyUsd1m)} last min · {flow.newBuyers1m} wallets
          </div>
        </div>
        <div className="rounded-lg border border-sell/30 bg-sell/5 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-sell/80">Old users selling</div>
          <div className="num text-lg font-semibold text-sell">{fmtUsd(flow.oldSellUsdTotal)}</div>
          <div className="text-[10px] text-muted num">
            +{fmtUsd(flow.oldSellUsd1m)} last min · {flow.oldSellers1m} wallets
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="h-2 rounded-full overflow-hidden flex bg-panel2">
          <div className="h-full bg-buy/80 transition-all duration-700" style={{ width: `${newShare}%` }} />
          <div className="h-full bg-sell/80 transition-all duration-700" style={{ width: `${100 - newShare}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted num mt-1">
          <span>{newShare.toFixed(0)}% inflow</span>
          <span>{(100 - newShare).toFixed(0)}% distribution</span>
        </div>
      </div>

      <div className="mt-auto pt-3">
        <div className="text-[10px] text-muted mb-1">1-min buckets — inflow ↑ / distribution ↓</div>
        <canvas ref={canvasRef} className="w-full h-[70px]" />
      </div>
    </div>
  );
}
