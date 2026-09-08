#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { readTarballPackageJson } from "./lib/tar.mjs";
import {
  APP_IDS,
  ARTIFACTS_DIR,
  BENCHMARKS_ROOT,
  CORE_PACKAGE_DIR,
  CORE_TARBALL,
  REACT_PACKAGE_DIR,
  REACT_TARBALL,
  REPO_ROOT,
  appDir,
  requireFile,
  runPnpm,
  runPnpmInBenchmarks,
} from "./lib/paths.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertTarballUnchanged(label, path, expectedSha) {
  const actual = sha256File(path);
  if (actual !== expectedSha) {
    fail(
      `${label} tarball changed after packing (${expectedSha.slice(0, 12)} → ${actual.slice(0, 12)}). Packed artifacts must stay byte-for-byte intact.`,
    );
  }
}

function packPackage(packageDir, stableName) {
  const before = new Set(existsSync(ARTIFACTS_DIR) ? readdirSync(ARTIFACTS_DIR) : []);
  runPnpm(["pack", "--pack-destination", ARTIFACTS_DIR], packageDir);
  const after = readdirSync(ARTIFACTS_DIR);
  const created = after.filter((name) => name.endsWith(".tgz") && !before.has(name));
  if (created.length !== 1) {
    fail(
      `pnpm pack in ${packageDir} did not produce exactly one tarball (found: ${created.join(", ") || "none"})`,
    );
  }
  const packedPath = join(ARTIFACTS_DIR, created[0]);
  const targetPath = join(ARTIFACTS_DIR, stableName);
  if (packedPath !== targetPath) {
    if (existsSync(targetPath)) rmSync(targetPath);
    renameSync(packedPath, targetPath);
  }
  requireFile(targetPath, `Failed to pack ${packageDir}`);
  return targetPath;
}

function refreshBenchmarkInstall() {
  const lockfile = join(BENCHMARKS_ROOT, "pnpm-lock.yaml");
  const rootModules = join(BENCHMARKS_ROOT, "node_modules");
  if (existsSync(rootModules)) {
    rmSync(rootModules, { recursive: true, force: true });
  }
  if (existsSync(lockfile)) {
    rmSync(lockfile);
  }
  for (const id of APP_IDS) {
    const appModules = join(appDir(id), "node_modules");
    if (existsSync(appModules)) {
      rmSync(appModules, { recursive: true, force: true });
    }
  }
  const sharedModules = join(BENCHMARKS_ROOT, "shared", "node_modules");
  if (existsSync(sharedModules)) {
    rmSync(sharedModules, { recursive: true, force: true });
  }
  runPnpmInBenchmarks(["install"]);
}

mkdirSync(ARTIFACTS_DIR, { recursive: true });

console.log("Building @lightfastgrid/core...");
runPnpm(["--filter", "@lightfastgrid/core", "run", "build"], REPO_ROOT);

console.log("Building @lightfastgrid/react...");
runPnpm(["--filter", "@lightfastgrid/react", "run", "build"], REPO_ROOT);

requireFile(join(CORE_PACKAGE_DIR, "dist/index.mjs"), "Core build did not emit dist/index.mjs");
requireFile(
  join(CORE_PACKAGE_DIR, "dist/themes/default.css"),
  "Core build did not emit dist/themes/default.css",
);
for (const prefix of ["csvExportWorker", "filterWorker", "quickSearchWorker", "sortWorker"]) {
  const assetsDir = join(CORE_PACKAGE_DIR, "dist/assets");
  const found = existsSync(assetsDir)
    ? readdirSync(assetsDir).some((name) => name.startsWith(`${prefix}-`) && name.endsWith(".js"))
    : false;
  if (!found) {
    fail(`Core build did not emit dist/assets/${prefix}-*.js`);
  }
}
requireFile(join(REACT_PACKAGE_DIR, "dist/index.mjs"), "React build did not emit dist/index.mjs");

console.log("Packing Core tarball...");
packPackage(CORE_PACKAGE_DIR, "lightfastgrid-core.tgz");

console.log("Packing React tarball...");
packPackage(REACT_PACKAGE_DIR, "lightfastgrid-react.tgz");

const packedHashes = {
  core: sha256File(CORE_TARBALL),
  react: sha256File(REACT_TARBALL),
};

const coreSource = JSON.parse(readFileSync(join(CORE_PACKAGE_DIR, "package.json"), "utf8"));
const packedCore = readTarballPackageJson(CORE_TARBALL);
if (packedCore.name !== "@lightfastgrid/core" || packedCore.version !== coreSource.version) {
  fail(
    `Packed Core identity mismatch: ${packedCore.name}@${packedCore.version} vs ${coreSource.version}`,
  );
}

const reactSource = JSON.parse(readFileSync(join(REACT_PACKAGE_DIR, "package.json"), "utf8"));
const packedReact = readTarballPackageJson(REACT_TARBALL);
const reactCoreDep = packedReact.dependencies?.["@lightfastgrid/core"];
if (packedReact.name !== "@lightfastgrid/react" || packedReact.version !== reactSource.version) {
  fail(
    `Packed React identity mismatch: ${packedReact.name}@${packedReact.version} vs ${reactSource.version}`,
  );
}
if (typeof reactCoreDep !== "string" || reactCoreDep.startsWith("workspace:")) {
  fail(
    `pnpm pack did not convert React's workspace Core dependency (found ${reactCoreDep})`,
  );
}
if (reactCoreDep !== packedCore.version) {
  fail(
    `Packed React depends on @lightfastgrid/core@${reactCoreDep}, expected exact ${packedCore.version}`,
  );
}

assertTarballUnchanged("Core", CORE_TARBALL, packedHashes.core);
assertTarballUnchanged("React", REACT_TARBALL, packedHashes.react);

console.log(`Packed ${CORE_TARBALL}`);
console.log(`Packed ${REACT_TARBALL}`);
console.log(
  `Packed React @${packedReact.version} depends on @lightfastgrid/core@${reactCoreDep}`,
);
console.log(`Core tarball sha256 ${packedHashes.core}`);
console.log(`React tarball sha256 ${packedHashes.react}`);

console.log("Refreshing isolated benchmark install from untouched tarballs...");
refreshBenchmarkInstall();

assertTarballUnchanged("Core", CORE_TARBALL, packedHashes.core);
assertTarballUnchanged("React", REACT_TARBALL, packedHashes.react);

console.log("Benchmark packages prepared.");
console.log("Tarballs were byte-for-byte unchanged from pack through install.");
