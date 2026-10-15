import type { MetadataRoute } from "next";

// Lets phones and tablets install ToolBond to the home screen and open it like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ToolBond: bonded MCP tool manifests",
    short_name: "ToolBond",
    description: "MCP tools pinned by hash, judged by GenLayer validators, and slashed when they turn malicious.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0c0c0b",
    theme_color: "#0c0c0b",
    categories: ["developer", "security", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Check a server", url: "/guard", description: "Run the guard in the browser" },
      { name: "Publish", url: "/publish", description: "Bond a server" },
      { name: "Challenges", url: "/challenges", description: "Open and settled challenges" },
    ],
  };
}
