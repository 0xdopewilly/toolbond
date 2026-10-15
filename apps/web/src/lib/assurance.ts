// What a server's registration actually assures, in one place for the registry, server page,
// guard check and API. Mirrors the contract's _assurance (version 3) and the guard's rules.

export type Assurance = "BONDED" | "UNDERCOLLATERALIZED" | "REVIEWED";

export const MIN_BOND_WEI = 10n * 10n ** 18n;

export function assuranceOf(server: { tier?: string; bond?: string; assurance?: string }): Assurance {
  if (server.assurance === "BONDED" || server.assurance === "UNDERCOLLATERALIZED" || server.assurance === "REVIEWED") {
    return server.assurance;
  }
  if (server.tier === "REVIEWED") return "REVIEWED";
  return BigInt(server.bond || "0") >= MIN_BOND_WEI ? "BONDED" : "UNDERCOLLATERALIZED";
}

export const ASSURANCE_LABEL: Record<Assurance, string> = {
  BONDED: "Bonded",
  UNDERCOLLATERALIZED: "Under-collateralized",
  REVIEWED: "Reviewed, no bond",
};

export const ASSURANCE_HINT: Record<Assurance, string> = {
  BONDED: "The publisher's bond meets the 10 GEN minimum and is slashed if the pinned text turns out poisoned or changes unannounced.",
  UNDERCOLLATERALIZED:
    "The bond fell below the 10 GEN minimum after a drift settlement. It no longer counts as bonded until the publisher tops it up; guards running --bonded-only block it.",
  REVIEWED:
    "Someone paid for validators to pin and judge this server. No bond stands behind it, so nothing is slashed if it changes; guards still block any change.",
};

export const OWNER_HINT = {
  verified: "The pinned server instructions name this publisher (toolbond-owner:<address>), so whoever operates the server chose this registration.",
  unverified:
    "Anyone can register any URL. This publisher has not proven they operate the server: add toolbond-owner:<your address> to the server's MCP instructions and re-pin.",
};

/** Exact GEN amount for a wei value, without float rounding ("0.5", "10", "9.975"). */
export function weiToGen(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/** How much the publisher must add to restore BONDED assurance (0 when it is already met). */
export function topUpNeeded(server: { tier?: string; bond?: string }): bigint {
  if (server.tier !== "BONDED") return 0n;
  const bond = BigInt(server.bond || "0");
  return bond >= MIN_BOND_WEI ? 0n : MIN_BOND_WEI - bond;
}
