/** Number/format helpers shared client & server. */

export function fmtUsd(n: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = opts.sign && n > 0 ? "+" : n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `${sign}$${(a / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}$${(a / 1_000).toFixed(1)}K`;
  if (a >= 1) return `${sign}$${a.toFixed(2)}`;
  if (a >= 0.01) return `${sign}$${a.toFixed(3)}`;
  if (a === 0) return "$0";
  return `${sign}$${a.toPrecision(3)}`;
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n === 0) return "$0";
  // subscript zeros for micro prices
  const s = n.toPrecision(4);
  const m = s.match(/^0\.(0+)(\d+)/);
  if (m) {
    const zeros = m[1].length;
    const digits = m[2].slice(0, 4);
    return `$0.0${subscript(zeros)}${digits}`;
  }
  return `$${s}`;
}

const SUBS = "₀₁₂₃₄₅₆₇₈₉";
function subscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBS[Number(d)])
    .join("");
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function shortAddr(a: string, n = 4): string {
  if (!a) return "";
  return a.length <= 2 * n + 2 ? a : `${a.slice(0, n + 2)}…${a.slice(-n)}`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export const PCT = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
