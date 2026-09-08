#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_IDS, VANILLA_APP_IDS, appDir } from "./lib/paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BENCHMARKS_ROOT = join(here, "..");

function listSrc(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      listSrc(path, acc);
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) acc.push(path);
  }
  return acc;
}

function read(path) {
  return readFileSync(path, "utf8");
}

const PROTOCOL_IMPORTS =
  /protocol(?:\.tsx|\.ts)?["']|benchmarkProtocol|createProtocolRuntime|installBenchmarkProtocol|__GRID_BENCHMARK__|waitForGridEvent|from\s+["']@lfg-benchmarks\/shared["']/;

for (const id of APP_IDS) {
  const srcDir = join(appDir(id), "src");
  const files = listSrc(srcDir);
  const bundleMains = files.filter((file) => /bundle-main\.(ts|tsx)$/.test(file));
  const runtimeMains = files.filter((file) => /runtime-main\.(ts|tsx)$/.test(file));
  assert.equal(bundleMains.length, 1, `${id} must have exactly one bundle-main`);
  assert.equal(runtimeMains.length, 1, `${id} must have exactly one runtime-main`);

  const bundleCode = read(bundleMains[0]);
  assert.equal(
    PROTOCOL_IMPORTS.test(bundleCode),
    false,
    `${id} bundle-main must not import protocol/driver modules or expose __GRID_BENCHMARK__`,
  );

  const runtimeCode = read(runtimeMains[0]);
  assert.match(
    runtimeCode,
    /installBenchmarkProtocol/,
    `${id} runtime-main must install the benchmark protocol`,
  );
}

const sharedBundle = read(join(BENCHMARKS_ROOT, "shared/src/bundle.ts"));
assert.doesNotMatch(
  sharedBundle,
  /protocolRuntime|createProtocolRuntime|completion\.ts|instrumentation\.ts|__GRID_BENCHMARK__/,
  "shared/bundle must not re-export protocol or completion runtime",
);

for (const id of VANILLA_APP_IDS) {
  for (const file of listSrc(join(appDir(id), "src"))) {
    const code = read(file);
    assert.doesNotMatch(
      code,
      /from\s+["']@lfg-benchmarks\/shared["']/,
      `${id} ${relative(appDir(id), file)} must not import the React shared barrel`,
    );
  }
}

function extractAsyncMethod(source, name) {
  const marker = `async ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing async ${name}()`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(brace, index + 1);
    }
  }
  throw new Error(`unterminated async ${name}()`);
}

function countOccurrences(source, pattern) {
  return source.split(pattern).length - 1;
}

