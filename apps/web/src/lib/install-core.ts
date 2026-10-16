// Which install path a visitor has: the browser's own prompt (Chrome, Edge, Samsung Internet),
// Add to Home Screen by hand (iPhone and iPad), or neither (an app's built-in browser).
// No I/O here, so it is tested directly (test/install.test.mjs).

export type InstallPlatform = "ios" | "android" | "desktop";

export function installPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios"; // iPadOS asks for the desktop site
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

const IN_APP: [RegExp, string][] = [
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB/, "Facebook"],
  [/Twitter/i, "X"],
  [/Telegram/i, "Telegram"],
  [/Discord/i, "Discord"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Line\//, "LINE"],
  [/MicroMessenger/i, "WeChat"],
  [/BytedanceWebview|musical_ly|TikTok/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
];

/**
 * Built-in browsers inside other apps cannot install web apps. Returns the app's name when the user
 * agent gives it away, "an app" for an unnamed Android WebView, and null otherwise. Some (iOS apps
 * that open Safari's view controller) look exactly like Safari, so the steps also say so in words.
 */
export function inAppBrowser(userAgent: string): string | null {
  for (const [pattern, name] of IN_APP) if (pattern.test(userAgent)) return name;
  if (/Android/i.test(userAgent) && /; wv\)/.test(userAgent)) return "an app";
  return null;
}

/** The browser behind the user agent, for naming its menus. iOS browsers other than Safari say so. */
export function browserName(userAgent: string): string {
  if (/CriOS/.test(userAgent)) return "Chrome";
  if (/FxiOS|Firefox\//.test(userAgent)) return "Firefox";
  if (/EdgiOS|EdgA|Edg\//.test(userAgent)) return "Edge";
  if (/SamsungBrowser/.test(userAgent)) return "Samsung Internet";
  if (/OPR\/|OPiOS/.test(userAgent)) return "Opera";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "your browser";
}
