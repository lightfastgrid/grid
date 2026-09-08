#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release as osRelease, totalmem } from "node:os";
import { dirname, join } from "node:path";

import { readTarballPackageJson } from "./lib/tar.mjs";
import {
  APP_IDS,
  LANES,
  VANILLA_APP_IDS,
  appDir,
  CORE_TARBALL,
  REACT_TARBALL,
  REPO_ROOT,
  RESULTS_DIR,
  readCommand,
} from "./lib/paths.mjs";

function tryCommand(command, args, cwd = REPO_ROOT) {
  try {
    return readCommand(command, args, cwd);
  } catch {
    return null;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function gitState() {
  const commit = tryCommand("git", ["rev-parse", "HEAD"]);
  const dirty = Boolean(tryCommand("git", ["status", "--porcelain"]));
  return {
    commit,
    dirtyWorktree: dirty,
  };
}

function cpuModel() {
  return cpus()[0]?.model ?? null;
}

function packedVersions() {
  if (!existsSync(CORE_TARBALL) || !existsSync(REACT_TARBALL)) {
    return {
      core: null,
      react: null,
      reactDependsOnCore: null,
    };
  }
  const core = readTarballPackageJson(CORE_TARBALL);
  const react = readTarballPackageJson(REACT_TARBALL);
  return {
    core: `${core.name}@${core.version}`,
    react: `${react.name}@${react.version}`,
    reactDependsOnCore: react.dependencies?.["@lightfastgrid/core"] ?? null,
  };
}

function installedAgGridVersions() {
  return {
    react: {
      "ag-grid-react": readJson(join(appDir("ag-grid"), "package.json")).dependencies["ag-grid-react"],
      "ag-grid-community": readJson(join(appDir("ag-grid"), "package.json")).dependencies["ag-grid-community"],
    },
    vanilla: {
      "ag-grid-community": readJson(join(appDir("ag-grid-vanilla"), "package.json")).dependencies["ag-grid-community"],
    },
  };
}

const scenarios = readJson(join(REPO_ROOT, "benchmarks/shared/scenarios.json"));

const environment = {
  capturedAt: new Date().toISOString(),
  git: gitState(),
  os: {
    platform: process.platform,
    release: osRelease(),
    arch: process.arch,
  },
  cpu: {
    model: cpuModel(),
    logicalCount: cpus().length,
  },
  memory: {
    totalBytes: totalmem(),
  },
  node: process.version,
  pnpm: tryCommand("pnpm", ["--version"]),
  browser: {
    name: null,
    version: null,
    note: "Recorded in each runtime run directory when Playwright executes.",
  },
  packages: {
    lightfastgridPacked: packedVersions(),
    agGrid: installedAgGridVersions(),
    react: readJson(join(appDir("lightfastgrid"), "package.json")).dependencies.react,
    reactDom: readJson(join(appDir("lightfastgrid"), "package.json")).dependencies["react-dom"],
    vanillaReact: "n/a",
    vanillaReactDom: "n/a",
    vite: readJson(join(appDir("lightfastgrid"), "package.json")).devDependencies.vite,
    vanillaVite: readJson(join(appDir("lightfastgrid-vanilla"), "package.json")).devDependencies.vite,
  },
  scenarios: {
    seed: scenarios.seed,
    defaultScenario: scenarios.defaultScenario,
    dimensions: Object.fromEntries(
      Object.entries(scenarios.scenarios).map(([name, scenario]) => [
        name,
        {
          rowCount: scenario.rowCount,
          columnCount: scenario.columnCount,
          optIn: scenario.optIn,
          memoryIntensive: scenario.memoryIntensive,
        },
      ]),
    ),
  },
  apps: APP_IDS,
  buildModes: ["bundle", "runtime"],
  publicBundleFigures: "dist/bundle only; runtime protocol apps are excluded from published size totals",
  lanes: {
    react: LANES.react,
    vanilla: LANES.vanilla,
  },
  vanillaAppIds: VANILLA_APP_IDS,
};

mkdirSync(RESULTS_DIR, { recursive: true });
const outPath =
  process.env.LFG_BENCH_ENVIRONMENT_OUT || join(RESULTS_DIR, "environment.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(environment, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
