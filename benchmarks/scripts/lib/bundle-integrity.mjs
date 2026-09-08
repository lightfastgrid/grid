import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import { isForbiddenVanillaModuleId } from "../../shared/vite.app.mjs";
import {
  LIGHTFASTGRID_APP_IDS,
  VANILLA_APP_IDS,
  appDistDir,
} from "./paths.mjs";

export const REQUIRED_LFG_CONSUMER_WORKERS = [
  "sortWorker",
  "filterWorker",
  "quickSearchWorker",
];
const CONSUMER_WORKER_URL =
  /new URL\((["'`])([^"'`]+)\1\s*,\s*(?:""\+|``\+)?import\.meta\.url\)/g;

export function listFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(path, acc);
      continue;
    }
    acc.push(path);
  }
  return acc;
}

export function isJs(file) {
  return [".js", ".mjs", ".cjs"].includes(extname(file));
}

function resolveConsumerWorkerUrl(distDir, fromFile, spec) {
  if (spec.startsWith("/")) {
    return resolve(distDir, spec.replace(/^\//, ""));
  }
  return resolve(dirname(fromFile), spec);
}

export function assertLightFastGridWorkerAssets(distDir, files) {
  const jsFiles = files.filter(isJs);
  const referenced = [];
  for (const file of jsFiles) {
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(CONSUMER_WORKER_URL)) {
      const spec = match[2];
      if (!/Worker/i.test(spec)) continue;
      const resolved = resolveConsumerWorkerUrl(distDir, file, spec);
      if (!existsSync(resolved)) {
        throw new Error(
          `LightFastGrid Worker URL ${spec} from ${relative(distDir, file)} does not resolve to an emitted file (${resolved}). ` +
            "Comparison numbers are not publishable without intact Worker assets.",
        );
      }
      referenced.push(basename(resolved));
    }
  }
  const missing = REQUIRED_LFG_CONSUMER_WORKERS.filter(
    (prefix) => !referenced.some((name) => name.includes(prefix)),
  );
  if (missing.length > 0) {
    throw new Error(
      `LightFastGrid production dist is missing Worker assets (${missing.join(", ")}). ` +
        "Packed Core must address Workers with package-relative import.meta.url so Vite emits them. " +
        "Comparison numbers are not publishable without these files.",
    );
  }
}

export function assertProtocolMarker(distDir, { present, label }) {
  const jsFiles = listFiles(distDir).filter(isJs);
  const found = jsFiles.some((file) =>
    readFileSync(file, "utf8").includes("__GRID_BENCHMARK__"),
  );
  if (present && !found) {
    throw new Error(`${label} production JS does not install window.__GRID_BENCHMARK__`);
  }
  if (!present && found) {
    throw new Error(
      `${label} production JS contains __GRID_BENCHMARK__. Bundle-mode public sizes must not include the runtime protocol.`,
    );
  }
}

export function assertEntryModules(id, buildMode, distDir) {
  const expected = buildMode === "bundle" ? "bundle-main" : "runtime-main";
  const forbidden = buildMode === "bundle" ? "runtime-main" : "bundle-main";
  if (buildMode === "bundle") {
    const inventoryPath = join(distDir, "module-inventory.json");
    if (!existsSync(inventoryPath)) {
      throw new Error(`${id} ${buildMode} is missing module-inventory.json`);
    }
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    const ids = (inventory.modules ?? []).map((entry) => String(entry.moduleId));
    if (!ids.some((moduleId) => moduleId.includes(`${expected}.`))) {
      throw new Error(`${id} ${buildMode} module inventory does not include ${expected}`);
    }
    if (ids.some((moduleId) => moduleId.includes(`${forbidden}.`))) {
      throw new Error(`${id} ${buildMode} module inventory includes ${forbidden}`);
    }
  }
}

export function assertVanillaModuleInventory(appId, distDir) {
  const inventoryPath = join(distDir, "module-inventory.json");
  if (!existsSync(inventoryPath)) {
    throw new Error(`${appId} bundle is missing module-inventory.json`);
  }
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  if (!Array.isArray(inventory.modules) || inventory.modules.length === 0) {
    throw new Error(`${appId} module inventory is empty`);
  }
  for (const entry of inventory.modules) {
    if (isForbiddenVanillaModuleId(entry.moduleId)) {
      throw new Error(
        `${appId} bundle module inventory includes forbidden package ${entry.moduleId} in ${entry.fileName}`,
      );
    }
  }
}

export function assertBuiltModeAssets(id, buildMode) {
  const distDir = appDistDir(id, buildMode);
  const files = listFiles(distDir);
  if (buildMode === "bundle") {
    assertProtocolMarker(distDir, { present: false, label: `${id} bundle` });
    assertEntryModules(id, buildMode, distDir);
    if (VANILLA_APP_IDS.includes(id)) {
      assertVanillaModuleInventory(id, distDir);
    }
  } else {
    assertProtocolMarker(distDir, { present: true, label: `${id} runtime` });
  }
  if (LIGHTFASTGRID_APP_IDS.includes(id)) {
    assertLightFastGridWorkerAssets(
      distDir,
      files.filter((file) => isJs(file) || extname(file) === ".css"),
    );
  }
}
