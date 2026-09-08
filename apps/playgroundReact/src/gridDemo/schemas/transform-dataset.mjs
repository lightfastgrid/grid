#!/usr/bin/env node
/* global Buffer, console, process */
/**
 * Transform the gridDemo static JSON into a LightFastGrid-ready dataset.
 *
 * Reads rowData + columnDefs, applies hooks in datasetTransforms.mjs, and
 * streams rowData to disk (safe for large files).
 *
 * Usage:
 *   node transform-dataset.mjs
 *   node transform-dataset.mjs --rows 1000
 *   node transform-dataset.mjs --rows 10000
 *   node transform-dataset.mjs --in ag-grid-100000x22-with-columns.json --rows 100000
 */

import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createGridDemoMetadata,
  transformColumnDefs,
  transformRow,
} from "./datasetTransforms.mjs";
import {
  buildGridDemoDatasetManifest,
  DEFAULT_GRID_DEMO_DATASET_PROFILE,
  findGridDemoDatasetProfile,
} from "./gridDemoDatasetProfiles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SOURCE_FILE = "ag-grid-100000x22-with-columns.json";
export const DEFAULT_OUTPUT_FILE = DEFAULT_GRID_DEMO_DATASET_PROFILE.file;
export const DATASET_MANIFEST_FILE = "grid-demo-datasets.json";
export const MAX_STATIC_DATASET_ROWS = 100_000;

/** @typedef {{ columnDefs?: unknown[]; rowData?: Record<string, unknown>[]; [key: string]: unknown }} DatasetSource */

