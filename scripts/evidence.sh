#!/usr/bin/env bash
# Runs one ToolBond write through scripts/tx.mjs and appends the labelled result to the
# evidence log, so every lifecycle step on chain is recorded with its hash, status and votes.
#
#   scripts/evidence.sh <log.jsonl> <label> <signer:dev|hunter> <method> [--value GEN] [args...]
set -uo pipefail
cd "$(dirname "$0")/.."
log="$1"; label="$2"; signer="$3"; shift 3
contract="${TOOLBOND_ADDRESS:?set TOOLBOND_ADDRESS}"
if [ "$signer" = "hunter" ]; then
  key=$(grep '^HUNTER_PRIVATE_KEY=' .env.local | cut -d= -f2)
  out=$(DEV_PRIVATE_KEY="$key" node scripts/tx.mjs write "$contract" "$@" 2>&1 | tail -1)
else
  out=$(node scripts/tx.mjs write "$contract" "$@" 2>&1 | tail -1)
fi
printf '%s' "$out" | python3 -I -c '
import json, sys, time
label, signer, method = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    result = json.loads(sys.stdin.read())
except ValueError:
    result = {"ok": False, "error": "unparseable tx.mjs output"}
record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "label": label, "signer": signer, "method": method}
record.update({k: result.get(k) for k in ("ok", "hash", "status", "execution", "votes", "returned", "error") if k in result})
print(json.dumps(record))
' "$label" "$signer" "$1" | tee -a "$log"
