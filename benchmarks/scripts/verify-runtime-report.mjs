#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertMergedRuntimeReport } from "../tests/performance/metrics/schema.ts";

const here = dirname(fileURLToPath(import.meta.url));

function resolveSummaryPath(target) {
  if (target.endsWith("summary.json")) return target;
  if (target.endsWith("LATEST")) {
    if (!existsSync(target)) {
      throw new Error(`Runtime LATEST pointer not found at ${target}`);
    }
    const runId = readFileSync(target, "utf8").trim();
    return join(dirname(target), runId, "summary.json");
  }
  return join(target, "summary.json");
}

const target =
  process.argv[2] ??
  join(here, "..", "results", "runtime", "LATEST");
const summaryPath = resolveSummaryPath(target);

if (!existsSync(summaryPath)) {
  throw new Error(`Runtime summary not found at ${summaryPath}`);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
assertMergedRuntimeReport(summary);
console.log(
  `Validated merged runtime report ${summaryPath} (profile=${summary.profile}, publishable=${summary.publishable}).`,
);
