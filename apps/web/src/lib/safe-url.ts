// Server-side URL checks for endpoints that fetch user-supplied URLs (the manifest preview).
// Only public https hosts by name, whose DNS answers are all public addresses.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".arpa", ".corp"];

function privateV4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateV6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("::ffff:")) return privateV4(lower.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
}

export class UnsafeUrl extends Error {}

/** The parsed URL when it is a public https endpoint by name; throws UnsafeUrl otherwise. */
export async function publicHttpsUrl(raw: string): Promise<URL> {
  const text = raw.trim();
  if (text.length > 200) throw new UnsafeUrl("The URL is longer than 200 characters.");
  if (/[\s\\]/.test(text)) throw new UnsafeUrl("The URL must not contain spaces or backslashes.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UnsafeUrl("That is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new UnsafeUrl("Use an https:// URL.");
  if (url.username || url.password) throw new UnsafeUrl("The URL must not contain credentials.");
  if (url.port && url.port !== "443") throw new UnsafeUrl("Use the default https port.");
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, ""))) throw new UnsafeUrl("Use a domain name, not an IP address.");
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !label) || !/^[a-z]+$/.test(labels[labels.length - 1])) {
    throw new UnsafeUrl("Use a public domain name.");
  }
  if (host === "localhost" || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UnsafeUrl("Use a public domain name.");
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrl("That domain does not resolve.");
  }
  if (!addresses.length || addresses.some(({ address, family }) => (family === 6 ? privateV6(address) : privateV4(address)))) {
    throw new UnsafeUrl("That domain points to a private network.");
  }
  return url;
}

const hits = new Map<string, number[]>();

/** A small in-memory limiter: at most `limit` calls per `windowMs` per key, per server instance. */
export function rateLimited(key: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limit;
}
