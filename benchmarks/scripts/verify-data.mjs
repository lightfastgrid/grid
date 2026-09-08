#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checksumColumnSchema, checksumDataset } from "../shared/src/checksum.ts";
import { generateRows } from "../shared/src/generateRows.ts";
import {
  CANONICAL_PUBLIC_COLUMN_COUNT,
  CANONICAL_PUBLIC_ROW_COUNT,
  CANONICAL_PUBLIC_SCENARIO_NAME,
  assertCanonicalPublicScenario,
} from "../shared/src/canonicalPublicScenario.ts";
import {
  assertScenarioAllowed,
  createColumns,
  getScenario,
  listDefaultScenarioNames,
  listScenarioNames,
  SCENARIO_SEED,
} from "../shared/src/scenarios.ts";

const here = dirname(fileURLToPath(import.meta.url));
const locked = JSON.parse(
  readFileSync(join(here, "../shared/dataset-checksums.json"), "utf8"),
);

const defaultNames = listDefaultScenarioNames();
assert.deepEqual(
  defaultNames.includes("extreme"),
  false,
  "extreme must not be a default scenario",
);
assert.equal(getScenario("extreme").optIn, true);
assert.equal(getScenario("extreme").memoryIntensive, true);

assert.throws(
  () => assertScenarioAllowed("extreme", false),
  /opt-in|memory-intensive/,
);

assert.equal(locked.seed, SCENARIO_SEED);
assert.equal(getScenario("runtime-publish").rowCount, CANONICAL_PUBLIC_ROW_COUNT);
assert.equal(getScenario("runtime-publish").columnCount, CANONICAL_PUBLIC_COLUMN_COUNT);
assert.equal(CANONICAL_PUBLIC_SCENARIO_NAME, "runtime-publish");
assert.throws(
  () =>
    assertCanonicalPublicScenario("publish-native", {
      name: "normal",
      rowCount: 10_000,
      columnCount: 20,
    }),
  /must use runtime-publish/,
);
assert.doesNotThrow(() =>
  assertCanonicalPublicScenario("publish-native", {
    name: "runtime-publish",
    rowCount: 100_000,
    columnCount: 50,
  }),
);
assert.doesNotThrow(() =>
  assertCanonicalPublicScenario("smoke", {
    name: "normal",
    rowCount: 10_000,
    columnCount: 20,
  }),
);

const checksums = {};
for (const name of defaultNames) {
  const scenario = getScenario(name);
  const columns = createColumns(scenario.columnCount);
  const first = generateRows(name, columns, scenario.rowCount);
  assert.equal(first.rows.length, scenario.rowCount);
  assert.equal(columns.length, scenario.columnCount);
  assert.equal(first.rows[0]?.id, "row-0000001");
  assert.equal(first.seed, SCENARIO_SEED);
  const firstSum = checksumDataset(first.rows, columns);
  const schemaSum = checksumColumnSchema(columns);
  first.rows.length = 0;
  const second = generateRows(name, columns, scenario.rowCount);
  const secondSum = checksumDataset(second.rows, columns);
  second.rows.length = 0;
  assert.equal(firstSum, secondSum, `${name} checksum was not deterministic`);
  const expected = locked.scenarios[name];
  assert.ok(expected, `locked checksum missing for ${name}`);
  assert.equal(expected.rowCount, scenario.rowCount, `${name} rowCount lock`);
  assert.equal(expected.columnCount, scenario.columnCount, `${name} columnCount lock`);
  assert.equal(firstSum, expected.datasetSha256, `${name} dataset SHA-256 changed`);
  assert.equal(schemaSum, expected.columnSchemaSha256, `${name} column-schema SHA-256 changed`);
  checksums[name] = {
    rowCount: scenario.rowCount,
    columnCount: columns.length,
    seed: first.seed,
    datasetSha256: firstSum,
    columnSchemaSha256: schemaSum,
    generationMsFirst: first.generationMs,
    generationMsSecond: second.generationMs,
  };
}

assert.deepEqual(listScenarioNames().sort(), [
  "extreme",
  "large-rows",
  "normal",
  "runtime-publish",
  "wide",
]);

console.log("Deterministic data generation verified for default scenarios:");
console.log(JSON.stringify(checksums, null, 2));
console.log("extreme was not generated and is not in the default scenario list.");
console.log(
  `Canonical public scenario locked at ${CANONICAL_PUBLIC_ROW_COUNT} × ${CANONICAL_PUBLIC_COLUMN_COUNT}.`,
);
