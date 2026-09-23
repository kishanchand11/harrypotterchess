/**
 * TokenIndexer — a single-token, single-chain "Moralis-lite" built on raw logs.
 *
 * Idea: we already know the token's pool addresses from the pair graph, so a
 * plain Transfer-log filter classifies swaps for free:
 *     from ∈ pools → BUY   (pool → wallet)
 *     to   ∈ pools → SELL  (wallet → pool)
 *     neither/both → TRANSFER (wallet↔wallet or arb; kept for forensics only)
 *
 * • Keyless-first: public RPCs by default, Alchemy endpoint prepended if a key exists
 * • Backfills from pool creation (capped by INDEXER_MAX_BACKFILL_DAYS), checkpointed to disk,
 *   resumes across restarts
 * • Balance map → REAL top-holders + cross-session old-holder detection
 * • No new dependencies: fetch + BigInt + a hand-rolled Transfer decoder
 *
 * The indexer is PASSIVE — the session drives it on a timer and ingests trades
 * through the normal path. Backfilled (historical) events update balances but
 * are never emitted as trades, so analytics/signals stay real-time honest.
 */
import type { HolderRow, Trade } from "./types";
import { history } from "./history";
import { sleep } from "./infra";

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DECIMALS_SELECTOR = "0x313ce567"; // decimals()
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd"; // totalSupply()
const BALANCE_OF_SELECTOR = "0x70a08231"; // balanceOf(address)

export function hexToBigInt(hex: string): bigint {
  try {
    if (!hex || hex === "0x") return 0n;
    return BigInt(hex);
  } catch {
    return 0n;
  }
}

/** topics[i] are 32-byte left-padded; an address lives in the last 20 bytes. */
export function padToAddress(topic: string): string {
  if (typeof topic !== "string" || topic.length < 40) return "";
  return ("0x" + topic.slice(-40)).toLowerCase();
}

export interface DecodedTransfer {
  from: string;
  to: string;
  qtyRaw: bigint;
}

