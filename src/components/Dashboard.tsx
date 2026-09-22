"use client";

import { useState } from "react";
import { useDash } from "@/store/dash";
import SearchPanel from "./SearchPanel";
import StatsHeader from "./StatsHeader";
import PriceChart from "./PriceChart";
import PairGraphView from "./PairGraphView";
import TradesFeed from "./TradesFeed";
import WalletsTable from "./WalletsTable";
import SignalsFeed from "./SignalsFeed";
import FlowPanel from "./FlowPanel";
import HoldersPanel from "./HoldersPanel";
import SniperRadar from "./SniperRadar";
import KeysModal from "./KeysModal";

export default function Dashboard() {
  const token = useDash((s) => s.token);
  const mode = useDash((s) => s.mode);
  const simReason = useDash((s) => s.simReason);
  const [keysOpen, setKeysOpen] = useState(false);

  return (
    <main className="max-w-[1500px] mx-auto px-4 py-4 space-y-3">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-smart to-info flex items-center justify-center text-lg">
            🧠
          </div>
          <div>
            <h1 className="font-bold leading-tight tracking-tight">
              SmartMoney <span className="text-smart">Terminal</span>
            </h1>
            <p className="text-[10px] text-muted leading-tight">
              DeFi pair intelligence · pump/dump attribution · sniper radar
            </p>
          </div>
        </div>
        <div className="flex-1" />
        <SearchPanel compact />
        <button
          onClick={() => setKeysOpen(true)}
          className="rounded-lg border border-edge bg-panel2 hover:border-smart/50 px-3 py-2.5 text-sm transition-colors whitespace-nowrap"
          title="Bring your own API keys"
        >
          ⚙ Keys
        </button>
      </header>

      {!token && <Hero />}

      {token && (
        <>
          {mode === "simulated" && simReason && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-2 text-[11px] text-warn leading-relaxed">
              <span className="font-semibold">◌ Simulated feed active.</span> {simReason}
            </div>
          )}
          <StatsHeader />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 panel p-2 min-h-[300px]">
              <PriceChart />
            </div>
            <div className="min-h-[300px]">
              <SignalsFeed />
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="xl:col-span-2 min-h-[360px]">
              <WalletsTable />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3">
              <FlowPanel />
              <div className="panel p-4 min-h-[240px]">
                <div className="panel-title mb-2">Pair graph</div>
                <PairGraphView />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <HoldersPanel />
            <SniperRadar />
          </div>

          <TradesFeed />

          <footer className="text-[10px] text-muted pt-2 pb-6 leading-relaxed">
            Data: DexScreener + GeckoTerminal (keyless) · wallet intel: BYO Etherscan/Moralis keys · SSE live stream,
            sub-second trade fan-out. Analytics are derived from observed DEX trades; not financial advice.
          </footer>
        </>
      )}

      <KeysModal open={keysOpen} onClose={() => setKeysOpen(false)} onApplied={() => {
        // re-create session so new keys take effect immediately
        const st = useDash.getState();
        if (st.token?.address) {
          fetch("/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ address: st.token.address, network: st.graph?.network ?? "auto" }),
          })
            .then((r) => r.json())
            .then((j: { sid?: string }) => {
              if (j.sid) useDash.getState().openSession(j.sid);
            })
            .catch(() => {});
        }
      }} />
    </main>
  );
}

function Hero() {
  return (
    <div className="panel glow px-6 py-10 mt-6">
      <div className="max-w-3xl">
        <h2 className="text-2xl font-bold tracking-tight">
          Paste a token address. <span className="text-smart">See who&apos;s pumping it.</span>
        </h2>
        <p className="mt-3 text-sm text-muted leading-relaxed max-w-2xl">
          The terminal locks onto every DEX pair for your token, streams the live trade tape over SSE, and builds
          Nansen-style wallet intelligence in real time: smart-money scoring, pump/dump attribution per wallet,
          fresh-money vs old-holder flow, sniper-bundle detection and a cross-token radar of what tracked smart wallets
          are buying next.
        </p>
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["🎯", "Smart money index", "Composite PnL · timing · impact scoring per wallet"],
            ["⚡", "Sub-second tape", "SSE fan-out of every swap the moment it lands"],
            ["🔬", "Pump/dump forensics", "Which wallets moved price, by how much, per $1k"],
            ["🛰️", "Sniper radar", "New tokens your tracked smart wallets are entering"],
          ].map(([icon, t, d]) => (
            <div key={t} className="rounded-lg border border-edge bg-panel2 p-3">
              <div className="text-lg">{icon}</div>
              <div className="text-xs font-semibold mt-1">{t}</div>
              <div className="text-[10px] text-muted mt-0.5 leading-relaxed">{d}</div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[11px] text-muted">
          Works keyless via DexScreener + GeckoTerminal. Add your own Etherscan / Moralis keys (⚙ Keys) for wallet-age
          lookups, full holder lists and the cross-token sniper radar.
        </p>
      </div>
    </div>
  );
}
