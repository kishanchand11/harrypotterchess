/**
 * Session registry — shared across all connected clients; capped.
 */
import { AnalyzerSession } from "./session";
import type { Keys } from "./keys";

const MAX_SESSIONS = 12; // headroom for watchlist bg-tracking

const sessions = new Map<string, AnalyzerSession>(); // insertion-ordered

export function sessionKey(address: string, network: string | null): string {
  return `${(network && network !== "auto" ? network : "auto").toLowerCase()}:${address.toLowerCase()}`;
}

export function getSession(sid: string): AnalyzerSession | undefined {
  const s = sessions.get(sid);
  if (s && s.isStopped) {
    sessions.delete(sid);
    return undefined;
  }
  return s;
}

export function getOrCreateSession(opts: {
  address: string;
  network: string | null;
  keys: Keys;
  keepAlive?: boolean;
}): AnalyzerSession {
  const sid = sessionKey(opts.address, opts.network);
  const existing = sessions.get(sid);
  if (existing && !existing.isStopped) {
    // refresh keys (user may have just added them in the UI)
    existing.refreshKeys(opts.keys);
    if (opts.keepAlive) existing.promoteKeepAlive();
    return existing;
  }
  if (sessions.has(sid)) sessions.delete(sid); // recreate a stopped session

  const session = new AnalyzerSession({ ...opts, sid, keepAlive: opts.keepAlive ?? false });
  sessions.set(sid, session);
  void session.start();
  evict();
  return session;
}

function evict(): void {
  if (sessions.size <= MAX_SESSIONS) return;
  // 1) drop stopped sessions first
  for (const [k, s] of sessions) {
    if (sessions.size <= MAX_SESSIONS) return;
    if (s.isStopped) sessions.delete(k);
  }
  // 2) drop idle non-keepAlive sessions (watchlist sessions are protected)
  for (const [k, s] of sessions) {
    if (sessions.size <= MAX_SESSIONS) return;
    if (!s.keepAlive && s.subscriberCount === 0) {
      s.stop();
      sessions.delete(k);
    }
  }
  // 3) last resort: drop the oldest keepAlive session (over-capacity guard)
  for (const [k, s] of sessions) {
    if (sessions.size <= MAX_SESSIONS) return;
    s.stop();
    sessions.delete(k);
  }
}

export function stopSession(sid: string): boolean {
  const s = sessions.get(sid);
  if (!s) return false;
  s.stop();
  sessions.delete(sid);
  return true;
}

export function activeSessions(): AnalyzerSession[] {
  for (const [k, s] of sessions) if (s.isStopped) sessions.delete(k);
  return [...sessions.values()];
}
