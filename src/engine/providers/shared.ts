/** Shared HTTP + health utilities for all providers. */

export interface Health {
  label: string;
  state: "ok" | "degraded" | "down" | "idle" | "needs-key";
  detail: string;
  lastOkAt: number | null;
  calls: number;
  errors: number;
}

export function makeHealth(label: string) {
  return { label, state: "idle" as const, detail: "not called yet", lastOkAt: null, calls: 0, errors: 0 };
}

export function ok<T>(h: Health, v: T): T {
  h.state = "ok";
  h.lastOkAt = Date.now();
  h.calls++;
  return v;
}

export function fail(h: Health, e: unknown, detail?: string): never {
  h.errors++;
  h.state = "down";
  h.detail = detail ?? (e instanceof Error ? e.message : String(e));
  throw e;
}

export async function fetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; health?: Health } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent": "SmartMoneyAnalyzer/1.0 (+defi-intel)",
        ...opts.headers,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status} ${body.slice(0, 140)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function shortAddr(a: string, n = 4): string {
  if (!a) return "";
  return a.length <= 2 * n + 2 ? a : `${a.slice(0, n + 2)}…${a.slice(-n)}`;
}

export const toNum = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
