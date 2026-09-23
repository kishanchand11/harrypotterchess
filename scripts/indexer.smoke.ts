/**
 * Indexer invariant smoke test — runs the REAL code (no RPC):
 *   node --experimental-strip-types scripts/indexer.smoke.ts
 */
import { decodeTransferLog, classifyTransfer, TokenIndexer, TRANSFER_TOPIC } from "../src/engine/indexer";

let fails = 0;
const ok = (cond: boolean, name: string) => {
  console.log((cond ? "  ✅ " : "  ❌ ") + name);
  if (!cond) fails++;
};

// ── decoder ─────────────────────────────────────────────────────────────────
const A = "0x" + "aa".repeat(20);
const B = "0x" + "bb".repeat(20);
const P1 = "0x" + "11".repeat(20);
const log = {
  blockNumber: "0x100",
  transactionHash: "0xabc",
  logIndex: "0x5",
  topics: [TRANSFER_TOPIC, "0x" + "0".repeat(24) + P1.slice(2), "0x" + "0".repeat(24) + B.slice(2)],
  data: "0x" + (10n * 10n ** 18n).toString(16), // 10 tokens
};
const dec = decodeTransferLog(log.topics, log.data);
ok(dec !== null && dec.from === P1 && dec.to === B && dec.qtyRaw === 10n * 10n ** 18n, "decode: addresses unpadded + qty exact");
ok(decodeTransferLog(["0xdeadbeef", log.topics[1], log.topics[2]], log.data) === null, "decode: wrong topic rejected");
ok(decodeTransferLog([TRANSFER_TOPIC, "0x123"], "0x") === null, "decode: short topics rejected");

// ── classifier ──────────────────────────────────────────────────────────────
const pools = new Set([P1]);
ok(classifyTransfer(P1, B, pools) === "buy", "classify: pool→wallet = BUY");
ok(classifyTransfer(A, P1, pools) === "sell", "classify: wallet→pool = SELL");
ok(classifyTransfer(A, B, pools) === "transfer", "classify: wallet↔wallet = TRANSFER");
ok(classifyTransfer(P1, P1, pools) === "transfer", "classify: pool↔pool = TRANSFER (arb)");

// ── balance machine + trade emission through the real TokenIndexer ──────────
const idx = new TokenIndexer({
  token: "0x" + "cc".repeat(20),
  endpoints: ["http://localhost:1"], // never called in this test
  pools: new Map([[P1, "TOKEN / WETH"]]),
  liveSince: 1_000, // blocks with ts >= 1000 emit trades
});
idx.decimals = 18;
const t1 = idx.processLogs([log], 2_000, 0.5);
ok(idx.balances.get(B) === 10n * 10n ** 18n, "balances: receiver credited (10 tokens)");
ok(t1.length === 1 && t1[0].side === "buy" && t1[0].wallet === B && t1[0].qty === 10 && t1[0].usd === 5, "live block → buy trade emitted w/ USD (10 × 0.5)");
ok(t1[0].id === "chain-0xabc-0x5", "trade id uses txHash+logIndex (dedupe-safe)");

// sell back into pool
const sellLog = { ...log, logIndex: "0x6", topics: [TRANSFER_TOPIC, "0x" + "0".repeat(24) + B.slice(2), "0x" + "0".repeat(24) + P1.slice(2)], data: "0x" + (4n * 10n ** 18n).toString(16) };
const t2 = idx.processLogs([sellLog], 2_100, 0.6);
ok(idx.balances.get(B) === 6n * 10n ** 18n, "balances: debit exact (no drift)");
ok(t2.length === 1 && t2[0].side === "sell" && t2[0].pool === P1, "sell trade credited to seller");

// historical block: balances move, NO trade (backfill honesty)
const histLog = { ...log, logIndex: "0x7", topics: [TRANSFER_TOPIC, "0x" + "0".repeat(24) + P1.slice(2), "0x" + "0".repeat(24) + ("0x" + "dd".repeat(20)).slice(2)], data: "0x" + (10n ** 18n).toString(16) };
const t3 = idx.processLogs([histLog], 500, 0.4); // ts < liveSince
ok(t3.length === 0 && idx.balances.get("0x" + "dd".repeat(20)) === 10n ** 18n, "backfill: balance updated, zero fabricated trades");

// wallet↔wallet transfer: balance moves, no flow
const xferLog = { ...sellLog, logIndex: "0x8", topics: [TRANSFER_TOPIC, "0x" + "0".repeat(24) + B.slice(2), "0x" + "0".repeat(24) + A.slice(2)], data: "0x" + (2n * 10n ** 18n).toString(16) };
const t4 = idx.processLogs([xferLog], 2_200, 0.7);
ok(t4.length === 0 && idx.balances.get(A) === 2n * 10n ** 18n && idx.balances.get(B) === 4n * 10n ** 18n, "transfer: balances move, zero flow counted");

// holders ordering + supply share
idx.totalSupplyRaw = 50n * 10n ** 18n;
const holders = idx.holders(10);
ok(holders[0].address === B && holders[0].sharePct === 8, "holders: sorted desc, share% exact (4/50)");

// serialize round-trip
const snap = idx.serializeState();
ok(snap.cursor.startsWith("0x") && snap.balances.get(B) === 4n * 10n ** 18n, "checkpoint serialize: cursor + balances intact");

console.log(fails === 0 ? "\n✅ ALL INDEXER INVARIANTS PASS" : `\n❌ ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
