#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const evidenceRoot = resolve(process.argv[2] ?? scriptDirectory);
const report = readJson(join(evidenceRoot, "bundle-sizes.json"));
const environment = readJson(join(evidenceRoot, "environment.json"));
const evidenceManifest = readJson(join(evidenceRoot, "evidence-manifest.json"));

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
  throw new Error(`Bundle evidence verification failed: ${message}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label}: expected ${expected}, received ${actual}`);
  }
}

function compressedSizes(buffer) {
  return {
    rawBytes: buffer.byteLength,
    gzipBytes: gzipSync(buffer, {
      level: report.methodology.gzipLevel,
    }).byteLength,
    brotliBytes: brotliCompressSync(buffer, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: report.methodology.brotliQuality,
      },
    }).byteLength,
  };
}

function sum(files) {
  return files.reduce(
    (total, file) => {
      const sizes = compressedSizes(readFileSync(file));
      total.rawBytes += sizes.rawBytes;
      total.gzipBytes += sizes.gzipBytes;
      total.brotliBytes += sizes.brotliBytes;
      total.fileCount += 1;
      return total;
    },
    { rawBytes: 0, gzipBytes: 0, brotliBytes: 0, fileCount: 0 },
  );
}

for (const file of evidenceManifest.files) {
  const path = join(evidenceRoot, file.path);
  assertEqual(sha256(path), file.sha256, `SHA-256 for ${file.path}`);
  assertEqual(readFileSync(path).byteLength, file.bytes, `byte count for ${file.path}`);
}

assertEqual(
  environment.git.commit,
  evidenceManifest.sourceCommit,
  "environment source commit",
);
assertEqual(environment.git.dirtyWorktree, false, "clean source worktree");
assertEqual(report.methodology.buildMode, "bundle", "build mode");

for (const [appId, published] of Object.entries(report.applications)) {
  const distDir = join(evidenceRoot, "apps", appId);
  const assets = listFiles(distDir);
  const javascript = sum(assets.filter((file) => [".js", ".mjs", ".cjs"].includes(extname(file))));
  const css = sum(assets.filter((file) => extname(file) === ".css"));
  const totalProductionPayload = {
    rawBytes: javascript.rawBytes + css.rawBytes,
    gzipBytes: javascript.gzipBytes + css.gzipBytes,
    brotliBytes: javascript.brotliBytes + css.brotliBytes,
  };

  for (const key of ["rawBytes", "gzipBytes", "brotliBytes", "fileCount"]) {
    assertEqual(javascript[key], published.javascript[key], `${appId} JavaScript ${key}`);
    assertEqual(css[key], published.css[key], `${appId} CSS ${key}`);
  }
  for (const key of ["rawBytes", "gzipBytes", "brotliBytes"]) {
    assertEqual(
      totalProductionPayload[key],
      published.totalProductionPayload[key],
      `${appId} complete payload ${key}`,
    );
  }
}

console.log(
  `Verified ${evidenceManifest.files.length} files and all six complete application payloads from source commit ${evidenceManifest.sourceCommit}.`,
);
