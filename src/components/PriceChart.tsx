"use client";

import { useEffect, useRef, useState } from "react";
import { useDash } from "@/store/dash";
import type { Signal, Tick, Trade } from "@/engine/types";
import { fmtPrice, fmtUsd, clockTime } from "@/lib/format";

const BUY = "#10b981";
const SELL = "#f43f5e";
const GRID = "#141d31";
const AXIS = "#64748f";

interface ChartData {
  ticks: Tick[];
  trades: Trade[];
  signals: Signal[];
  version: number;
}

export default function PriceChart() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef<ChartData>({ ticks: [], trades: [], signals: [], version: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; tick: Tick } | null>(null);

  const ticks = useDash((s) => s.ticks);
  const trades = useDash((s) => s.trades);
  const signals = useDash((s) => s.signals);
  const mode = useDash((s) => s.mode);

  useEffect(() => {
    dataRef.current = {
      ticks,
      trades,
      signals,
      version: dataRef.current.version + 1,
    };
  }, [ticks, trades, signals]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastVersion = -1;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      w = Math.max(320, rect.width);
      h = Math.max(220, rect.height);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      lastVersion = -1;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const d = dataRef.current;
      if (d.version === lastVersion) return;
      lastVersion = d.version;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const ticksArr = d.ticks;
      if (ticksArr.length < 2) {
        ctx.fillStyle = AXIS;
        ctx.font = "12px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(mode === "simulated" ? "waiting for tape…" : "connecting to price feed…", w / 2, h / 2);
        return;
      }

      const padR = 64;
      const padT = 12;
      const pressureH = 46;
      const plotH = h - padT - pressureH - 22;
      const plotW = w - padR - 8;

      const t0 = ticksArr[0].ts;
      const t1 = ticksArr[ticksArr.length - 1].ts;
      const tSpan = Math.max(t1 - t0, 1);
      let pMin = Infinity;
      let pMax = -Infinity;
      for (const t of ticksArr) {
        if (t.priceUsd < pMin) pMin = t.priceUsd;
        if (t.priceUsd > pMax) pMax = t.priceUsd;
      }
      // include recent trade markers in range (only last 20 min)
      const cutoff = t1 - Math.min(tSpan, 20 * 60_000);
      const marks = d.trades.filter((tr) => tr.ts >= cutoff && tr.ts >= t0);
      const sigs = d.signals.filter((s) => s.priceUsd && s.ts >= t0);
      for (const m of marks) {
        if (m.priceUsd < pMin) pMin = m.priceUsd;
        if (m.priceUsd > pMax) pMax = m.priceUsd;
      }
      const pad = (pMax - pMin) * 0.08 || pMax * 0.01 || 1e-9;
      pMin -= pad;
      pMax += pad;
      const x = (ts: number) => 8 + Math.min(1, Math.max(0, (ts - t0) / tSpan)) * plotW;
      const y = (p: number) => padT + plotH - ((p - pMin) / (pMax - pMin)) * plotH;

      // ── grid + price axis ────────────────────────────────────────────────
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left";
      for (let i = 0; i <= 4; i++) {
        const p = pMin + ((pMax - pMin) * i) / 4;
        const yy = y(p);
        ctx.strokeStyle = GRID;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, yy);
        ctx.lineTo(8 + plotW, yy);
        ctx.stroke();
        ctx.fillStyle = AXIS;
        ctx.fillText(fmtPrice(p), 8 + plotW + 6, yy + 3);
      }
      // time axis
      ctx.textAlign = "center";
      for (let i = 0; i <= 4; i++) {
        const ts = t0 + (tSpan * i) / 4;
        const xx = x(ts);
        ctx.fillStyle = AXIS;
        ctx.fillText(clockTime(ts).slice(0, 5), xx, h - 8);
        ctx.strokeStyle = GRID;
        ctx.beginPath();
        ctx.moveTo(xx, padT);
        ctx.lineTo(xx, padT + plotH);
        ctx.stroke();
      }

      // ── pressure histogram (buys - sells per 10s bucket, two-pointer O(T+N)) ──
      let maxPress = 1;
      const sortedTrades = [...d.trades].sort((a, b) => a.ts - b.ts);
      const pressures: number[] = new Array(ticksArr.length);
      let lo = 0;
      let hi = 0;
      let running = 0;
      for (let i = 0; i < ticksArr.length; i++) {
        const upper = ticksArr[i].ts;
        const lower = upper - 10_000;
        while (hi < sortedTrades.length && sortedTrades[hi].ts <= upper) {
          running += sortedTrades[hi].side === "buy" ? sortedTrades[hi].usd : -sortedTrades[hi].usd;
          hi++;
        }
        while (lo < hi && sortedTrades[lo].ts <= lower) {
          running -= sortedTrades[lo].side === "buy" ? sortedTrades[lo].usd : -sortedTrades[lo].usd;
          lo++;
        }
        pressures[i] = running;
        if (Math.abs(running) > maxPress) maxPress = Math.abs(running);
      }
      const pBase = padT + plotH + 14;
      for (let i = 0; i < pressures.length; i++) {
        const p = pressures[i];
        const xx = x(ticksArr[i].ts);
        const bh = (Math.abs(p) / maxPress) * (pressureH - 10);
        ctx.fillStyle = p >= 0 ? "rgba(16,185,129,0.45)" : "rgba(244,63,94,0.45)";
        ctx.fillRect(xx - 1, p >= 0 ? pBase - bh : pBase + 2, 2.5, Math.max(bh, 1));
      }
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(8, pBase + 1);
      ctx.lineTo(8 + plotW, pBase + 1);
      ctx.stroke();

      // ── price area + line ────────────────────────────────────────────────
      const up = ticksArr[ticksArr.length - 1].priceUsd >= ticksArr[0].priceUsd;
      const lineColor = up ? BUY : SELL;
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, up ? "rgba(16,185,129,0.18)" : "rgba(244,63,94,0.18)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.moveTo(x(ticksArr[0].ts), y(ticksArr[0].priceUsd));
      for (const t of ticksArr) ctx.lineTo(x(t.ts), y(t.priceUsd));
      ctx.lineTo(x(t1), padT + plotH);
      ctx.lineTo(x(t0), padT + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(x(ticksArr[0].ts), y(ticksArr[0].priceUsd));
      for (const t of ticksArr) ctx.lineTo(x(t.ts), y(t.priceUsd));
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // ── EMA20 ────────────────────────────────────────────────────────────
      const k = 2 / (20 + 1);
      let ema = ticksArr[0].priceUsd;
      ctx.beginPath();
      ctx.moveTo(x(ticksArr[0].ts), y(ema));
      for (let i = 1; i < ticksArr.length; i++) {
        ema = ticksArr[i].priceUsd * k + ema * (1 - k);
        ctx.lineTo(x(ticksArr[i].ts), y(ema));
      }
      ctx.strokeStyle = "rgba(167,139,250,0.75)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // ── trade markers (last 20 min window) ──────────────────────────────
      for (const m of marks) {
        const r = Math.min(9, 1.6 + Math.sqrt(m.usd) / 22);
        ctx.beginPath();
        ctx.arc(x(m.ts), y(m.priceUsd), r, 0, Math.PI * 2);
        ctx.fillStyle = m.side === "buy" ? "rgba(16,185,129,0.75)" : "rgba(244,63,94,0.75)";
        ctx.fill();
      }

      // ── signal markers ───────────────────────────────────────────────────
      for (const s of sigs) {
        const xx = x(s.ts);
        const yy = y(s.priceUsd as number);
        const col =
          s.kind === "PUMP_BURST" || s.kind === "SNIPE_CLUSTER"
            ? "#a78bfa"
            : s.kind === "DUMP_BURST" || s.kind === "EXIT_CLUSTER"
              ? "#fbbf24"
              : "#38bdf8";
        ctx.beginPath();
        ctx.moveTo(xx, yy - 12);
        ctx.lineTo(xx - 4.5, yy - 20);
        ctx.lineTo(xx + 4.5, yy - 20);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
      }

      // ── last price tag ───────────────────────────────────────────────────
      const last = ticksArr[ticksArr.length - 1];
      const ly = y(last.priceUsd);
      ctx.fillStyle = lineColor;
      ctx.fillRect(8 + plotW + 2, ly - 8, padR - 6, 16);
      ctx.fillStyle = "#04121a";
      ctx.font = "bold 10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(fmtPrice(last.priceUsd).replace("$", ""), 8 + plotW + 5, ly + 3);

      // hover crosshair handled via tooltip element (React) — guide lines here
      if (hoverRef.current) {
        const hv = hoverRef.current;
        ctx.strokeStyle = "rgba(230,237,251,0.25)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hv.x, padT);
        ctx.lineTo(hv.x, padT + plotH);
        ctx.moveTo(8, hv.y);
        ctx.lineTo(8 + plotW, hv.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    const hoverRef = { current: null as { x: number; y: number } | null };
    raf = requestAnimationFrame(draw);
    (canvas as unknown as { _hoverRef?: typeof hoverRef })._hoverRef = hoverRef;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode]);

  // hover → find nearest tick
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const ticksArr = ticks;
    if (ticksArr.length < 2) return;
    const t0 = ticksArr[0].ts;
    const t1 = ticksArr[ticksArr.length - 1].ts;
    const padR = 64;
    const plotW = rect.width - padR - 8;
    const frac = Math.min(1, Math.max(0, (px - 8) / plotW));
    const target = t0 + frac * (t1 - t0);
    let nearest = ticksArr[0];
    let best = Infinity;
    for (const t of ticksArr) {
      const d = Math.abs(t.ts - target);
      if (d < best) {
        best = d;
        nearest = t;
      }
    }
    const hoverRef = (canvas as unknown as { _hoverRef?: { current: { x: number; y: number } | null } })._hoverRef;
    if (hoverRef) hoverRef.current = { x: px, y: py };
    setHover({ x: px, y: py, tick: nearest });
  };

  const onMouseLeave = () => {
    const canvas = canvasRef.current;
    const hoverRef = (canvas as unknown as { _hoverRef?: { current: { x: number; y: number } | null } })._hoverRef;
    if (hoverRef) hoverRef.current = null;
    setHover(null);
  };

  return (
    <div ref={wrapRef} className="relative w-full h-full min-h-[260px]">
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseLeave={onMouseLeave}
        className="w-full h-full cursor-crosshair"
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 panel px-3 py-2 text-[11px] num whitespace-nowrap"
          style={{
            left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 400) - 150),
            top: Math.max(4, hover.y - 54),
          }}
        >
          <div className="text-muted">{new Date(hover.tick.ts).toLocaleTimeString("en-US", { hour12: false })}</div>
          <div>{fmtPrice(hover.tick.priceUsd)}</div>
          <div className="text-muted">Liq {fmtUsd(hover.tick.liquidityUsd)}</div>
          {hover.tick.buys1m + hover.tick.sells1m > 0 && (
            <div>
              <span className="text-buy">{hover.tick.buys1m} buys</span>
              <span className="text-muted"> / </span>
              <span className="text-sell">{hover.tick.sells1m} sells</span>
              <span className="text-muted"> (1m)</span>
            </div>
          )}
        </div>
      )}
      <div className="absolute top-2 left-3 flex gap-3 text-[10px] text-muted num pointer-events-none">
        <span>
          <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: BUY }} />
          buy
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: SELL }} />
          sell
        </span>
        <span>
          <span className="inline-block w-2 h-2 mr-1" style={{ background: "#a78bfa" }} />
          EMA20
        </span>
        <span>bubble = trade size</span>
      </div>
    </div>
  );
}
