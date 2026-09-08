#!/usr/bin/env node
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_IDS,
  BUILD_MODES,
  appDir,
  CORE_TARBALL,
  REACT_TARBALL,
  requireFile,
  run,
} from "./lib/paths.mjs";
import { assertBuiltModeAssets } from "./lib/bundle-integrity.mjs";
import { typecheckBenchmarkApps } from "./typecheck-apps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const requested = process.argv.find((arg) => arg === "bundle" || arg === "runtime");
const modes =
  requested === "bundle" || requested === "runtime" ? [requested] : BUILD_MODES;

requireFile(CORE_TARBALL, "Run pnpm benchmark:prepare first");
requireFile(REACT_TARBALL, "Run pnpm benchmark:prepare first");

console.log("Typechecking benchmark apps...");
typecheckBenchmarkApps();

for (const id of APP_IDS) {
  const distRoot = join(appDir(id), "dist");
  rmSync(distRoot, { recursive: true, force: true });
  for (const mode of modes) {
    console.log(`Building ${id} (${mode})...`);
    run("pnpm", ["run", `build:${mode}`], appDir(id));
    assertBuiltModeAssets(id, mode);
  }
}

console.log(
  "Verifying static production HTML assets and Vite serving (does not execute the app or protocol)...",
);
run("node", [resolve(here, "verify-static-preview.mjs"), ...modes], here);

console.log(`Benchmark ${modes.join(" + ")} builds complete.`);
