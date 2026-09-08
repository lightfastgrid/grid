#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

import {
  BENCHMARKS_ROOT,
  RUNTIME_GRID_APP_IDS,
  RUNTIME_RESULTS_DIR,
  appDistDir,
  requireFile,
  run,
  readCommand,
  REPO_ROOT,
} from "./lib/paths.mjs";
import {
  assertMergedRuntimeReport,
  assertPublishableThrottle,
  fatalPublishReasons,
} from "../tests/performance/metrics/schema.ts";
import { unexpectedInvalidMeasuredReasons } from "../tests/performance/fixtures/correctness.ts";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(BENCHMARKS_ROOT, "package.json"));
const profileArg = process.argv[2] ?? "publish";
const profile =
  profileArg === "smoke" ||
  profileArg === "publish" ||
  profileArg === "publish-native" ||
  profileArg === "trace"
    ? profileArg
    : null;
if (!profile) {
  throw new Error(`Unknown runtime profile "${profileArg}". Use smoke, publish, publish-native, or trace.`);
}

function assertChromiumInstalled() {
  const executable = chromium.executablePath();
  if (!existsSync(executable)) {
    throw new Error(
      `Playwright Chromium is not installed (${executable}). Run pnpm benchmark:runtime:install`,
    );
  }
}

for (const id of RUNTIME_GRID_APP_IDS) {
  requireFile(
    join(appDistDir(id, "runtime"), "index.html"),
    `${id} runtime build. Run pnpm benchmark:build runtime first`,
  );
}

assertChromiumInstalled();

const utc = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
let shortSha = "nogit";
try {
  shortSha = readCommand("git", ["rev-parse", "--short=7", "HEAD"], REPO_ROOT);
} catch {
  shortSha = "nogit";
}
const runId = `${utc}-${shortSha}-${profile}`;
const runDir = join(RUNTIME_RESULTS_DIR, runId);
mkdirSync(runDir, { recursive: true });

const env = {
  ...process.env,
  LFG_BENCH_PROFILE: profile,
  LFG_BENCH_RUN_DIR: runDir,
  LFG_BENCH_RUN_ID: runId,
  LFG_BENCH_ENVIRONMENT_OUT: join(runDir, "environment.partial.json"),
};

run("node", [resolve(here, "capture-environment.mjs")], here, { env });

const playwrightVersion = require("@playwright/test/package.json").version;

let playwrightError = null;
try {
  run(
    "pnpm",
    ["exec", "playwright", "test", "--config", "playwright.config.ts"],
    BENCHMARKS_ROOT,
    { env },
  );
} catch (error) {
  playwrightError = error;
}

const summaryPath = join(runDir, "summary.json");
if (!existsSync(summaryPath)) {
  throw playwrightError instanceof Error
    ? new Error(`Playwright failed and did not write ${summaryPath}: ${playwrightError.message}`, {
        cause: playwrightError,
      })
    : new Error(`Playwright did not write ${summaryPath}`);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const environmentPath = join(runDir, "environment.json");
if (existsSync(environmentPath)) {
  const environment = JSON.parse(readFileSync(environmentPath, "utf8"));
  environment.playwright = { version: playwrightVersion };
  summary.environment = {
    ...environment,
    ...summary.environment,
    playwright: { version: playwrightVersion },
  };
  summary.methodology.provisional =
    Boolean(environment.git?.dirtyWorktree) || !summary.publishable || summary.complete !== true;
  writeFileSync(environmentPath, `${JSON.stringify(summary.environment, null, 2)}\n`);
  writeFileSync(join(runDir, "methodology.json"), `${JSON.stringify(summary.methodology, null, 2)}\n`);
}

writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(RUNTIME_RESULTS_DIR, "LATEST"), `${runId}\n`);

try {
  assertMergedRuntimeReport(summary);
} catch (error) {
  const schemaMessage = error instanceof Error ? error.message : String(error);
  if (playwrightError) {
    const original =
      playwrightError instanceof Error ? playwrightError.message : String(playwrightError);
    throw new Error(`${original}; schema validation also failed: ${schemaMessage}`, {
      cause: playwrightError,
    });
  }
  throw error;
}

if (playwrightError) {
  throw new Error(
    `Playwright failed after writing evidence to ${runDir}: ${playwrightError instanceof Error ? playwrightError.message : String(playwrightError)}`,
    { cause: playwrightError },
  );
}

if (summary.complete !== true) {
  throw new Error(
    `Runtime run is incomplete${summary.fatalReason ? `: ${summary.fatalReason}` : ""}`,
  );
}

if (profile === "smoke") {
  const rawPath = join(runDir, "raw-samples.json");
  const raw = existsSync(rawPath) ? JSON.parse(readFileSync(rawPath, "utf8")) : { samples: [] };
  const unexpected = unexpectedInvalidMeasuredReasons(
    Array.isArray(raw.samples) ? raw.samples : [],
    summary.methodology?.rowCount ?? 0,
  );
  if (unexpected.length > 0) {
    throw new Error(`Smoke has unexpected invalid measured samples: ${unexpected.join("; ")}`);
  }
}

if (profile === "publish" || profile === "publish-native") {
  assertPublishableThrottle(summary);
  const fatal = fatalPublishReasons(summary);
  if (fatal.length > 0) {
    throw new Error(`Publish profile failed: ${fatal.join("; ")}`);
  }
  if (!summary.publishable) {
    console.log(
      `Publish run completed as provisional: ${summary.publishableDeniedReasons.join("; ")}`,
    );
  }
}

console.log(`Wrote runtime evidence to ${runDir}`);
console.log(
  `Profile ${profile}. React and Vanilla remain independent. Median durationMs is the primary metric, not a ranking.`,
);
if (profile === "smoke") {
  console.log("Smoke statistics are diagnostic only and must not be published as Worker or product rankings.");
}
if (profile === "publish") {
  console.log("4x publish is a page-throttled diagnostic profile. Worker-vs-main-thread numbers stay provisional while Worker CDP throttle is unsupported.");
}
if (profile === "publish-native") {
  console.log("Native 1x applies no CDP CPU throttle. It does not prove 4x throttled performance.");
}
if (profile === "trace") {
  console.log("Trace mode is diagnostic. Tracing changes performance and is excluded from published timings.");
}
