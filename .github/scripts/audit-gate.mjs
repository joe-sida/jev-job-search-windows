/**
 * `npm audit` with one advisory named as a known exception, so a new high or
 * critical one still fails the build. The exception is in README.md under
 * Known issues: it is zod 3's, it came with upstream, and its fix is zod 4.
 * Remove the id here and that section there in the same commit as the upgrade.
 *
 * Usage: node .github/scripts/audit-gate.mjs audit.json
 */
import { readFileSync } from "node:fs";

const KNOWN = new Set(["GHSA-mrhx-c7xc-m3w5"]);
const BAD = new Set(["high", "critical"]);

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const counts = report.metadata?.vulnerabilities ?? {};
const serious = (counts.high ?? 0) + (counts.critical ?? 0);

/** Each advisory behind a serious finding, by its GHSA id. */
const found = new Map();
for (const entry of Object.values(report.vulnerabilities ?? {})) {
  if (!BAD.has(entry.severity)) continue;
  for (const via of entry.via ?? []) {
    if (typeof via !== "object" || !BAD.has(via.severity) || !via.url) continue;
    found.set(via.url.split("/").pop(), `${via.title} (${via.name})`);
  }
}

const unexpected = [...found].filter(([id]) => !KNOWN.has(id));

if (serious > 0 && found.size === 0) {
  console.error(`npm audit reports ${serious} high or critical finding(s) this check could not identify. Run npm audit --omit=dev and look.`);
  process.exit(1);
}
if (unexpected.length > 0) {
  for (const [id, what] of unexpected) console.error(`not a known exception: ${id} ${what}`);
  process.exit(1);
}

const known = [...found].map(([id]) => id);
console.log(serious === 0 ? "no high or critical advisories" : `only known advisories: ${known.join(", ")}`);
