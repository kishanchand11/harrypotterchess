/**
 * HistoryStore — lightweight persistence (zero deps, JSONL + JSON snapshots).
 *
 * Closes the "no memory" gap vs Nansen:
 *  • per-token trade tape + signals survive restarts (data/history/tokens/*.jsonl)
 *  • per-token last-known positions → "old holder" recognition across sessions
 *  • lifetime wallet aggregates (all tokens) → cross-session track records
 *
 * Safe-by-construction: all file paths are derived from validated addresses;
 * every read is try/catch'd; writes are debounced/batched; volume is bounded
 * (trade tape rotates, wallet token lists capped).
 */
import fs from "node:fs";
import path from "node:path";
import type { Signal, Trade } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "history");
const TOKENS_DIR = path.join(DATA_DIR, "tokens");
const POSITIONS_DIR = path.join(DATA_DIR, "positions");
const WALLETS_FILE = path.join(DATA_DIR, "wallets.json");
const MAX_TAPE_BYTES = 12 * 1024 * 1024; // rotate token tape beyond 12MB
const MAX_WALLET_TOKENS = 50;

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Only validated addresses may become file-path segments (no traversal). */
export function isSafeAddress(a: string): boolean {
  return EVM.test(a) || SOL.test(a);
}

function ensureDirs(): void {
  for (const d of [DATA_DIR, TOKENS_DIR, POSITIONS_DIR]) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch {
      /* exists */
    }
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, v: unknown): void {
  try {
    fs.writeFileSync(file, JSON.stringify(v));
  } catch {
    /* disk full / readonly — non-fatal */
  }
}

export interface WalletAgg {
  sessions: number;
  firstSeen: number;
  lastSeen: number;
  buyUsd: number;
  sellUsd: number;
  realizedPnl: number;
  wins: number;
  losses: number;
  trades: number;
  tokens: Record<string, { n: number; pnl: number }>;
}

export interface SessionSummary {
  sid: string;
  network: string;
  endedAt: number;
  trades: number;
  price: number;
  wallets: number;
}

class HistoryStore {
  private ready = false;

  init(): void {
    if (this.ready) return;
    ensureDirs();
    this.ready = true;
  }

  private tokenTape(token: string): string | null {
    if (!isSafeAddress(token)) return null;
    this.init();
    return path.join(TOKENS_DIR, `${token.toLowerCase()}.jsonl`);
  }

