// Renders the markdown report for every fixture pair so refactors can be
// diffed against a known-good baseline: npx tsx scripts/capture-baseline.ts <outfile>
import fs from "fs";
import path from "path";
import { generateCoverageReport, TestFailuresResult } from "../packages/core/src";

const fixturesDir = path.resolve(__dirname, "../fixtures");
const scenarios = ["improvement", "regression", "new-file", "deleted-file", "identical"];
const prInfo = { owner: "acme", repo: "demo", prNumber: 42 };
const failures: TestFailuresResult = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, "test-failures/failures.json"), "utf-8")
);

const sections: string[] = [];
for (const scenario of scenarios) {
  const base = JSON.parse(fs.readFileSync(path.join(fixturesDir, scenario, "base.json"), "utf-8"));
  const head = JSON.parse(fs.readFileSync(path.join(fixturesDir, scenario, "head.json"), "utf-8"));
  sections.push(`===== ${scenario} =====\n${generateCoverageReport(base, head, null, prInfo)}`);
  sections.push(
    `===== ${scenario} + failures =====\n${generateCoverageReport(base, head, failures, prInfo)}`
  );
}

const out = process.argv[2] ?? "baseline.md";
fs.writeFileSync(out, sections.join("\n\n"));
console.log(`wrote ${out}`);
