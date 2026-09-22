"use client";

import { useEffect, useState } from "react";
import { EMPTY_KEYS, loadKeys, saveKeys, type ClientKeys } from "@/lib/client-keys";

interface EnvPresence {
  envKeys?: Partial<Record<keyof ClientKeys, boolean>>;
}

const FIELDS: {
  id: keyof ClientKeys;
  label: string;
  placeholder: string;
  help: string;
  unlocks: string;
}[] = [
  {
    id: "etherscan",
    label: "Etherscan V2 API key",
    placeholder: "Paste your Etherscan API key — e.g. J7A4… (free at etherscan.io/apis)",
    help: "One key, all EVM chains. Unlocks wallet-age checks + wallet token-transfer radar on the free tier.",
    unlocks: "Wallet radar (EVM) · wallet age",
  },
  {
    id: "moralis",
    label: "Moralis API key",
    placeholder: "Paste your Moralis Web3 API key — e.g. eyJhb… (free tier at moralis.io)",
    help: "Best radar quality: per-wallet DEX swap history + full on-chain top-holders lists.",
    unlocks: "Wallet radar (best) · full holders list",
  },
  {
    id: "gecko",
    label: "GeckoTerminal API key",
    placeholder: "Paste your GeckoTerminal Demo/Pro key — e.g. cgdemo_… (optional)",
    help: "Raises the free 30 req/min live-trade-tape limit. Leave empty for the free tier.",
    unlocks: "Higher tape rate-limit",
  },
  {
    id: "birdeye",
    label: "Birdeye API key (Solana)",
    placeholder: "Paste your Birdeye key — e.g. 88a2… (birdeye.so) — reserved for Solana radar",
    help: "Reserved for Solana wallet radar expansion. Not required for EVM analysis.",
    unlocks: "Solana radar (roadmap)",
  },
];

export default function KeysModal({ open, onClose, onApplied }: { open: boolean; onClose: () => void; onApplied: () => void }) {
  const [keys, setKeys] = useState<ClientKeys>(EMPTY_KEYS);
  const [env, setEnv] = useState<EnvPresence>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setKeys(loadKeys());
      setSaved(false);
      fetch("/api/config")
        .then((r) => r.json())
        .then(setEnv)
        .catch(() => {});
    }
  }, [open]);

  if (!open) return null;

  const apply = () => {
    saveKeys(keys);
    setSaved(true);
    onApplied();
    setTimeout(onClose, 450);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative panel glow w-full max-w-lg max-h-[88vh] overflow-y-auto p-6 slide-in">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-semibold">Bring your own keys</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <p className="text-xs text-muted mb-5">
          Keys are stored <span className="text-info">only in your browser</span> (localStorage) and sent with your
          session request. For server-wide keys, copy <code className="text-acc">.env.example</code> →{" "}
          <code className="text-acc">.env.local</code>.
        </p>

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
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={apply}
            className="rounded-lg bg-smart/90 hover:bg-smart text-[#14002b] font-semibold px-5 py-2 text-sm transition-colors"
          >
            {saved ? "✓ Applied" : "Save & apply"}
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
