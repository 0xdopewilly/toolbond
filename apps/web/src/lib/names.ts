// Display names for MCP server URLs.

export function displayName(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(mcp|docs\.mcp|www)\./, "");
    const path = parsed.pathname.replace(/\/mcp$/, "").replace(/^\/(mcp\/)?/, "");
    return path ? `${host} · ${path}` : host;
  } catch {
    return url;
  }
}

export function initial(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(mcp|docs\.mcp|www)\./, "").charAt(0);
  } catch {
    return "?";
  }
}

/** The same URL checks the contract applies in _url_problem. */
export function urlProblem(raw: string): string {
  const url = raw.trim();
  if (!url) return "Enter the server's MCP endpoint.";
  if (url.length > 200) return "The URL is longer than 200 characters.";
  if (!url.startsWith("https://")) return "The URL must start with https://";
  if (/\s/.test(url)) return "The URL must not contain spaces.";
  const host = url.slice(8).split("/")[0].split("?")[0].toLowerCase();
  if (!host || host.includes("@") || host.includes(":")) return "Use a domain without a port or credentials.";
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => !label) || !/^[a-z]+$/.test(labels[labels.length - 1])) {
    return "Use a public domain name.";
  }
  return "";
}
