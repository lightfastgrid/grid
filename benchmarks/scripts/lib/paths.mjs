import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(here, "../../..");
export const BENCHMARKS_ROOT = resolve(here, "../..");
export const ARTIFACTS_DIR = resolve(BENCHMARKS_ROOT, "artifacts");
export const RESULTS_DIR = resolve(BENCHMARKS_ROOT, "results");
export const CORE_PACKAGE_DIR = resolve(REPO_ROOT, "packages/core");
export const REACT_PACKAGE_DIR = resolve(REPO_ROOT, "packages/react");
export const CORE_TARBALL = resolve(ARTIFACTS_DIR, "lightfastgrid-core.tgz");
export const REACT_TARBALL = resolve(ARTIFACTS_DIR, "lightfastgrid-react.tgz");

export const REACT_APP_IDS = ["lightfastgrid", "ag-grid", "react-baseline"];
export const VANILLA_APP_IDS = [
  "lightfastgrid-vanilla",
  "ag-grid-vanilla",
  "vanilla-baseline",
];
export const APP_IDS = [...REACT_APP_IDS, ...VANILLA_APP_IDS];
export const LIGHTFASTGRID_APP_IDS = ["lightfastgrid", "lightfastgrid-vanilla"];
export const RUNTIME_GRID_APP_IDS = [
  "lightfastgrid",
  "ag-grid",
  "lightfastgrid-vanilla",
  "ag-grid-vanilla",
];
export const RUNTIME_RESULTS_DIR = resolve(RESULTS_DIR, "runtime");
export const LANES = {
  react: {
    id: "react",
    appIds: REACT_APP_IDS,
    baselineAppId: "react-baseline",
    gridAppIds: ["lightfastgrid", "ag-grid"],
  },
  vanilla: {
    id: "vanilla",
    appIds: VANILLA_APP_IDS,
    baselineAppId: "vanilla-baseline",
    gridAppIds: ["lightfastgrid-vanilla", "ag-grid-vanilla"],
  },
};

export function appDir(id) {
  return resolve(BENCHMARKS_ROOT, "apps", id);
}

export function appDistDir(id, buildMode = "bundle") {
  return resolve(appDir(id), "dist", buildMode);
}

export const BUILD_MODES = ["bundle", "runtime"];

export function run(command, args, cwd, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd,
      stdio: options.stdio ?? "inherit",
      encoding: "utf8",
      env: options.env ?? process.env,
    });
  } catch (error) {
    const extra = error.stderr ? `\n${error.stderr}` : "";
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}${extra}`,
      { cause: error },
    );
  }
}

export function runPnpm(args, cwd = REPO_ROOT, options = {}) {
  return run("pnpm", args, cwd, options);
}

export function runPnpmInBenchmarks(args, options = {}) {
  return run("pnpm", args, BENCHMARKS_ROOT, options);
}

export function readCommand(command, args, cwd = REPO_ROOT) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function requireFile(path, hint) {
  if (!existsSync(path)) {
    throw new Error(`${hint}: missing ${path}`);
  }
}
