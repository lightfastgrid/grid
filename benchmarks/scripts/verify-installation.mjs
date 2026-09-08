#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { readTarballPackageJson } from "./lib/tar.mjs";
import {
  CORE_PACKAGE_DIR,
  CORE_TARBALL,
  REACT_PACKAGE_DIR,
  REACT_TARBALL,
  REPO_ROOT,
  VANILLA_APP_IDS,
  appDir,
  requireFile,
  run,
} from "./lib/paths.mjs";

const REQUIRED_CORE_WORKERS = [
  "csvExportWorker",
  "filterWorker",
  "quickSearchWorker",
  "sortWorker",
];
const ABSOLUTE_WORKER_URL = /new URL\((["'])\/assets\/[^"']+Worker-[^"']+\.js\1/;
const ESM_WORKER_URL =
  /new URL\((["'])([^"']+Worker-[^"']+\.js)\1,\s*import\.meta\.url\)/g;
const CJS_WORKER_URL =
  /new URL\((["'])([^"']+Worker-[^"']+\.js)\1,\s*require\("url"\)\.pathToFileURL\(__dirname\s*\+\s*["']\/["']\)\.href\)/g;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

requireFile(CORE_TARBALL, "Packed Core tarball");
requireFile(REACT_TARBALL, "Packed React tarball");

const packedCore = readTarballPackageJson(CORE_TARBALL);
const packedReact = readTarballPackageJson(REACT_TARBALL);
const reactCoreDep = packedReact.dependencies?.["@lightfastgrid/core"];

if (packedCore.name !== "@lightfastgrid/core") {
  fail(`Packed Core name is ${packedCore.name}`);
}
if (packedReact.name !== "@lightfastgrid/react") {
  fail(`Packed React name is ${packedReact.name}`);
}
if (typeof reactCoreDep !== "string" || reactCoreDep.startsWith("workspace:")) {
  fail(`Packed React still uses a workspace Core dependency: ${reactCoreDep}`);
}
if (reactCoreDep !== packedCore.version) {
  fail(
    `Packed React depends on @lightfastgrid/core@${reactCoreDep}, expected exact ${packedCore.version}`,
  );
}

const appRoot = appDir("lightfastgrid");
const appManifest = readJson(join(appRoot, "package.json"));
if (appManifest.dependencies["@lightfastgrid/core"] !== "file:../../artifacts/lightfastgrid-core.tgz") {
  fail("LightFastGrid app must depend on file:../../artifacts/lightfastgrid-core.tgz");
}
if (appManifest.dependencies["@lightfastgrid/react"] !== "file:../../artifacts/lightfastgrid-react.tgz") {
  fail("LightFastGrid app must depend on file:../../artifacts/lightfastgrid-react.tgz");
}

function assertInstalledPackage(packageName, sourceDir) {
  const declared = join(appRoot, "node_modules", packageName);
  if (!existsSync(declared)) {
    fail(`${packageName} is not installed in ${declared}`);
  }
  const real = realpathSync(declared);
  if (isInside(real, sourceDir)) {
    fail(
      `${packageName} resolved to workspace source ${real}. The benchmark app must use the packed tarball.`,
    );
  }
  if (isInside(real, join(REPO_ROOT, "packages"))) {
    fail(`${packageName} resolved under packages/: ${real}`);
  }
  if (!real.includes(`${sep}node_modules${sep}`) && !real.includes(`${sep}.pnpm${sep}`)) {
    fail(`${packageName} realpath is not an installed node_modules copy: ${real}`);
  }
  const installed = readJson(join(real, "package.json"));
  const stat = lstatSync(declared);
  return { real, installed, symlink: stat.isSymbolicLink() };
}

const coreInstall = assertInstalledPackage("@lightfastgrid/core", CORE_PACKAGE_DIR);
const reactInstall = assertInstalledPackage("@lightfastgrid/react", REACT_PACKAGE_DIR);

if (coreInstall.installed.version !== packedCore.version) {
  fail(
    `Installed Core ${coreInstall.installed.version} != packed ${packedCore.version}`,
  );
}
if (reactInstall.installed.version !== packedReact.version) {
  fail(
    `Installed React ${reactInstall.installed.version} != packed ${packedReact.version}`,
  );
}
if (reactInstall.installed.dependencies?.["@lightfastgrid/core"] !== packedCore.version) {
  fail(
    `Installed React depends on ${reactInstall.installed.dependencies?.["@lightfastgrid/core"]}, expected ${packedCore.version}`,
  );
}

if (!existsSync(join(coreInstall.real, "dist/index.mjs"))) {
  fail("Installed Core is missing dist/index.mjs");
}
if (!existsSync(join(coreInstall.real, "dist/themes/default.css"))) {
  fail("Installed Core is missing dist/themes/default.css");
}
if (!existsSync(join(reactInstall.real, "dist/index.mjs"))) {
  fail("Installed React is missing dist/index.mjs");
}

function listTarball(tarballPath) {
  return run("tar", ["-tzf", tarballPath], process.cwd(), {
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .split("\n");
}

function collectJs(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJs(path, acc);
      continue;
    }
    if (/\.(mjs|cjs|js)$/.test(entry.name)) acc.push(path);
  }
  return acc;
}

function assertTarballWorkers(tarballPath, label) {
  const entries = listTarball(tarballPath);
  for (const prefix of REQUIRED_CORE_WORKERS) {
    if (
      !entries.some((entry) =>
        new RegExp(`/dist/assets/${prefix}-[^/]+\\.js$`).test(entry),
      )
    ) {
      fail(`${label} tarball is missing dist/assets/${prefix}-*.js`);
    }
  }
}

function assertInstalledWorkerSurface(packageRoot, label) {
  const assetsDir = join(packageRoot, "dist/assets");
  if (!existsSync(assetsDir)) {
    fail(`${label} is missing dist/assets`);
  }
  const assetFiles = readdirSync(assetsDir).filter((name) =>
    /Worker-[A-Za-z0-9_-]+\.js$/.test(name),
  );
  for (const prefix of REQUIRED_CORE_WORKERS) {
    if (!assetFiles.some((name) => name.startsWith(`${prefix}-`))) {
      fail(`${label} is missing ${prefix}-*.js in dist/assets`);
    }
  }

  const referenced = new Set();
  for (const file of collectJs(join(packageRoot, "dist"))) {
    const code = readFileSync(file, "utf8");
    if (/\{\}\.url/.test(code) || /new URL\([^)]*"undefined"/.test(code)) {
      fail(
        `${label} ${relative(packageRoot, file)} uses an invalid Worker URL base ({}.url or "undefined")`,
      );
    }
    if (ABSOLUTE_WORKER_URL.test(code)) {
      fail(
        `${label} ${relative(packageRoot, file)} uses site-root /assets/ Worker URLs`,
      );
    }
    if (
      file.endsWith(".mjs") &&
      /new URL\((["'])[^"']+Worker-[^"']+\.js\1,\s*""\+import\.meta\.url/.test(code)
    ) {
      fail(
        `${label} ${relative(packageRoot, file)} ESM Worker URLs must use import.meta.url so consumer bundlers emit Worker assets`,
      );
    }
    const pattern = file.endsWith(".cjs") ? CJS_WORKER_URL : ESM_WORKER_URL;
    for (const match of code.matchAll(pattern)) {
      const url = match[2];
      if (url.startsWith("/")) {
        fail(`${label} ${file} uses absolute Worker URL ${url}`);
      }
      const resolved = resolve(dirname(file), url);
      if (!existsSync(resolved)) {
        fail(
          `${label} Worker URL ${url} from ${relative(packageRoot, file)} does not exist at ${resolved}`,
        );
      }
      referenced.add(basename(resolved));
    }
  }
  for (const prefix of REQUIRED_CORE_WORKERS) {
    if (![...referenced].some((name) => name.startsWith(`${prefix}-`))) {
      fail(`${label} dist JS does not reference ${prefix} with a package-relative URL`);
    }
  }
}

assertTarballWorkers(CORE_TARBALL, "Packed Core");
assertInstalledWorkerSurface(coreInstall.real, "Installed Core");

console.log("LightFastGrid tarball boundary verified:");
console.log(`  packed Core ${packedCore.version}`);
console.log(`  packed React ${packedReact.version} -> core ${reactCoreDep}`);
console.log(`  installed Core ${coreInstall.real}`);
console.log(`  installed React ${reactInstall.real}`);
console.log("  packed Core Worker assets are present with package-relative URLs");

const REACT_RUNTIME_PACKAGES = [
  "react",
  "react-dom",
  "@types/react",
  "@types/react-dom",
  "@vitejs/plugin-react",
];

function declaredDeps(manifest) {
  return {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
}

function assertNoDeclaredPackages(appId, packageNames) {
  const manifest = readJson(join(appDir(appId), "package.json"));
  const declared = declaredDeps(manifest);
  for (const name of packageNames) {
    if (name in declared) {
      fail(`${appId} must not declare ${name} (found ${declared[name]})`);
    }
  }
  for (const name of packageNames) {
    const nested = join(appDir(appId), "node_modules", name);
    if (existsSync(nested)) {
      fail(`${appId} has ${name} installed at ${nested}`);
    }
  }
}

function assertVanillaSourcesUseNeutralEntry(appId) {
  const srcDir = join(appDir(appId), "src");
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(path);
    }
  };
  visit(srcDir);
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    if (/from\s+["']@lfg-benchmarks\/shared["']/.test(code)) {
      fail(
        `${appId} ${relative(srcDir, file)} imports @lfg-benchmarks/shared. Vanilla apps must import @lfg-benchmarks/shared/neutral or @lfg-benchmarks/shared/bundle so React is not pulled into the bundle.`,
      );
    }
    if (/from\s+["']@lfg-benchmarks\/shared\/react-shell["']/.test(code)) {
      fail(
        `${appId} ${relative(srcDir, file)} imports @lfg-benchmarks/shared/react-shell. Vanilla apps must not import React shell modules.`,
      );
    }
  }
}

function assertInstalledPackageInApp(appId, packageName, sourceDir) {
  const declared = join(appDir(appId), "node_modules", packageName);
  if (!existsSync(declared)) {
    fail(`${packageName} is not installed in ${declared}`);
  }
  const real = realpathSync(declared);
  if (sourceDir && isInside(real, sourceDir)) {
    fail(
      `${appId} ${packageName} resolved to workspace source ${real}. The benchmark app must use the packed tarball.`,
    );
  }
  if (isInside(real, join(REPO_ROOT, "packages"))) {
    fail(`${appId} ${packageName} resolved under packages/: ${real}`);
  }
  if (!real.includes(`${sep}node_modules${sep}`) && !real.includes(`${sep}.pnpm${sep}`)) {
    fail(`${appId} ${packageName} realpath is not an installed node_modules copy: ${real}`);
  }
  const installed = readJson(join(real, "package.json"));
  return { real, installed, symlink: lstatSync(declared).isSymbolicLink() };
}

const vanillaLfgManifest = readJson(join(appDir("lightfastgrid-vanilla"), "package.json"));
if (
  vanillaLfgManifest.dependencies["@lightfastgrid/core"] !==
  "file:../../artifacts/lightfastgrid-core.tgz"
) {
  fail("LightFastGrid Vanilla must depend on file:../../artifacts/lightfastgrid-core.tgz");
}
if (vanillaLfgManifest.dependencies["@lightfastgrid/react"]) {
  fail("LightFastGrid Vanilla must not depend on @lightfastgrid/react");
}

const vanillaCore = assertInstalledPackageInApp(
  "lightfastgrid-vanilla",
  "@lightfastgrid/core",
  CORE_PACKAGE_DIR,
);
if (vanillaCore.installed.version !== packedCore.version) {
  fail(
    `Vanilla installed Core ${vanillaCore.installed.version} != packed ${packedCore.version}`,
  );
}
if (!existsSync(join(vanillaCore.real, "dist/themes/default.css"))) {
  fail("Vanilla installed Core is missing dist/themes/default.css");
}
assertInstalledWorkerSurface(vanillaCore.real, "Vanilla installed Core");

const agGridReactManifest = readJson(join(appDir("ag-grid"), "package.json"));
const agGridVanillaManifest = readJson(join(appDir("ag-grid-vanilla"), "package.json"));
if (agGridReactManifest.dependencies["ag-grid-community"] !== "36.1.0") {
  fail("AG Grid React must lock ag-grid-community to 36.1.0");
}
if (agGridVanillaManifest.dependencies["ag-grid-community"] !== "36.1.0") {
  fail("AG Grid Vanilla must lock ag-grid-community to 36.1.0");
}
if (agGridVanillaManifest.dependencies["ag-grid-react"]) {
  fail("AG Grid Vanilla must not depend on ag-grid-react");
}
if (agGridVanillaManifest.dependencies["ag-grid-enterprise"]) {
  fail("AG Grid Vanilla must not depend on ag-grid-enterprise");
}

const agGridVanillaInstall = assertInstalledPackageInApp(
  "ag-grid-vanilla",
  "ag-grid-community",
  null,
);
if (agGridVanillaInstall.installed.version !== "36.1.0") {
  fail(
    `AG Grid Vanilla resolved ag-grid-community@${agGridVanillaInstall.installed.version}, expected 36.1.0`,
  );
}

const vanillaBaselineManifest = readJson(join(appDir("vanilla-baseline"), "package.json"));
for (const name of [
  "@lightfastgrid/core",
  "@lightfastgrid/react",
  "ag-grid-community",
  "ag-grid-react",
  "ag-grid-enterprise",
]) {
  if (vanillaBaselineManifest.dependencies?.[name] || vanillaBaselineManifest.devDependencies?.[name]) {
    fail(`Vanilla baseline must not depend on ${name}`);
  }
}

for (const appId of VANILLA_APP_IDS) {
  assertNoDeclaredPackages(appId, REACT_RUNTIME_PACKAGES);
  assertVanillaSourcesUseNeutralEntry(appId);
}

console.log("Vanilla lane installation verified:");
console.log(`  installed Vanilla Core ${vanillaCore.real}`);
console.log(`  installed AG Grid Community ${agGridVanillaInstall.real}`);
console.log("  Vanilla apps do not declare React or ReactDOM");
console.log("  Vanilla sources import @lfg-benchmarks/shared/neutral or /bundle");
