import { NextRequest } from "next/server";
import { getSession } from "@/engine/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/stream?sid=... — Server-Sent Events live feed.
 * Events: snapshot, tick, trades, wallets, signal, flow, holders, sniper, health, stopped
 */
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid") ?? "";
  const session = getSession(sid);
  if (!session) {
    return new Response(JSON.stringify({ error: "session not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };

      // initial full state
      send("snapshot", session.snapshot());

      unsub = session.subscribe(({ type, data }) => {
        if (type === "stopped") {
          send("stopped", {});
          open = false;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        send(type, data);
      });

      heartbeat = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          open = false;
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        open = false;
        unsub?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* noop */
        }
      });
    },
    cancel() {
      unsub?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
