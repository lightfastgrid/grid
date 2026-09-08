#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { gzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib";

import { BENCHMARK_ZLIB } from "../shared/vite.production.mjs";
import {
  APP_IDS,
  LANES,
  appDistDir,
  RESULTS_DIR,
  requireFile,
} from "./lib/paths.mjs";
import { assertBundleSizeReport } from "./lib/report-schema.mjs";
import {
  assertBuiltModeAssets,
  listFiles,
  isJs,
} from "./lib/bundle-integrity.mjs";

const GZIP_OPTIONS = { level: BENCHMARK_ZLIB.gzipLevel };
const BROTLI_OPTIONS = {
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: BENCHMARK_ZLIB.brotliQuality,
  },
};

function isCss(file) {
  return extname(file) === ".css";
}

function shouldMeasure(file) {
  if (file.endsWith(".map")) return false;
  return isJs(file) || isCss(file);
}

function compressedSizes(buffer) {
  return {
    raw: buffer.byteLength,
    gzip: gzipSync(buffer, GZIP_OPTIONS).byteLength,
    brotli: brotliCompressSync(buffer, BROTLI_OPTIONS).byteLength,
  };
}

function readManifest(distDir) {
  const manifestPath = join(distDir, ".vite/manifest.json");
  const legacyPath = join(distDir, "manifest.json");
  const path = [manifestPath, legacyPath].find((candidate) => {
    try {
      statSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!path) {
    throw new Error(`Vite manifest not found in ${distDir}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function collectGraph(manifest, key, seen, bucket) {
  if (!key || seen.has(key)) return;
  seen.add(key);
  const chunk = manifest[key];
  if (!chunk) return;
  if (chunk.file) bucket.add(chunk.file);
  for (const css of chunk.css ?? []) bucket.add(css);
  for (const imported of chunk.imports ?? []) {
    collectGraph(manifest, imported, seen, bucket);
  }
}

function classifyJavascript(distDir, manifest, jsFiles) {
  const initialRel = new Set();
  const lazyRel = new Set();
  const seenInitial = new Set();
  const seenLazy = new Set();

  for (const [key, chunk] of Object.entries(manifest)) {
    if (!chunk.isEntry) continue;
    const isHtmlEntry = key.endsWith(".html") || chunk.isEntry && key.includes("index.html");
    const isWorker = /worker/i.test(key) || /worker/i.test(chunk.file ?? "");
    if (isWorker) continue;
    if (isHtmlEntry || key.endsWith("index.html")) {
      collectGraph(manifest, key, seenInitial, initialRel);
      for (const dynamic of chunk.dynamicImports ?? []) {
        collectGraph(manifest, dynamic, seenLazy, lazyRel);
      }
    }
  }

  const initial = [];
  const lazyOrWorker = [];
  for (const file of jsFiles) {
    const rel = relative(distDir, file).split("\\").join("/");
    if (initialRel.has(rel)) initial.push(file);
    else lazyOrWorker.push(file);
  }
  return { initial, lazyOrWorker };
}

function sumSizes(files) {
  const totals = { raw: 0, gzip: 0, brotli: 0, files: files.length };
  for (const file of files) {
    const sizes = compressedSizes(readFileSync(file));
    totals.raw += sizes.raw;
    totals.gzip += sizes.gzip;
    totals.brotli += sizes.brotli;
  }
  return totals;
}

function measureApp(id) {
  const distDir = appDistDir(id, "bundle");
  requireFile(distDir, `${id} bundle production build`);
  const files = listFiles(distDir).filter(shouldMeasure);
  const jsFiles = files.filter(isJs);
  const cssFiles = files.filter(isCss);
  const manifest = readManifest(distDir);
  const classified = classifyJavascript(distDir, manifest, jsFiles);
  const js = sumSizes(jsFiles);
  const css = sumSizes(cssFiles);
  const initialJs = sumSizes(classified.initial);
  const lazyJs = sumSizes(classified.lazyOrWorker);
  return {
    appId: id,
    distDir: relative(process.cwd(), distDir),
    javascript: {
      rawBytes: js.raw,
      gzipBytes: js.gzip,
      brotliBytes: js.brotli,
      fileCount: js.files,
      initial: {
        rawBytes: initialJs.raw,
        gzipBytes: initialJs.gzip,
        brotliBytes: initialJs.brotli,
        fileCount: initialJs.files,
      },
      lazyOrWorker: {
        rawBytes: lazyJs.raw,
        gzipBytes: lazyJs.gzip,
        brotliBytes: lazyJs.brotli,
        fileCount: lazyJs.files,
      },
    },
    css: {
      rawBytes: css.raw,
      gzipBytes: css.gzip,
      brotliBytes: css.brotli,
      fileCount: css.files,
    },
    totalProductionPayload: {
      rawBytes: js.raw + css.raw,
      gzipBytes: js.gzip + css.gzip,
      brotliBytes: js.brotli + css.brotli,
    },
    emittedFileCount: {
      javascript: js.files,
      css: css.files,
    },
    notes: [
      "Sizes are per-file compressed then summed, matching typical HTTP transfer of separate assets.",
      "Measured from dist/bundle only. Runtime protocol apps are not included.",
      "Source maps, source fixtures, and generated datasets are not measured.",
      "npm tarball size is not a browser bundle size.",
    ],
  };
}

function incrementalEstimate(gridApp, baseline, baselineAppId) {
  const subtract = (grid, base) => Math.max(0, grid - base);
  return {
    label: "estimate derived by subtracting the matching framework baseline",
    isEstimate: true,
    baselineAppId,
    javascript: {
      rawBytes: subtract(gridApp.javascript.rawBytes, baseline.javascript.rawBytes),
      gzipBytes: subtract(gridApp.javascript.gzipBytes, baseline.javascript.gzipBytes),
      brotliBytes: subtract(gridApp.javascript.brotliBytes, baseline.javascript.brotliBytes),
    },
    css: {
      rawBytes: subtract(gridApp.css.rawBytes, baseline.css.rawBytes),
      gzipBytes: subtract(gridApp.css.gzipBytes, baseline.css.gzipBytes),
      brotliBytes: subtract(gridApp.css.brotliBytes, baseline.css.brotliBytes),
    },
    totalProductionPayload: {
      rawBytes: subtract(
        gridApp.totalProductionPayload.rawBytes,
        baseline.totalProductionPayload.rawBytes,
      ),
      gzipBytes: subtract(
        gridApp.totalProductionPayload.gzipBytes,
        baseline.totalProductionPayload.gzipBytes,
      ),
      brotliBytes: subtract(
        gridApp.totalProductionPayload.brotliBytes,
        baseline.totalProductionPayload.brotliBytes,
      ),
    },
  };
}

const applications = {};
for (const id of APP_IDS) {
  applications[id] = measureApp(id);
  assertBuiltModeAssets(id, "bundle");
}

const REACT_BUNDLE_MARKERS = [
  "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
  "react-dom.production",
  "react.production.min",
  "react-jsx-runtime",
];
for (const id of ["lightfastgrid-vanilla", "ag-grid-vanilla", "vanilla-baseline"]) {
  const distDir = appDistDir(id, "bundle");
  for (const file of listFiles(distDir).filter((path) => isJs(path) || extname(path) === ".css")) {
    const code = readFileSync(file, "utf8");
    for (const marker of REACT_BUNDLE_MARKERS) {
      if (code.includes(marker)) {
        throw new Error(
          `${id} bundle asset ${relative(distDir, file)} includes React runtime marker ${marker}`,
        );
      }
    }
  }
}

function laneReport(lane) {
  const baseline = applications[lane.baselineAppId];
  const incrementalGridEstimate = {};
  for (const gridAppId of lane.gridAppIds) {
    incrementalGridEstimate[gridAppId] = incrementalEstimate(
      applications[gridAppId],
      baseline,
      lane.baselineAppId,
    );
  }
  return {
    lane: lane.id,
    appIds: lane.appIds,
    baselineAppId: lane.baselineAppId,
    applications: Object.fromEntries(lane.appIds.map((id) => [id, applications[id]])),
    incrementalGridEstimate,
  };
}

const reactLane = laneReport(LANES.react);
const vanillaLane = laneReport(LANES.vanilla);

const report = {
  generatedAt: new Date().toISOString(),
  methodology: {
    buildMode: "bundle",
    minifier: "oxc",
    sourceMaps: false,
    viteManifest: true,
    target: "es2022",
    gzipLevel: BENCHMARK_ZLIB.gzipLevel,
    brotliQuality: BENCHMARK_ZLIB.brotliQuality,
    primaryResult: "complete application totals from dist/bundle",
    lanesAreIndependent:
      "React and Vanilla are separate comparison lanes. Never subtract across lanes or combine them into one percentage.",
    incrementalGridEstimate:
      "Labeled estimate only, nested under lanes.<lane>.incrementalGridEstimate. Always retain complete application totals as the primary result. Each estimate subtracts only the matching framework baseline.",
  },
  applications,
  lanes: {
    react: reactLane,
    vanilla: vanillaLane,
  },
};

assertBundleSizeReport(report);

mkdirSync(RESULTS_DIR, { recursive: true });
const outPath = join(RESULTS_DIR, "bundle-sizes.json");
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

const fingerprint = createHash("sha256")
  .update(JSON.stringify(report.applications))
  .digest("hex")
  .slice(0, 12);

console.log(`Wrote ${outPath}`);
console.log(`Application fingerprint ${fingerprint} (not a ranking)`);
console.log("Lanes are independent. Complete application totals are the primary result.");
for (const id of APP_IDS) {
  const app = applications[id];
  console.log(
    `${id}: js ${app.javascript.rawBytes} raw / ${app.javascript.gzipBytes} gzip / ${app.javascript.brotliBytes} brotli; css ${app.css.rawBytes} raw; total ${app.totalProductionPayload.rawBytes} raw (${app.emittedFileCount.javascript} js, ${app.emittedFileCount.css} css)`,
  );
}
