// Writes public/install-qr.svg, the code the /install page shows to desktop visitors.
// Uses the qrcode package RainbowKit already installs:  node scripts/install-qr.mjs
import { writeFileSync } from "node:fs";
import QRCode from "qrcode";

const svg = await QRCode.toString("https://toolbond.vercel.app/install", {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 2,
  color: { dark: "#111110", light: "#ffffff" },
});
writeFileSync(new URL("../public/install-qr.svg", import.meta.url), svg);
console.log("public/install-qr.svg", svg.length, "bytes");
