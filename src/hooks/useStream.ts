"use client";

import { useEffect } from "react";
import { useDash } from "@/store/dash";

const EVENTS = [
  "snapshot",
  "tick",
  "trades",
  "wallets",
  "signal",
  "flow",
  "holders",
  "sniper",
  "health",
  "stopped",
] as const;

/**
 * SSE subscription with auto-reconnect + session re-creation on 404
 * (e.g. the server restarted while this tab stayed open).
 * Effect is keyed on `sid` only — status changes never tear down a live stream.
 */
export function useStream(): void {
  const sid = useDash((s) => s.sid);

  useEffect(() => {
    if (!sid) return;
    let disposed = false;
    let es: EventSource | null = null;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      es = new EventSource(`/api/stream?sid=${encodeURIComponent(sid)}`);

      for (const evt of EVENTS) {
        es.addEventListener(evt, (e) => {
          try {
            const data = JSON.parse((e as MessageEvent).data);
            if (evt === "snapshot") useDash.getState().applySnapshot(data);
            else useDash.getState().applyEvent(evt, data);
          } catch {
            /* malformed frame ignored */
          }
        });
      }

      es.onopen = () => {
        attempt = 0;
      };

      es.onerror = () => {
        if (disposed) return;
        es?.close();
        es = null;
        attempt++;
        const delay = Math.min(1_000 * attempt, 8_000);
        // Session may have been evicted (server restart) → recreate it once.
        fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: useDash.getState().token?.address,
            network: useDash.getState().graph?.network ?? "auto",
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (disposed) return;
            if (j?.sid && j.sid !== useDash.getState().sid) {
              useDash.setState({ sid: j.sid, status: "reconnecting" }); // re-triggers effect
            } else {
              useDash.setState({ status: "reconnecting" });
              setTimeout(connect, delay);
            }
          })
          .catch(() => {
            if (!disposed) setTimeout(connect, delay);
          });
      };
    };

    connect();
    return () => {
      disposed = true;
      es?.close();
    };
  }, [sid]);
}
