import path from "node:path";
import type { NextConfig } from "next";

// Optional peer packages pulled in by wagmi's Base Account connector (via Coinbase's CDP SDK).
// ToolBond never uses them, so they resolve to a stub instead of failing the build.
const OPTIONAL_STUBS = [
  "@x402/core/client",
  "@x402/core/schemas",
  "@x402/core/server",
  "@x402/evm",
  "@x402/evm/auth-capture/client",
  "@x402/evm/batch-settlement/client",
  "@x402/evm/exact/client",
  "@x402/evm/exact/server",
  "@x402/evm/exact/v1/client",
  "@x402/evm/upto/client",
  "@x402/evm/upto/server",
  "@x402/express",
  "@x402/extensions/bazaar",
  "@x402/extensions/builder-code",
  "@x402/fetch",
  "@x402/svm/exact/client",
  "@x402/svm/exact/server",
  "@x402/svm/exact/v1/client",
  "@x402/svm/upto/client",
  "@x402/svm/upto/server",
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: path.join(__dirname),
    resolveAlias: Object.fromEntries(OPTIONAL_STUBS.map((name) => [name, "./src/lib/empty-module.ts"])),
  },
};

export default config;
