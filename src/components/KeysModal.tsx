"use client";

import { useEffect, useState } from "react";
import { EMPTY_KEYS, keysHeaders, loadKeys, saveKeys, type ClientKeys } from "@/lib/client-keys";

interface EnvPresence {
  envKeys?: Partial<Record<keyof ClientKeys, boolean>>;
}
interface NetProbe {
  id: string;
  label: string;
  reachable: boolean;
  latencyMs: number;
}
interface NetInfo {
  probes: NetProbe[];
  allCryptoBlocked: boolean;
}
type TestState = "ok" | "invalid" | "blocked";
interface TestResult {
  state: TestState;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

const FIELDS: {
  id: keyof ClientKeys;
  testable: boolean;
  label: string;
  placeholder: string;
  help: string;
  unlocks: string;
}[] = [
  {
    id: "alchemy",
    testable: true,
    label: "Alchemy API key",
    placeholder: "Paste your Alchemy key — e.g. kW9f… or the full https://eth-mainnet.g.alchemy.com/v2/… URL",
    help: "Free tier: 300M compute units/mo. Powers wallet transfer radar (all EVM chains), on-chain balance cross-checks and token metadata. Highest-value single key for this terminal.",
    unlocks: "Wallet radar (EVM) · on-chain balances · token metadata",
  },
  {
    id: "etherscan",
    testable: true,
    label: "Etherscan V2 API key",
    placeholder: "Paste your Etherscan API key — e.g. J7A4… (free at etherscan.io/apis)",
    help: "One key, all EVM chains. Unlocks wallet-age checks + wallet token-transfer radar on the free tier. Note: their top-holders endpoint is PRO-only — use Moralis/Alchemy for holder lists.",
    unlocks: "Wallet age · wallet radar (EVM)",
  },
  {
    id: "moralis",
    testable: true,
    label: "Moralis API key",
    placeholder: "Paste your Moralis Web3 API key — e.g. eyJhb… (free tier at moralis.io)",
    help: "Best radar quality: per-wallet DEX swap history with USD values + full on-chain top-holders lists.",
    unlocks: "Wallet radar (best) · full holders list",
  },
  {
    id: "gecko",
    testable: false,
    label: "GeckoTerminal API key (optional)",
    placeholder: "Paste your GeckoTerminal Demo/Pro key — e.g. cgdemo_… (optional)",
    help: "Raises the free 30 req/min live-trade-tape limit. Leave empty for the free tier.",
    unlocks: "Higher tape rate-limit",
  },
  {
    id: "birdeye",
    testable: false,
    label: "Birdeye API key (Solana)",
    placeholder: "Paste your Birdeye key — e.g. 88a2… (birdeye.so) — reserved for Solana radar",
    help: "Reserved for Solana wallet radar expansion. Not required for EVM analysis.",
    unlocks: "Solana radar (roadmap)",
  },
  {
    id: "discordWebhook",
    testable: false,
    label: "Discord webhook URL (alerts)",
    placeholder: "https://discord.com/api/webhooks/… — signals get pushed to your channel",
    help: "Server-side alerts: watchlisted tokens push signals here even with the browser closed. HTTPS-only, private hosts blocked. Env: DISCORD_WEBHOOK_URL.",
    unlocks: "Discord alerts",
  },
  {
    id: "telegramToken",
    testable: false,
    label: "Telegram bot token (alerts)",
    placeholder: "123456:ABC-DEF… from @BotFather — pair with the chat id below",
    help: "Server-side alerts via Telegram. Also set the chat id field. Env: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.",
    unlocks: "Telegram alerts",
  },
  {
    id: "telegramChat",
    testable: false,
    label: "Telegram chat id (alerts)",
    placeholder: "e.g. -1001234567890 (from @userinbot / getUpdates)",
    help: "Chat/channel id that receives the Telegram alerts.",
    unlocks: "Telegram alerts",
  },
];

export default function KeysModal({
  open,
  onClose,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [keys, setKeys] = useState<ClientKeys>(EMPTY_KEYS);
  const [env, setEnv] = useState<EnvPresence>({});
  const [net, setNet] = useState<NetInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<Partial<Record<keyof ClientKeys, TestResult>>>({});

  useEffect(() => {
    if (open) {
      setKeys(loadKeys());
      setSaved(false);
      setResults({});
      fetch("/api/config")
        .then((r) => r.json())
        .then(setEnv)
        .catch(() => {});
      setNet(null);
      fetch("/api/net")
        .then((r) => r.json())
        .then(setNet)
        .catch(() => setNet({ probes: [], allCryptoBlocked: false }));
    }
  }, [open]);

  if (!open) return null;

  const apply = () => {
    saveKeys(keys);
    setSaved(true);
    onApplied();
    setTimeout(onClose, 450);
  };

  const testAll = async () => {
    saveKeys(keys);
    setTesting(true);
    setResults({});
    const testable = FIELDS.filter((f) => f.testable && keys[f.id].trim().length > 6);
    for (const f of testable) {
      try {
        const r = await fetch("/api/keys/test", {
          method: "POST",
          headers: { "content-type": "application/json", ...keysHeaders(keys) },
          body: JSON.stringify({ provider: f.id }),
        });
        const j = (await r.json()) as TestResult & { error?: string };
        setResults((prev) => ({
          ...prev,
          [f.id]: j.error ? { state: "invalid", ok: false, latencyMs: 0, detail: j.error } : j,
        }));
      } catch {
        setResults((prev) => ({
          ...prev,
          [f.id]: { state: "blocked", ok: false, latencyMs: 0, detail: "could not reach test endpoint" },
        }));
      }
    }
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative panel glow w-full max-w-xl max-h-[88vh] overflow-y-auto p-6 slide-in">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-semibold">Bring your own keys</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <p className="text-xs text-muted mb-4">
          Keys are stored <span className="text-info">only in your browser</span> (localStorage) and sent with your
          session request. For server-wide keys, copy <code className="text-acc">.env.example</code> →{" "}
          <code className="text-acc">.env.local</code>.
        </p>

        {/* Server network pre-flight */}
        <div className="rounded-lg border border-edge bg-panel2 p-3 mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="panel-title">Server network pre-flight</span>
            {net && (
              <span className={`text-[10px] num ${net.allCryptoBlocked ? "text-warn" : "text-buy"}`}>
                {net.allCryptoBlocked ? "crypto endpoints blocked on this host" : "all systems reachable"}
              </span>
            )}
          </div>
          {!net ? (
            <div className="text-[10px] text-muted">probing provider endpoints…</div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {net.probes.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-[10px] num">
                  <span className="text-muted">{p.label}</span>
                  <span className={p.reachable ? "text-buy" : "text-sell"}>
                    {p.reachable ? `✓ ${p.latencyMs}ms` : "✗ blocked"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {net?.allCryptoBlocked && (
            <p className="text-[10px] text-warn leading-relaxed mt-2 border-t border-edge pt-2">
              ⚠ This host&apos;s firewall blocks all crypto-data endpoints, so <span className="text-ink">no key can
              validate here</span> — it is not a problem with your keys. They are saved and will activate automatically
              when the terminal runs on an unrestricted host (see README: run locally or one-click deploy to Vercel).
            </p>
          )}
        </div>

        <div className="space-y-4">
          {FIELDS.map((f) => (
            <div key={f.id}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium">{f.label}</label>
                <div className="flex gap-1">
                  {env.envKeys?.[f.id] && (
                    <span className="text-[9px] rounded px-1.5 py-0.5 bg-buy/10 text-buy border border-buy/25">
                      server key active
                    </span>
                  )}
                  <span className="text-[9px] rounded px-1.5 py-0.5 bg-panel2 text-muted border border-edge">
                    {f.unlocks}
                  </span>
                </div>
              </div>
              <input
                type="password"
                autoComplete="off"
                value={keys[f.id]}
                onChange={(e) => setKeys((k) => ({ ...k, [f.id]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full rounded-lg bg-panel2 border border-edge px-3 py-2 text-xs outline-none focus:border-smart/50 placeholder:text-muted/50"
              />
              <p className="text-[10px] text-muted mt-1">{f.help}</p>
              {results[f.id] && (
                <div
                  className={`mt-1.5 rounded border px-2 py-1 text-[10px] num leading-relaxed ${
                    results[f.id]!.state === "ok"
                      ? "border-buy/40 bg-buy/10 text-buy"
                      : results[f.id]!.state === "blocked"
                        ? "border-warn/40 bg-warn/10 text-warn"
                        : "border-sell/40 bg-sell/10 text-sell"
                  }`}
                >
                  {results[f.id]!.state === "ok" && `✓ valid · ${results[f.id]!.latencyMs}ms — ${results[f.id]!.detail}`}
                  {results[f.id]!.state === "blocked" &&
                    `⚠ blocked on this host (not a key problem) · ${results[f.id]!.latencyMs}ms — ${results[f.id]!.detail}`}
                  {results[f.id]!.state === "invalid" && `✕ invalid key · ${results[f.id]!.latencyMs}ms — ${results[f.id]!.detail}`}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={apply}
            className="rounded-lg bg-smart/90 hover:bg-smart text-[#14002b] font-semibold px-5 py-2 text-sm transition-colors"
          >
            {saved ? "✓ Applied" : "Save & apply"}
          </button>
          <button
            onClick={testAll}
            disabled={testing}
            className="rounded-lg border border-info/40 bg-info/10 hover:bg-info/20 disabled:opacity-40 text-info px-4 py-2 text-sm transition-colors"
          >
            {testing ? "Testing…" : "Test keys"}
          </button>
          <button onClick={onClose} className="text-xs text-muted hover:text-ink">
            Cancel
          </button>
          <span className="ml-auto text-[10px] text-muted">Stored locally · never logged</span>
        </div>
      </div>
    </div>
  );
}