/** Strict ERC-20 Transfer decoder — returns null for anything non-standard. */
export function decodeTransferLog(topics: string[], data: string): DecodedTransfer | null {
  if (!Array.isArray(topics) || topics.length < 3) return null;
  if ((topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) return null;
  const from = padToAddress(topics[1]);
  const to = padToAddress(topics[2]);
  if (from.length !== 42 || to.length !== 42) return null;
  return { from, to, qtyRaw: hexToBigInt(data) };
}

export type XferKind = "buy" | "sell" | "transfer";

/** Pool-membership swap classifier (see header). */
export function classifyTransfer(from: string, to: string, pools: Set<string>): XferKind {
  const f = pools.has(from);
  const t = pools.has(to);
  if (f && !t) return "buy";
  if (t && !f) return "sell";
  return "transfer"; // wallet↔wallet or pool↔pool (arb) — never user flow
}

interface RpcLog {
  blockNumber: string;
  transactionHash: string;
  logIndex?: string;
  blockTimestamp?: string;
  topics: string[];
  data: string;
}

export type IndexerPhase = "boot" | "backfilling" | "live" | "error";

export interface PollResult {
  trades: Trade[];
  events: number;
  backfillCompleted: boolean;
}

export class TokenIndexer {
  readonly token: string;
  private endpoints: string[];
  private endpointIdx = 0;
  private pools = new Map<string, string>(); // pool address → label
  private poolSet = new Set<string>();
  decimals = 18;
  totalSupplyRaw = 0n;
  cursor = 0n; // last processed block
  head = 0n;
  balances = new Map<string, bigint>();
  phase: IndexerPhase = "boot";
  detail = "initializing";
  events = 0;
  errors = 0;
  buys = 0;
  sells = 0;
  transfers = 0;
  lastPollAt: number | null = null;
  liveSince: number;
  private chunkSize = 2_000n;
  private readonly minChunk = 50n;
  private readonly maxChunk = 5_000n;
  private readonly maxBackfillDays: number;
  private lastError: string | null = null;

  constructor(opts: { token: string; endpoints: string[]; pools: Map<string, string>; maxBackfillDays?: number; liveSince?: number }) {
    this.token = opts.token.toLowerCase();
    this.endpoints = opts.endpoints.filter(Boolean);
    this.pools = opts.pools;
    this.poolSet = new Set([...opts.pools.keys()]);
    this.maxBackfillDays = opts.maxBackfillDays ?? 14;
    this.liveSince = opts.liveSince ?? Date.now();
  }

  setPools(pools: Map<string, string>): void {
    this.pools = pools;
    this.poolSet = new Set([...pools.keys()]);
  }

  private get endpoint(): string {
    return this.endpoints[this.endpointIdx % this.endpoints.length];
  }

  private rotateEndpoint(): boolean {
    if (this.endpoints.length <= 1) return false;
    this.endpointIdx = (this.endpointIdx + 1) % this.endpoints.length;
    return true;
  }

  private async rpc<T>(method: string, params: unknown[], timeoutMs = 12_000): Promise<T> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < Math.min(this.endpoints.length, 3); attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          signal: ctrl.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          cache: "no-store",
        });
        const j = (await res.json()) as { result?: T; error?: { message: string } };
        if (j.error) throw new Error(j.error.message || `rpc error ${method}`);
        this.phase = this.phase === "boot" ? "boot" : this.phase; // health set by caller
        return j.result as T;
      } catch (e) {
        lastErr = e;
        this.rotateEndpoint();
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`rpc failed: ${method}`);
  }

  private async ethCall(to: string, data: string): Promise<string> {
    return this.rpc<string>("eth_call", [{ to, data }, "latest"]);
  }

  private async blockTimestamp(block: bigint): Promise<number> {
    const b = await this.rpc<{ timestamp: string } | null>("eth_getBlockByNumber", ["0x" + block.toString(16), false]);
    return b?.timestamp ? Number(hexToBigInt(b.timestamp)) * 1000 : Date.now();
  }

  /** Binary-search the block whose timestamp ≈ targetTs. ~20 calls, cached by caller discipline. */
  private async findBlockAtTimestamp(targetTs: number): Promise<bigint> {
    let lo = 1n;
    let hi = this.head;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const ts = await this.blockTimestamp(mid);
      if (ts < targetTs) lo = mid + 1n;
      else hi = mid;
      await sleep(50); // gentle on public RPCs
    }
    return lo;
  }

  /** Boot: decimals, supply, head, cursor (checkpoint → backfill anchor). */
  async init(): Promise<boolean> {
    try {
      const [decRaw, supRaw, headRaw] = await Promise.all([
        this.ethCall(this.token, DECIMALS_SELECTOR).catch(() => null),
        this.ethCall(this.token, TOTAL_SUPPLY_SELECTOR).catch(() => null),
        this.rpc<string>("eth_blockNumber", []),
      ]);
      if (decRaw && decRaw !== "0x") this.decimals = Number(hexToBigInt(decRaw));
      if (supRaw) this.totalSupplyRaw = hexToBigInt(supRaw);
      this.head = hexToBigInt(headRaw);
      if (this.head <= 0n) throw new Error("bad head block");

      // resume from checkpoint?
      const saved = history.loadIndexerState(this.token);
      if (saved && saved.balances.length > 0) {
        this.cursor = hexToBigInt(saved.cursor) || 0n;
        for (const [addr, bal] of saved.balances) {
          const v = BigInt(bal);
          if (v > 0n) this.balances.set(addr.toLowerCase(), v);
        }
        this.phase = "backfilling";
        this.detail = `resumed at block ${this.cursor} (${this.balances.size} wallets restored)`;
        return true;
      }

      // backfill anchor: pool creation (pair graph), capped by max age
      const maxAgeMs = this.maxBackfillDays * 86_400_000;
      const targetTs = Math.max(this.anchorTs ?? 0, Date.now() - maxAgeMs);
      this.cursor = (await this.findBlockAtTimestamp(targetTs)) - 1n;
      if (this.cursor < 0n) this.cursor = 0n;
      this.phase = "backfilling";
      this.detail = `backfilling from block ${this.cursor}`;
      return true;
    } catch (e) {
      this.phase = "error";
      this.lastError = e instanceof Error ? e.message : String(e);
      this.detail = `init failed: ${this.lastError}`;
      return false;
    }
  }

  /** Pool-creation timestamp hint for the backfill anchor (from the pair graph). */
  anchorTs: number | null = null;

  /** Public for tests: process a raw log batch (single block timestamp applies). */
  processLogs(logs: RpcLog[], tsMs: number, priceUsd: number): Trade[] {
    const pendingXfer: { from: string; to: string; qty: number; ts: number; tx: string }[] = [];
    const trades: Trade[] = [];
    for (const log of logs) {
      const dec = decodeTransferLog(log.topics ?? [], log.data ?? "0x");
      if (!dec || dec.qtyRaw <= 0n) continue;
      const qty = Number(dec.qtyRaw) / 10 ** this.decimals;
      if (!Number.isFinite(qty) || qty <= 0) continue;

      // balances track EVERYTHING (transfers included) — that's what makes holders real
      const prevFrom = this.balances.get(dec.from) ?? 0n;
      const prevTo = this.balances.get(dec.to) ?? 0n;
      this.balances.set(dec.from, prevFrom >= dec.qtyRaw ? prevFrom - dec.qtyRaw : 0n);
      this.balances.set(dec.to, prevTo + dec.qtyRaw);
      this.events++;

      const kind = classifyTransfer(dec.from, dec.to, this.poolSet);
      if (kind === "transfer") {
        this.transfers++;
        // bounded forensic record of wallet↔wallet movements (wash-trade evidence)
        if (pendingXfer.length < 100 && tsMs >= this.liveSince) {
          pendingXfer.push({ from: dec.from, to: dec.to, qty, ts: tsMs, tx: log.transactionHash });
        }
        continue; // never flow
      }
      if (kind === "buy") this.buys++;
      else this.sells++;

      const pool = kind === "buy" ? dec.from : dec.to;
      const wallet = kind === "buy" ? dec.to : dec.from;
      // historical blocks only move balances; live blocks also become trades
      if (tsMs >= this.liveSince && priceUsd > 0) {
        trades.push({
          id: `chain-${log.transactionHash}-${log.logIndex ?? "0"}`,
          ts: tsMs,
          wallet,
          txHash: log.transactionHash,
          side: kind,
          priceUsd,
          qty,
          usd: qty * priceUsd,
          pool,
          poolLabel: this.pools.get(pool) ?? "pool",
          dex: "chain-index",
          quoteSymbol: "",
          source: "chain",
        });
      }
    }
    if (pendingXfer.length > 0) history.recordTransfers(this.token, pendingXfer);
    return trades;
  }

  /** Advance the index toward head (bounded work per tick). */
  async poll(priceUsd: number): Promise<PollResult> {
    this.lastPollAt = Date.now();
    if (this.phase === "error" || this.endpoints.length === 0) return { trades: [], events: 0, backfillCompleted: false };
    let trades: Trade[] = [];
    let backfillCompleted = false;
    try {
      this.head = hexToBigInt(await this.rpc<string>("eth_blockNumber", []));
      let chunks = 0;
      const maxChunks = 4; // bound per-tick work/latency
      while (chunks < maxChunks && this.cursor < this.head) {
        const end = this.cursor + this.chunkSize > this.head ? this.head : this.cursor + this.chunkSize;
        let logs: RpcLog[];
        try {
          logs = await this.rpc<RpcLog[]>("eth_getLogs", [
            {
              fromBlock: "0x" + (this.cursor + 1n).toString(16),
              toBlock: "0x" + end.toString(16),
              address: this.token,
              topics: [TRANSFER_TOPIC],
            },
          ]);
        } catch (e) {
          // range too big for this provider → shrink and retry next tick
          this.chunkSize = this.chunkSize > this.minChunk ? this.chunkSize / 2n : this.minChunk;
          this.lastError = e instanceof Error ? e.message : String(e);
          this.errors++;
          break;
        }
        const ts = logs[0]?.blockTimestamp
          ? Number(hexToBigInt(logs[0].blockTimestamp)) * 1000
          : await this.blockTimestamp(end);
        trades = trades.concat(this.processLogs(logs, ts, priceUsd));
        this.cursor = end;
        chunks++;
        if (this.chunkSize < this.maxChunk) this.chunkSize = this.chunkSize * 3n / 2n;
      }
      const wasBackfilling = this.phase === "backfilling";
      if (this.cursor >= this.head) {
        this.phase = "live";
        if (wasBackfilling) backfillCompleted = true;
      } else if (this.phase === "backfilling") {
        const pct = this.head > 0n ? Number(((this.cursor * 100n) / this.head)) : 0;
        this.detail = `backfill ${pct}% (block ${this.cursor}/${this.head})`;
      }
      if (this.phase === "live") this.detail = `live at block ${this.cursor} · ${this.balances.size} wallets`;
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.detail = `poll failed: ${this.lastError}`;
      this.errors++;
      if (this.phase !== "backfilling") this.phase = "error";
    }
    return { trades, events: this.events, backfillCompleted };
  }

  /** Correct drift on the biggest wallets with real balanceOf calls (top N). */
  async reconcile(topN = 5): Promise<void> {
    const top = [...this.balances.entries()]
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
      .slice(0, topN);
    for (const [addr] of top) {
      try {
        const data = BALANCE_OF_SELECTOR + "0".repeat(24) + addr.replace(/^0x/, "");
        const raw = await this.ethCall(this.token, data);
        this.balances.set(addr, hexToBigInt(raw));
      } catch {
        /* keep index value */
      }
    }
  }

  /** Real on-chain top holders from the balance map. */
  holders(limit = 100): HolderRow[] {
    const rows: HolderRow[] = [];
    const entries = [...this.balances.entries()].filter(([, b]) => b > 0n);
    entries.sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
    let rank = 1;
    for (const [addr, bal] of entries) {
      rows.push({
        rank: rank++,
        address: addr,
        balance: Number(bal) / 10 ** this.decimals,
        sharePct: this.totalSupplyRaw > 0n ? Number((bal * 10_000n) / this.totalSupplyRaw) / 100 : -1,
        isContract: false,
        source: "chain",
      });
      if (rows.length >= limit) break;
    }
    return rows;
  }

  serializeState(): { cursor: string; balances: Map<string, bigint> } {
    return { cursor: "0x" + this.cursor.toString(16), balances: this.balances };
  }

  statusLine(): string {
    return this.detail + (this.lastError ? ` (last error: ${this.lastError})` : "");
  }
}
