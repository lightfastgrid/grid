import type { LightFastGridColumnInput, RowData } from "@lightfastgrid/core";

import {
  GRID_DEMO_DATASET_MANIFEST_URL,
  GRID_DEMO_DATASET_URL,
} from "../schemas";

export const DEFAULT_GRID_DATASET_URL = GRID_DEMO_DATASET_URL;

export type GridDataset = {
  metadata: GridDatasetMetadata;
  rowData: RowData[];
  columnDefs: LightFastGridColumnInput[];
};

export interface GridDatasetMetadata {
  schema: string;
  rowCount: number;
  columnCount: number;
  seed: number;
  referenceDate: string;
  description: string;
  dataPolicy: string;
}

export interface GridDatasetManifestEntry {
  id: string;
  label: string;
  rowCount: number;
  file: string | null;
  delivery: "repository" | "generated-static" | "block";
  availability: "bundled" | "local-or-cdn" | "requires-block-loader";
}

export interface GridDatasetManifest {
  schema: string;
  defaultDatasetId: string;
  columnCount: number;
  datasets: GridDatasetManifestEntry[];
}

export function resolveGridDatasetUrl(file?: string): string {
  return file ? `/grid-demo/schemas/${encodeURIComponent(file)}` : DEFAULT_GRID_DATASET_URL;
}

function assertGridDataset(json: unknown, url: string): GridDataset {
  if (!json || typeof json !== "object") {
    throw new Error(`Invalid dataset at ${url}. Expected a JSON object.`);
  }

  const record = json as Record<string, unknown>;
  const metadata = record.gridDemo;

  if (!metadata || typeof metadata !== "object") {
    throw new Error("Invalid dataset shape. Expected gridDemo metadata.");
  }

  if (!Array.isArray(record.rowData)) {
    throw new Error("Invalid dataset shape. Expected rowData array.");
  }

  if (!Array.isArray(record.columnDefs) || record.columnDefs.length === 0) {
    throw new Error("Invalid dataset shape. Expected non-empty columnDefs.");
  }

  const metadataRecord = metadata as Record<string, unknown>;
  if (
    metadataRecord.rowCount !== record.rowData.length ||
    metadataRecord.columnCount !== record.columnDefs.length
  ) {
    throw new Error(
      "Invalid dataset shape. Metadata counts do not match dataset contents.",
    );
  }

  return {
    metadata: metadata as GridDatasetMetadata,
    rowData: record.rowData as RowData[],
    columnDefs: record.columnDefs as LightFastGridColumnInput[],
  };
}

/** Fetch a playground grid dataset from a public URL (not bundled). */
export async function loadGridDataset(
  url = resolveGridDatasetUrl(),
  options: { signal?: AbortSignal } = {},
): Promise<GridDataset> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(
      `Dataset fetch failed: ${response.status} ${response.statusText} at ${url}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error(
      `Dataset at ${url} did not return JSON (got "${contentType}").`,
    );
  }

  const json = (await response.json()) as unknown;
  return assertGridDataset(json, url);
}

export async function loadGridDatasetManifest(
  options: { signal?: AbortSignal } = {},
): Promise<GridDatasetManifest> {
  const response = await fetch(GRID_DEMO_DATASET_MANIFEST_URL, {
    cache: "no-store",
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(
      `Dataset manifest fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as unknown;
  if (!json || typeof json !== "object") {
    throw new Error("Invalid dataset manifest. Expected a JSON object.");
  }
  const manifest = json as Partial<GridDatasetManifest>;
  if (
    typeof manifest.defaultDatasetId !== "string" ||
    !Array.isArray(manifest.datasets)
  ) {
    throw new Error("Invalid dataset manifest shape.");
  }
  return manifest as GridDatasetManifest;
}
