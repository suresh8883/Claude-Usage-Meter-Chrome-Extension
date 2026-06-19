/* Regression test for usage-percentage parsing.
 * Extracts the real oneNode() from src/content.js and verifies that
 * utilization (a 0–100 percentage) is passed through unchanged and clamped —
 * guarding against the bug where 1% was scaled up to 100%.
 *
 * Run: node test/parse.test.js
 */
const fs = require("fs");
const path = require("path");

const content = fs.readFileSync(path.join(__dirname, "..", "src", "content.js"), "utf8");

// Pull out the oneNode function by brace-matching.
const start = content.indexOf("function oneNode");
if (start < 0) { console.error("FAIL: oneNode() not found in src/content.js"); process.exit(1); }
let depth = 0, end = -1;
for (let i = content.indexOf("{", start); i < content.length; i++) {
  if (content[i] === "{") depth++;
  else if (content[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
const oneNode = eval("(" + content.slice(start, end) + ")");

const cases = [
  [0, 0], [1, 1], [2, 2], [17, 17], [50, 50], [68, 68], [99, 99], [100, 100],
  [150, 100], [-5, 0], [0.5, 0.5],
];

let failed = 0;
for (const [util, expected] of cases) {
  const got = oneNode({ utilization: util, resets_at: "2026-06-20T00:00:00Z" }).pct;
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  utilization=${util}  ->  pct=${got}  (expected ${expected})`);
}

// reset parsing + null guard
const withReset = oneNode({ utilization: 5, resets_at: "2026-06-20T00:00:00Z" });
const resetOk = typeof withReset.resetMs === "number" && !isNaN(withReset.resetMs);
console.log(`${resetOk ? "PASS" : "FAIL"}  resets_at parsed to a timestamp`);
const nullOk = oneNode({}) === null && oneNode(null) === null;
console.log(`${nullOk ? "PASS" : "FAIL"}  returns null when no utilization`);
if (!resetOk) failed++;
if (!nullOk) failed++;

if (failed) { console.error(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log("\nAll parsing checks passed ✓");
