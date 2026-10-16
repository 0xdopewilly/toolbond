// node --test test/  (Node 22.18+ runs the TypeScript module directly)
import assert from "node:assert/strict";
import { test } from "node:test";
import { browserName, inAppBrowser, installPlatform } from "../src/lib/install-core.ts";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.76 Mobile/15E148 Safari/604.1",
  ipadDesktopMode: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  androidWebView: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.0.0 Mobile Safari/537.36",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.0.0 (iPhone15,2; iOS 18_6; en_US)",
  xAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.0.0 Mobile Safari/537.36 TwitterAndroid",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
};

test("phones and tablets get their own install path", () => {
  assert.equal(installPlatform(UA.iphoneSafari), "ios");
  assert.equal(installPlatform(UA.iphoneChrome), "ios");
  assert.equal(installPlatform(UA.ipadDesktopMode, 5), "ios"); // iPadOS reports a Mac with a touch screen
  assert.equal(installPlatform(UA.macSafari, 0), "desktop");
  assert.equal(installPlatform(UA.androidChrome), "android");
  assert.equal(installPlatform(UA.samsung), "android");
  assert.equal(installPlatform(UA.windowsEdge), "desktop");
});

test("built-in app browsers are recognised, real browsers are not", () => {
  assert.equal(inAppBrowser(UA.instagram), "Instagram");
  assert.equal(inAppBrowser(UA.xAndroid), "X");
  assert.equal(inAppBrowser(UA.androidWebView), "an app");
  for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.androidChrome, UA.samsung, UA.windowsChrome]) assert.equal(inAppBrowser(ua), null);
});

test("menus are named after the real browser", () => {
  assert.equal(browserName(UA.iphoneSafari), "Safari");
  assert.equal(browserName(UA.iphoneChrome), "Chrome");
  assert.equal(browserName(UA.samsung), "Samsung Internet");
  assert.equal(browserName(UA.windowsEdge), "Edge");
  assert.equal(browserName(UA.androidChrome), "Chrome");
});
