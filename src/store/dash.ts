"use client";

import { create } from "zustand";
import type {
  FlowSnapshot,
  HoldersSnapshot,
  PairGraph,
  SessionHealth,
  Signal,
  SniperItem,
  Snapshot,
  Tick,
  TokenMeta,
  Trade,
  WalletSummary,
} from "@/engine/types";

export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";

interface DashStore {
  status: StreamStatus;
  error: string | null;
  sid: string | null;
  mode: "live" | "simulated" | null;
  simReason: string | null;
  token: TokenMeta | null;
  graph: PairGraph | null;
  price: number;
  wallets: WalletSummary[];
  trades: Trade[];
  ticks: Tick[];
  signals: Signal[];
  flow: FlowSnapshot | null;
  holders: HoldersSnapshot | null;
  sniper: SniperItem[];
  radarEnabled: boolean;
  health: SessionHealth | null;
  classFilter: string;
  lastEventAt: number;

  openSession: (sid: string) => void;
  reset: () => void;
  applySnapshot: (s: Snapshot) => void;
  applyEvent: (type: string, data: unknown) => void;
  setClassFilter: (f: string) => void;
}

const initial = {
  status: "idle" as StreamStatus,
  error: null,
  sid: null,
  mode: null,
  simReason: null,
  token: null,
  graph: null,
  price: 0,
  wallets: [],
  trades: [],
  ticks: [],
  signals: [],
  flow: null,
  holders: null,
  sniper: [],
  radarEnabled: false,
  health: null,
  classFilter: "all",
  lastEventAt: 0,
};

export const useDash = create<DashStore>()((set) => ({
  ...initial,

  openSession: (sid) => set({ ...initial, status: "connecting", sid }),
  reset: () => set({ ...initial }),
  setClassFilter: (classFilter) => set({ classFilter }),

  applySnapshot: (s) =>
    set({
      status: "live",
      error: null,
      sid: s.sid,
      mode: s.mode,
      simReason: s.simReason ?? null,
      token: s.token,
      graph: s.graph,
      price: s.price,
      wallets: s.wallets,
      trades: s.trades,
      ticks: s.ticks,
      signals: s.signals,
      flow: s.flow,
      holders: s.holders,
      sniper: s.sniper,
      radarEnabled: s.radarEnabled,
      health: s.health,
      lastEventAt: Date.now(),
    }),

  applyEvent: (type, data) =>
    set((st) => {
      switch (type) {
        case "tick": {
          const tick = data as Tick;
          const ticks = [...st.ticks, tick].slice(-1080);
          return { ticks, price: tick.priceUsd, lastEventAt: Date.now() };
        }
        case "trades": {
          const incoming = data as Trade[];
          if (!incoming.length) return {};
          const trades = [...incoming.reverse(), ...st.trades].slice(0, 300);
          return { trades, lastEventAt: Date.now() };
        }
        case "wallets":
          return { wallets: data as WalletSummary[], lastEventAt: Date.now() };
        case "signal": {
          const sig = data as Signal;
          const signals = [sig, ...st.signals].slice(0, 80);
          return { signals, lastEventAt: Date.now() };
        }
        case "flow":
          return { flow: data as FlowSnapshot, lastEventAt: Date.now() };
        case "holders":
          return { holders: data as HoldersSnapshot, lastEventAt: Date.now() };
        case "sniper":
          return { sniper: data as SniperItem[], lastEventAt: Date.now() };
        case "health":
          return { health: data as SessionHealth, lastEventAt: Date.now() };
        case "stopped":
          return { status: "error", error: "Session ended server-side. Re-run analysis." };
        default:
          return {};
      }
    }),
}));