function assertLightFastGridSettlementOrder(label, code) {
  assert.doesNotMatch(
    code,
    /refreshDisplayedRowCount\(\);\s*await waitAnimationFrames\(2\)/,
    `${label} must never read displayed count before the two-frame wait`,
  );
  assert.doesNotMatch(code, /getRows\(\)\.length/, `${label} must not use getRows().length`);
  assert.doesNotMatch(code, /setLoading/, `${label} must not mutate loading/overlays for inspection`);
  assert.doesNotMatch(code, /resyncInspection/, `${label} must not implement resyncInspection`);
  assert.doesNotMatch(
    code,
    /waitForLightFastGridAriaCountChange|2_500/,
    `${label} must not wait a fixed 2.5s on accessibility row count`,
  );

  const ready = extractAsyncMethod(code, "waitUntilReady");
  assert.equal(countOccurrences(ready, "waitAnimationFrames(2)"), 1);

  const applyFilter = extractAsyncMethod(code, "applyFilterModel");
  assert.match(applyFilter, /applyLightFastGridNeutralFilter/);

  const sort = extractAsyncMethod(code, "sort");
  assert.match(sort, /waitForGridEvent\(/);
  assert.match(sort, /waitForLightFastGridSortVisible/);
  assert.doesNotMatch(
    sort,
    /waitForGridEventThenRender/,
    `${label} sort must wait for Worker-visible settlement, not only sort:changed plus two frames`,
  );

  const quickSearch = extractAsyncMethod(code, "quickSearch");
  assert.match(quickSearch, /waitForGridEvent\(/);
  assert.doesNotMatch(
    quickSearch,
    /waitForGridEventThenRender/,
    `${label} quickSearch must not use waitForGridEventThenRender (that would add a second two-frame wait)`,
  );
  assert.match(quickSearch, /waitForLightFastGridQuickSearchSettlement/);
  assert.match(quickSearch, /quick-search-pending:changed/);
  assert.match(
    quickSearch,
    /isPending:\s*\(\)\s*=>\s*pending/,
    `${label} quickSearch must wait for the live pending flag to become false`,
  );
  assert.match(
    quickSearch,
    /sawPending:\s*\(\)\s*=>\s*sawPending/,
    `${label} quickSearch must observe pending separately from the live flag`,
  );
  assert.doesNotMatch(
    quickSearch,
    /isPending:\s*\(\)\s*=>\s*sawPending\s*\|\|/,
    `${label} must not latch sawPending as still pending after Worker commit`,
  );
  const pendingAt = quickSearch.lastIndexOf("quick-search-pending:changed");
  const settleAt = quickSearch.lastIndexOf("waitForLightFastGridQuickSearchSettlement");
  assert.ok(
    pendingAt >= 0 && pendingAt < settleAt,
    `${label} quickSearch must subscribe to pending before settlement`,
  );
  assert.doesNotMatch(
    quickSearch,
    /aria-rowcount|readLightFastGridDisplayedRowCount|refreshDisplayedRowCount/,
    `${label} timed quickSearch must not wait on or read aria-rowcount`,
  );

  const clear = extractAsyncMethod(code, "clearOperations");
  assert.doesNotMatch(
    clear,
    /waitForGridEventThenRender/,
    `${label} clearOperations must own a single two-frame wait after all resets`,
  );
  assert.match(clear, /waitForLightFastGridQuickSearchSettlement/);
  const clearPendingAt = clear.lastIndexOf("quick-search-pending:changed");
  const clearSettleAt = clear.lastIndexOf("waitForLightFastGridQuickSearchSettlement");
  assert.ok(
    clearPendingAt >= 0 && clearPendingAt < clearSettleAt,
    `${label} clearOperations must subscribe to Quick Search pending before settlement`,
  );

  const visible = code.slice(code.indexOf("getVisibleState("));
  assert.match(
    visible,
    /readLightFastGridProcessedDisplayedRowCount/,
    `${label} getVisibleState must inspect the processed displayed-row model`,
  );
}

const lfgReactProtocol = read(join(appDir("lightfastgrid"), "src/protocol.tsx"));
const lfgVanillaProtocol = read(join(appDir("lightfastgrid-vanilla"), "src/protocol.ts"));
for (const [label, code] of [
  ["lightfastgrid", lfgReactProtocol],
  ["lightfastgrid-vanilla", lfgVanillaProtocol],
]) {
  assert.match(
    code,
    /readLightFastGridProcessedDisplayedRowCount/,
    `${label} must inspect displayedRowCount from the processed row model`,
  );
  assert.match(
    code,
    /applyLightFastGridNeutralFilter/,
    `${label} must apply the shared neutral filter helper`,
  );
  assert.match(code, /waitForGridEvent\(/, `${label} must use waitForGridEvent`);
  assert.match(code, /waitWithTimeout\(/, `${label} must use waitWithTimeout`);
  assert.match(code, /getAcceptedState/, `${label} must inspect accepted sort/filter/search state`);
  assert.doesNotMatch(
    code,
    /resyncInspection/,
    `${label} must not recapture inspection by mutating loading state`,
  );
  assertLightFastGridSettlementOrder(label, code);
}

const agReactProtocol = read(join(appDir("ag-grid"), "src/protocol.tsx"));
const agVanillaProtocol = read(join(appDir("ag-grid-vanilla"), "src/protocol.ts"));
for (const [label, code] of [
  ["ag-grid", agReactProtocol],
  ["ag-grid-vanilla", agVanillaProtocol],
]) {
  assert.match(code, /waitForGridEventThenRender/, `${label} must use waitForGridEventThenRender`);
  assert.match(code, /waitForGridEvent\(/, `${label} must use waitForGridEvent`);
  assert.match(code, /waitWithTimeout\(/, `${label} must use waitWithTimeout`);
  assert.match(
    code,
    /AG_GRID_VIEWPORT_SELECTOR/,
    `${label} must scroll AG Grid 36 Theming API .ag-grid-viewport`,
  );
  assert.doesNotMatch(
    code,
    /ag-body-viewport|ag-center-cols-viewport/,
    `${label} must not use removed AG Grid 36 viewport class names`,
  );
  assert.match(code, /getAcceptedState/, `${label} must inspect accepted sort/filter/search state`);
}

const sharedFilterApply = read(join(BENCHMARKS_ROOT, "shared/src/neutralFilterApply.ts"));
assert.match(sharedFilterApply, /waitForGridEventThenRender/);
assert.match(sharedFilterApply, /toLightFastGridFilterModel/);
assert.match(sharedFilterApply, /toAgGridFilterModel/);

const remountReadiness = read(join(BENCHMARKS_ROOT, "shared/src/agGridMountReadiness.ts"));
assert.match(remountReadiness, /getGridElement/);
assert.match(remountReadiness, /agGridMountShellIsClear/);
assert.match(remountReadiness, /isDestroyed/);

assert.match(agReactProtocol, /agGridMountIsReady/);
assert.match(agReactProtocol, /remount displayed rows/);
assert.match(agReactProtocol, /currentGeneration/);
assert.match(agReactProtocol, /getGridElement/);
assert.match(agReactProtocol, /previous grid teardown/);
assert.match(agReactProtocol, /onGridPreDestroyed/);
assert.match(agReactProtocol, /hostRef=\{\(node\) => \{/);
assert.doesNotMatch(
  agReactProtocol,
  /onFirstDataRendered=\{\(\) => onReady\(\)\}/,
  "AG Grid React remount must not wait solely on onFirstDataRendered",
);
assert.doesNotMatch(
  agReactProtocol,
  /onHost\(hostRef\.current/,
  "AG Grid React must not read hostRef.current inside onGridReady",
);

const measureSource = read(join(here, "measure-bundles.mjs"));
assert.doesNotMatch(
  measureSource,
  /incrementalGridEstimate:\s*reactLane/,
  "measure-bundles.mjs must not copy React-only estimates to the report root",
);
assert.match(
  measureSource,
  /buildMode:\s*"bundle"/,
  "measure-bundles.mjs must record methodology.buildMode bundle",
);
assert.match(
  measureSource,
  /appDistDir\(id,\s*"bundle"\)/,
  "measure-bundles.mjs must measure dist/bundle only",
);

console.log(
  "Benchmark contract verified: bundle entries exclude protocol, runtime entries install it, LFG drivers share displayed-row helper, waits are bounded.",
);