  /** Append trades as compact JSONL lines (one fs call per batch). */
  recordTrades(token: string, trades: Trade[]): void {
    const file = this.tokenTape(token);
    if (!file || trades.length === 0) return;
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_TAPE_BYTES) {
        // rotate: keep newest half
        const lines = fs.readFileSync(file, "utf8").trim().split("\n");
        fs.writeFileSync(file, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
      }
      const chunk = trades
        .map((t) =>
          JSON.stringify({
            k: "t",
            t: t.ts,
            w: t.wallet,
            s: t.side === "buy" ? "b" : "s",
            u: Math.round(t.usd * 100) / 100,
            p: t.priceUsd,
            q: t.qty,
            pool: t.poolLabel,
          }),
        )
        .join("\n");
      fs.appendFileSync(file, chunk + "\n");
    } catch {
      /* non-fatal */
    }
  }

  /** Bounded wallet↔wallet transfer records (forensics) — same tape file, kind "x". */
  recordTransfers(token: string, rows: { from: string; to: string; qty: number; ts: number; tx: string }[]): void {
    const file = this.tokenTape(token);
    if (!file || rows.length === 0) return;
    try {
      const chunk = rows
        .map((r) => JSON.stringify({ k: "x", t: r.ts, f: r.from, o: r.to, q: Math.round(r.qty * 1e6) / 1e6, tx: r.tx }))
        .join("\n");
      fs.appendFileSync(file, chunk + "\n");
    } catch {
      /* non-fatal */
    }
  }

  recordSignal(token: string, sig: Signal): void {
    const file = this.tokenTape(token);
    if (!file) return;
    try {
      fs.appendFileSync(
        file,
        JSON.stringify({ k: "s", t: sig.ts, kind: sig.kind, sev: sig.severity, title: sig.title, usd: sig.usd ?? null }) + "\n",
      );
    } catch {
      /* non-fatal */
    }
  }

  /** Last-known net positions per wallet for a token (for old-holder seeding). */
  loadPriorPositions(token: string): Map<string, number> {
    const file = path.join(POSITIONS_DIR, `${token.toLowerCase()}.json`);
    const out = new Map<string, number>();
    if (!isSafeAddress(token)) return out;
    const data = readJson<Record<string, number>>(file, {});
    for (const [w, qty] of Object.entries(data)) {
      if (typeof qty === "number" && qty > 0 && isSafeAddress(w)) out.set(w.toLowerCase(), qty);
    }
    return out;
  }

  /** Persist session end: positions snapshot, wallet aggregates, session meta. */
  recordSessionEnd(
    token: string,
    summary: SessionSummary,
    wallets: { address: string; netQty: number; buyUsd: number; sellUsd: number; realizedPnl: number; trades: number; wins: number; losses: number }[],
  ): void {
    if (!isSafeAddress(token)) return;
    this.init();
    // 1) positions snapshot (positive balances only)
    const pos: Record<string, number> = {};
    for (const w of wallets) {
      if (w.netQty > 0) pos[w.address] = w.netQty;
    }
    writeJson(path.join(POSITIONS_DIR, `${token.toLowerCase()}.json`), pos);

    // 2) wallet lifetime aggregates
    const aggs = readJson<Record<string, WalletAgg>>(WALLETS_FILE, {});
    for (const w of wallets) {
      const a =
        aggs[w.address] ??
        ({ sessions: 0, firstSeen: summary.endedAt, lastSeen: 0, buyUsd: 0, sellUsd: 0, realizedPnl: 0, wins: 0, losses: 0, trades: 0, tokens: {} } as WalletAgg);
      a.sessions += 1;
      a.lastSeen = Math.max(a.lastSeen, summary.endedAt);
      a.firstSeen = Math.min(a.firstSeen, summary.endedAt);
      a.buyUsd += w.buyUsd;
      a.sellUsd += w.sellUsd;
      a.realizedPnl += w.realizedPnl;
      a.wins += w.wins;
      a.losses += w.losses;
      a.trades += w.trades;
      const tk = a.tokens[token] ?? { n: 0, pnl: 0 };
      tk.n += 1;
      tk.pnl += w.realizedPnl;
      a.tokens[token] = tk;
      // bound: keep the 50 most-traded tokens per wallet
      if (Object.keys(a.tokens).length > MAX_WALLET_TOKENS) {
        const entries = Object.entries(a.tokens).sort((x, y) => y[1].n - x[1].n).slice(0, MAX_WALLET_TOKENS);
        a.tokens = Object.fromEntries(entries);
      }
      aggs[w.address] = a;
    }
    writeJson(WALLETS_FILE, aggs);

    // 3) session meta line
    const file = this.tokenTape(token);
    if (file) {
      try {
        fs.appendFileSync(file, JSON.stringify({ k: "meta", ...summary }) + "\n");
      } catch {
        /* non-fatal */
      }
    }
  }

  // ── Chain-indexer state (checkpoint + balance map) ────────────────────────

  loadIndexerState(token: string): { cursor: string; balances: [string, string][] } | null {
    if (!isSafeAddress(token)) return null;
    this.init();
    const data = readJson<{ cursor?: string; balances?: Record<string, string> }>(
      path.join(POSITIONS_DIR, `${token.toLowerCase()}.index.json`),
      {},
    );
    if (typeof data.cursor !== "string" || !data.balances) return null;
    return { cursor: data.cursor, balances: Object.entries(data.balances) };
  }

  saveIndexerState(token: string, state: { cursor: string; balances: Map<string, bigint> }): void {
    if (!isSafeAddress(token)) return;
    this.init();
    const obj: Record<string, string> = {};
    let n = 0;
    for (const [addr, bal] of state.balances) {
      if (bal > 0n) {
        obj[addr] = bal.toString();
        if (++n >= 50_000) break; // hard bound
      }
    }
    writeJson(path.join(POSITIONS_DIR, `${token.toLowerCase()}.index.json`), {
      cursor: state.cursor,
      balances: obj,
      savedAt: Date.now(),
    });
  }

  walletLifetime(address: string): WalletAgg | null {
    if (!isSafeAddress(address)) return null;
    const aggs = readJson<Record<string, WalletAgg>>(WALLETS_FILE, {});
    return aggs[address] ?? aggs[address.toLowerCase()] ?? null;
  }

  /** Past session metas for a token (from its tape file). */
  tokenSessions(token: string): SessionSummary[] {
    const file = this.tokenTape(token);
    if (!file) return [];
    try {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      const out: SessionSummary[] = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          const o = JSON.parse(line) as { k?: string; sid?: string; network?: string; endedAt?: number; trades?: number; price?: number; wallets?: number };
          if (o.k === "meta" && o.sid) {
            out.push({ sid: o.sid, network: o.network ?? "", endedAt: o.endedAt ?? 0, trades: o.trades ?? 0, price: o.price ?? 0, wallets: o.wallets ?? 0 });
          }
        } catch {
          /* skip bad line */
        }
      }
      return out.slice(-50);
    } catch {
      return [];
    }
  }
}

export const history = new HistoryStore();
