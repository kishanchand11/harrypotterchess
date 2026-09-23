/**
 * AlertDispatcher — pushes engine signals out of process (Discord / Telegram /
 * generic JSON webhook). Config is BYO: env vars or per-session keys.
 *
 * Safety: HTTPS-only webhooks, private/loopback hosts rejected (SSRF guard),
 * per-kind cooldown so a bursty signal can't spam the channel.
 */
import type { Keys } from "./keys";
import type { Signal } from "./types";

export interface AlertConfig {
  discord?: string;
  telegramToken?: string;
  telegramChat?: string;
  minSeverity: "info" | "warn" | "critical";
}

const SEV_RANK: Record<Signal["severity"], number> = { info: 0, warn: 1, critical: 2 };

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "[::1]" || h.endsWith(".local")) return true;
  if (/^169\.254\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/** SSRF guard: https only, no loopback/private targets. */
export function assertSafeWebhook(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("invalid webhook URL");
  }
  if (u.protocol !== "https:") throw new Error("webhook must be https");
  if (isPrivateHost(u.hostname)) throw new Error("webhook host is private/loopback — blocked");
}

export function alertConfigFromKeys(k: Keys): Omit<AlertConfig, "minSeverity"> {
  return {
    discord: k.discordWebhook,
    telegramToken: k.telegramToken,
    telegramChat: k.telegramChat,
  };
}

export function alertConfigFromEnv(): AlertConfig {
  return {
    discord: process.env.DISCORD_WEBHOOK_URL || undefined,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChat: process.env.TELEGRAM_CHAT_ID || undefined,
    minSeverity: (process.env.ALERT_MIN_SEVERITY as AlertConfig["minSeverity"]) || "info",
  };
}

const COOLDOWN_MS = 60_000;
const MAX_TEXT = 1_800;

class AlertDispatcher {
  private cooldown = new Map<string, number>();

  async dispatch(
    sid: string,
    tokenSymbol: string,
    sig: Signal,
    cfg: AlertConfig,
  ): Promise<{ sent: string[]; skipped: string }> {
    if (SEV_RANK[sig.severity] < SEV_RANK[cfg.minSeverity]) return { sent: [], skipped: "below severity" };
    const key = `${sid}:${sig.kind}:${sig.title.slice(0, 40)}`;
    const now = Date.now();
    const last = this.cooldown.get(key) ?? 0;
    if (now - last < COOLDOWN_MS) return { sent: [], skipped: "cooldown" };
    this.cooldown.set(key, now);
    if (this.cooldown.size > 500) {
      for (const [k, t] of this.cooldown) if (now - t > 600_000) this.cooldown.delete(k);
    }

    const text = `${tokenSymbol} [${sig.severity.toUpperCase()}] ${sig.title}\n${sig.detail}`.slice(0, MAX_TEXT);
    const sent: string[] = [];

    if (cfg.discord) {
      try {
        assertSafeWebhook(cfg.discord);
        const res = await fetch(cfg.discord, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "```\n" + text + "\n```" }),
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) sent.push("discord");
      } catch {
        /* non-fatal */
      }
    }
    if (cfg.telegramToken && cfg.telegramChat) {
      try {
        const url = `https://api.telegram.org/bot${encodeURIComponent(cfg.telegramToken)}/sendMessage`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: cfg.telegramChat, text }),
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) sent.push("telegram");
      } catch {
        /* non-fatal */
      }
    }
    return { sent, skipped: sent.length ? "" : "no channel configured or delivery failed" };
  }

  /** Validate alert config without sending a message. */
  validate(cfg: AlertConfig): { ok: boolean; detail: string } {
    const parts: string[] = [];
    if (cfg.discord) {
      try {
        assertSafeWebhook(cfg.discord);
        parts.push("discord URL valid");
      } catch (e) {
        return { ok: false, detail: `discord: ${e instanceof Error ? e.message : "invalid"}` };
      }
    }
    if (cfg.telegramToken && cfg.telegramChat) parts.push("telegram configured");
    if (parts.length === 0) return { ok: false, detail: "no alert channel configured" };
    return { ok: true, detail: parts.join("; ") };
  }
}

export const dispatcher = new AlertDispatcher();
