// Docs navigation: one source for the sidebar, prev/next links, search and the command palette.

export interface DocLink {
  slug: string; // "" is the overview
  title: string;
  blurb: string;
  keywords?: string;
}

export interface DocGroup {
  title: string;
  items: DocLink[];
}

export const DOCS: DocGroup[] = [
  {
    title: "Getting started",
    items: [
      { slug: "", title: "Overview", blurb: "What ToolBond is and why tool descriptions need a bond.", keywords: "intro mcp poisoning" },
      { slug: "quickstart", title: "Quickstart", blurb: "Guard an MCP server in Claude Code or Cursor in two minutes.", keywords: "install uvx claude cursor" },
      { slug: "wallets", title: "Wallets and test GEN", blurb: "Connect a wallet on Studio Next and fund it from the faucet.", keywords: "metamask rabby faucet rainbowkit" },
    ],
  },
  {
    title: "Concepts",
    items: [
      { slug: "how-it-works", title: "How it works", blurb: "Bond, pin, judge, patrol: the whole protocol on one page.", keywords: "architecture lifecycle consensus" },
      { slug: "pinning", title: "Pinning and TBCM-1", blurb: "How validators turn a live manifest into identical hashes.", keywords: "hash canonical sha256 root meta" },
      { slug: "judging", title: "Judging and red flags", blurb: "Two readings, verdict words, quotes checked in code.", keywords: "llm judge safe poisoned unclear flags h1" },
      { slug: "challenges", title: "Challenges and payouts", blurb: "Drift and content challenges, stages and the payout table.", keywords: "drift content slash payout stake" },
    ],
  },
  {
    title: "Guides",
    items: [
      { slug: "publish", title: "Publish a server", blurb: "Bond your MCP server and get it pinned and judged.", keywords: "register bond sponsor review exit" },
      { slug: "hunt", title: "Hunt for poisoned tools", blurb: "File challenges by hand or run the patrol bot.", keywords: "hunter patrol bot bounty" },
      { slug: "guard", title: "The guard", blurb: "The local MCP proxy: rules, options and pin sources.", keywords: "proxy stdio options bonded-only" },
    ],
  },
  {
    title: "Reference",
    items: [
      { slug: "contract", title: "Contract API", blurb: "Every write method, view, constant and enumeration.", keywords: "methods views constants abi" },
      { slug: "pinnedfetch", title: "PinnedFetch and gl_mcp", blurb: "The reusable primitive and the MCP client for contracts.", keywords: "primitive library verify_tool" },
      { slug: "security", title: "Security model", blurb: "What ToolBond guarantees, what it does not, and the audit.", keywords: "threat model limits audit cloaking" },
      { slug: "faq", title: "FAQ", blurb: "Networks, costs and the questions people ask first.", keywords: "testnet studio bradbury questions" },
    ],
  },
];

export const DOC_LIST: DocLink[] = DOCS.flatMap((group) => group.items);

export function docHref(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

export function neighbours(slug: string): { prev?: DocLink; next?: DocLink } {
  const index = DOC_LIST.findIndex((item) => item.slug === slug);
  return { prev: index > 0 ? DOC_LIST[index - 1] : undefined, next: index >= 0 ? DOC_LIST[index + 1] : undefined };
}
