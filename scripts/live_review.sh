#!/usr/bin/env bash
# Sponsor, snapshot and review one real MCP server on a deployed ToolBond contract,
# then print the verdict validators agreed on (read from the leader's consensus output,
# which works even when Studio Next's contract reads are down).
#
#   scripts/live_review.sh <toolbond-address> <server-url> "<purpose>" <caps>
set -euo pipefail
cd "$(dirname "$0")/.."
TB="$1"; URL="$2"; PURPOSE="$3"; CAPS="$4"
RPC="${GENLAYER_RPC:-https://studio-dev.genlayer.com/api}"
SID=$(python3 -c "import hashlib,sys; print(hashlib.sha256(sys.argv[1].strip().encode()).hexdigest()[:16])" "$URL")

step() {
  local out
  out=$(node scripts/tx.mjs write "$TB" "$@" 2>&1 | tail -1)
  echo "$1: $out" >&2
  printf '%s' "$out" | grep -oE '0x[0-9a-f]{64}' | head -1
}

verdict() {
  curl -sS -X POST "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionByHash\",\"params\":[\"$1\"]}" |
    python3 -I -c '
import base64, json, re, sys
tx = json.load(sys.stdin)["result"]
data = tx.get("consensus_data") or {}
receipt = data.get("leader_receipt")
receipt = receipt[0] if isinstance(receipt, list) else receipt
votes = data.get("votes") or {}
text = " ".join(base64.b64decode(v).decode("utf-8", "replace") for v in (receipt.get("eq_outputs") or {}).values())
found = re.findall(r"(SAFE|POISONED|UNCLEAR)", text)
reason = re.search(r"reason.{1,3}([^\x00-\x08]{0,160}?)\x04", text)
agree = sum(1 for v in votes.values() if v == "agree") if isinstance(votes, dict) else votes
print(json.dumps({"verdict": found[-1] if found else None, "agree": agree, "reason": reason.group(1) if reason else ""}))
'
}

step sponsor_review --value 0.2 "$URL" "$PURPOSE" "$CAPS" >/dev/null
step snapshot "$SID" >/dev/null
HASH=$(step review "$SID")
echo "$URL $(verdict "$HASH")"
