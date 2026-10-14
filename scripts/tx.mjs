// Send ToolBond transactions from the terminal, including payable calls the CLI cannot make.
//
//   node scripts/tx.mjs write <contract> <method> [--value <GEN>] [arg ...]
//   node scripts/tx.mjs read  <contract> <method> [arg ...]
//
// Arguments are JSON when they parse as JSON, strings otherwise. The signer is
// DEV_PRIVATE_KEY from .env.local (a testnet-only key). Prints one JSON line.
import { readFileSync } from "node:fs";
import { createAccount, createClient, chains } from "genlayer-js";

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
    }
  } catch {
    // no .env.local: rely on the environment
  }
}

function parseArg(raw) {
  try {
    const value = JSON.parse(raw);
    return typeof value === "number" ? BigInt(raw) : value;
  } catch {
    return raw;
  }
}

function toWei(gen) {
  const [whole, fraction = ""] = String(gen).split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18) || "0");
}

const replacer = (_key, value) => (typeof value === "bigint" ? value.toString() : value);

async function main() {
  loadEnv(new URL("../.env.local", import.meta.url).pathname);
  const [mode, address, method, ...rest] = process.argv.slice(2);
  if (!mode || !address || !method) {
    console.error("usage: node scripts/tx.mjs write|read <contract> <method> [--value <GEN>] [arg ...]");
    process.exit(2);
  }
  let value = 0n;
  let timeunits = process.env.TIMEUNITS ? String(process.env.TIMEUNITS) : "";
  const args = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--value") {
      value = toWei(rest[i + 1]);
      i += 1;
    } else if (rest[i] === "--timeunits") {
      timeunits = rest[i + 1];
      i += 1;
    } else {
      args.push(parseArg(rest[i]));
    }
  }
  const account = process.env.DEV_PRIVATE_KEY ? createAccount(process.env.DEV_PRIVATE_KEY) : undefined;
  const client = createClient({ chain: chains.studioDevnet, account });

  if (mode === "read") {
    const result = await client.readContract({ address, functionName: method, args });
    console.log(JSON.stringify({ ok: true, result }, replacer));
    return;
  }
  // Web and LLM calls get their timeouts from the time-unit allocation; big contracts need more.
  const estimate = await client.estimateTransactionFees(
    timeunits ? { leaderTimeunitsAllocation: timeunits, validatorTimeunitsAllocation: timeunits } : undefined,
  );
  const fees = { distribution: estimate.distribution, feeValue: estimate.feeValue };
  const hash = await client.writeContract({ address, functionName: method, args, value, fees });
  await client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 4000, retries: 90 });
  const tx = await client.getTransaction({ hash });
  const ok = ["ACCEPTED", "FINALIZED"].includes(tx.statusName) && tx.txExecutionResultName === "FINISHED_WITH_RETURN";
  console.log(
    JSON.stringify(
      { ok, hash, status: tx.statusName, execution: tx.txExecutionResultName, result: tx.result_name ?? tx.resultName ?? null },
      replacer,
    ),
  );
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.shortMessage ?? error?.message ?? error) }));
  process.exit(1);
});