export function parseArgs(argv) {
  const opts = {
    in: DEFAULT_SOURCE_FILE,
    out: null,
    rows: DEFAULT_GRID_DEMO_DATASET_PROFILE.rowCount,
    progressEvery: 10_000,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--in" && argv[i + 1]) opts.in = argv[++i];
    else if (arg === "--out" && argv[i + 1]) opts.out = argv[++i];
    else if ((arg === "--rows" || arg === "--limit") && argv[i + 1]) {
      opts.rows = Number(argv[++i]);
    }
    else if (arg === "--progress-every" && argv[i + 1]) {
      opts.progressEvery = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node transform-dataset.mjs [options]

Transforms gridDemo/schemas/*.json using datasetTransforms.mjs hooks.

Options:
  --in <file>           Source JSON in this folder (default: ${DEFAULT_SOURCE_FILE})
  --out <file>          Output JSON in this folder (derived from --rows by default)
  --rows <n>            Generate N rows (default: ${DEFAULT_GRID_DEMO_DATASET_PROFILE.rowCount})
  --limit <n>           Backward-compatible alias for --rows
  --progress-every <n>  Log row progress every N rows (default: 10000)
  --help                Show this help

Edit datasetTransforms.mjs to customize row and columnDefs transforms.
`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!Number.isSafeInteger(opts.rows) || opts.rows < 1) {
    console.error("--rows must be a positive safe integer");
    process.exit(1);
  }

  if (opts.rows > MAX_STATIC_DATASET_ROWS) {
    console.error(
      `Static JSON generation is capped at ${MAX_STATIC_DATASET_ROWS.toLocaleString()} rows. The 1M tier requires the block-loading demo path.`,
    );
    process.exit(1);
  }

  if (opts.out === null) {
    const profile = findGridDemoDatasetProfile(opts.rows);
    opts.out =
      profile?.file ??
      `lightfastgrid-customer-operations-${opts.rows}-rows.json`;
  }

  return opts;
}

/**
 * Stream `{ columnDefs, rowData }` to disk without holding the full JSON string.
 * @param {string} outPath
 * @param {{
 *   gridDemo?: Record<string, unknown>;
 *   columnDefs: unknown[];
 *   rowData?: Record<string, unknown>[];
 *   rowCount?: number;
 *   getRow?: (index: number) => Record<string, unknown>;
 * }} dataset
 * @param {{ progressEvery: number }} opts
 */
export async function writeGridDataset(outPath, dataset, opts) {
  const { columnDefs } = dataset;
  const rowCount = dataset.rowData?.length ?? dataset.rowCount ?? 0;
  const getRow = dataset.getRow ?? ((index) => dataset.rowData?.[index]);
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
    throw new Error("Dataset rowCount must be a non-negative safe integer.");
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const stream = fs.createWriteStream(outPath, { encoding: "utf8" });
  const started = Date.now();
  let bytesWritten = 0;

  const write = async (chunk) => {
    const canContinue = stream.write(chunk);
    bytesWritten += Buffer.byteLength(chunk, "utf8");
    if (!canContinue) await once(stream, "drain");
  };

  await write("{\n");
  if (dataset.gridDemo) {
    await write(`  "gridDemo": ${JSON.stringify(dataset.gridDemo, null, 2).replace(/\n/g, "\n  ")},\n`);
  }
  // Pretty-print columnDefs so declarative shells (e.g. actions) are readable in the static JSON.
  const columnDefsJson = JSON.stringify(columnDefs, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join("\n");
  await write(`  "columnDefs": ${columnDefsJson},\n`);
  await write('  "rowData": [\n');

  for (let i = 0; i < rowCount; i++) {
    const row = getRow(i);
    if (!row || typeof row !== "object") {
      throw new Error(`Dataset row ${i} is missing or invalid.`);
    }
    if (i > 0) await write(",\n");
    await write("    ");
    await write(JSON.stringify(row));
    if (
      opts.progressEvery > 0 &&
      (i + 1) % opts.progressEvery === 0
    ) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const rate = Math.round(((i + 1) / (Date.now() - started)) * 1000);
      process.stderr.write(
        `\r  ${(((i + 1) / rowCount) * 100).toFixed(1)}% — ${(i + 1).toLocaleString()} / ${rowCount.toLocaleString()} rows (${rate.toLocaleString()} rows/s, ${elapsed}s)`,
      );
    }
  }

  await write("\n  ]\n}\n");

  return new Promise((resolve, reject) => {
    stream.end(() => {
      if (opts.progressEvery > 0 && rowCount > 0) process.stderr.write("\n");
      resolve({ bytesWritten, elapsedMs: Date.now() - started, rowCount });
    });
    stream.on("error", reject);
  });
}

export async function runTransform(argv = process.argv) {
  const opts = parseArgs(argv);
  const inPath = path.resolve(__dirname, opts.in);
  const outPath = path.resolve(__dirname, opts.out);

  if (!fs.existsSync(inPath)) {
    console.error(`Input not found: ${inPath}`);
    process.exit(1);
  }

  console.log(`Reading ${inPath}…`);
  const readStarted = Date.now();
  /** @type {DatasetSource} */
  const source = JSON.parse(fs.readFileSync(inPath, "utf8"));

  if (!Array.isArray(source.rowData)) {
    console.error("Input JSON must contain a rowData array.");
    process.exit(1);
  }
  if (source.rowData.length === 0) {
    console.error("Input JSON must contain at least one source row.");
    process.exit(1);
  }
  if (!Array.isArray(source.columnDefs) || source.columnDefs.length === 0) {
    console.error("Input JSON must contain a non-empty columnDefs array.");
    process.exit(1);
  }

  const readMs = Date.now() - readStarted;

  console.log(
    `Loaded ${source.rowData.length.toLocaleString()} source rows in ${(readMs / 1000).toFixed(1)}s`,
  );

  const columnDefs = transformColumnDefs(source.columnDefs);
  const gridDemo = createGridDemoMetadata(columnDefs, opts.rows);
  const transformed = {
    gridDemo,
    columnDefs,
    rowCount: opts.rows,
    getRow(index) {
      const sourceRow = source.rowData[index % source.rowData.length];
      return transformRow(sourceRow, index, source);
    },
  };

  const manifestPath = path.resolve(__dirname, DATASET_MANIFEST_FILE);
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(buildGridDemoDatasetManifest(columnDefs.length), null, 2)}\n`,
    "utf8",
  );

  console.log(`Writing ${outPath}…`);
  const result = await writeGridDataset(outPath, transformed, opts);

  const mb = (result.bytesWritten / (1024 * 1024)).toFixed(1);
  console.log(
    `Done: ${result.rowCount.toLocaleString()} rows, ${mb} MB, ${(result.elapsedMs / 1000).toFixed(1)}s write`,
  );

  return { inPath, outPath, manifestPath, ...result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runTransform().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
