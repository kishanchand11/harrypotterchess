import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SmartMoney Terminal — DeFi Token Pair Analyzer",
  description:
    "Live DEX pair intelligence: smart-money wallet tracking, pump/dump attribution, fresh vs old holder flow, sniper radar. Bring your own API keys.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
