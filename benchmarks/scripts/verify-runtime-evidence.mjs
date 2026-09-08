#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const evidenceRoot = resolve(process.argv[2] ?? scriptDirectory);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    })
    .sort();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fail(message) {
  throw new Error(`Runtime evidence verification failed: ${message}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, received ${actual}`);
  }
}

const summary = readJson(join(evidenceRoot, "summary.json"));
const environment = readJson(join(evidenceRoot, "environment.json"));
const evidenceManifest = readJson(join(evidenceRoot, "evidence-manifest.json"));
const expected = readJson(join(evidenceRoot, "expected-state.json"));

if (Object.prototype.hasOwnProperty.call(summary, "winner")) {
  fail("summary must not declare a winner");
}
assertEqual(summary.publishable, true, "publishable");
assertEqual(summary.complete, true, "complete");
assertEqual(summary.profile, "publish-native", "profile");
assertEqual(environment.git.dirtyWorktree, false, "clean worktree");
assertEqual(expected.rowCount, 100000, "rowCount");
assertEqual(expected.columnCount, 50, "columnCount");
assertEqual(expected.datasetSha256, evidenceManifest.datasetSha256, "dataset SHA-256");
assertEqual(expected.columnSchemaSha256, evidenceManifest.columnSchemaSha256, "schema SHA-256");

if (summary.quickSearchModeComparison?.provisional === true) {
  fail("Quick Search comparison is provisional");
}
if (summary.filterModeComparison?.provisional === true) {
  fail("Filter comparison is provisional");
}

for (const file of evidenceManifest.files) {
  const path = join(evidenceRoot, file.path);
  if (!existsSync(path)) fail(`missing ${file.path}`);
  assertEqual(sha256(path), file.sha256, `SHA-256 for ${file.path}`);
  assertEqual(readFileSync(path).byteLength, file.bytes, `byte count for ${file.path}`);
}

console.log(`Verified runtime evidence at ${evidenceRoot} (${listFiles(evidenceRoot).length} files).`);
