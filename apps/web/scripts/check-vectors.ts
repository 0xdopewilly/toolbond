// Checks the TypeScript TBCM-1 port against tests/vectors/tbcm1.json: node --experimental-strip-types scripts/check-vectors.ts
import { readFileSync } from "node:fs";
import { canonical, digestManifest, sha256Hex } from "../src/lib/tbcm.ts";

const vectors = JSON.parse(readFileSync(new URL("../../../tests/vectors/tbcm1.json", import.meta.url), "utf8"));
let pass = 0;
const failures: string[] = [];
for (const v of [...vectors.tools, ...vectors.synthetic]) {
  if (v.lossless_parse_required) continue;
  const canon = canonical(JSON.parse(v.raw));
  if (canon === v.canon && sha256Hex(canon) === v.hash) pass += 1;
  else failures.push(`${v.name}\n  want ${v.canon}\n  got  ${canon}`);
}
for (const m of vectors.manifests) {
  const d = digestManifest({ protocol: "", instructions: m.instructions, tools: JSON.parse(m.tools_raw) });
  if (d.root === m.root) pass += 1;
  else failures.push(`manifest ${m.name}: ${d.root} != ${m.root}`);
}
console.log(`${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log("FAIL", f);
process.exit(failures.length ? 1 : 0);
