#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "./lib/paths.mjs";
import { typecheckBenchmarkApps } from "./typecheck-apps.mjs";

const here = dirname(fileURLToPath(import.meta.url));

run("node", [resolve(here, "verify-installation.mjs")], here);
run(
  "node",
  ["--experimental-strip-types", resolve(here, "verify-data.mjs")],
  here,
);
run("node", [resolve(here, "verify-contract.mjs")], here);
run(
  "node",
  ["--experimental-strip-types", resolve(here, "verify-focused.mjs")],
  here,
);
run(
  "node",
  ["--experimental-strip-types", resolve(here, "verify-runtime-contract.mjs")],
  here,
);
run(
  "node",
  ["--experimental-strip-types", resolve(here, "verify-runtime-harness.mjs")],
  here,
);
run(
  "node",
  ["--experimental-strip-types", resolve(here, "verify-preview-lifecycle.mjs")],
  here,
);
run(
  "node",
  ["--experimental-strip-types", resolve(here, "verify-qs-methodology.mjs")],
  here,
);
typecheckBenchmarkApps();

console.log(
  "benchmark:verify passed (installation boundary + vanilla React isolation + deterministic data + bundle/runtime contract + focused helpers + runtime contract + runtime harness + preview lifecycle + Quick Search methodology + typecheck).",
);
