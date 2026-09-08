import {
  buildFilterFieldTypedValueCache,
  type FieldBooleanCache,
  type FieldCache,
  type FieldDateCache,
  type FieldNumberCache,
  type FieldTextCache,
} from "../../../features/filters/filterTypedValueCache";
import type { NormalizedColumnFilterConfig } from "../../../features/filters/types";
import type { ColumnFilterModel, FilterModel, RowData } from "../../../types";
import { resolveDotPath } from "../../../utils/resolveDotPath";

import type { WorkerFilterEligibility } from "./filterWorkerEligibility";

// ── Payload field cache shapes (structured-clone-safe) ───────

export type WorkerFilterTextFieldCache = FieldTextCache;
export type WorkerFilterNumberFieldCache = FieldNumberCache;
export type WorkerFilterDateFieldCache = FieldDateCache;
export type WorkerFilterBooleanFieldCache = FieldBooleanCache;
export type WorkerFilterFieldCache = FieldCache;

export interface WorkerFilterFieldEntry {
  field: string;
  model: ColumnFilterModel;
  cache: WorkerFilterFieldCache;
}

export interface WorkerFilterPayload {
  rowCount: number;
  sourceIndexes: Uint32Array | null;
  fields: WorkerFilterFieldEntry[];
}

// ── Payload builder ──────────────────────────────────────────

export function buildWorkerFilterPayload(
  rows: RowData[],
  filterModel: FilterModel,
  _columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>,
  eligibility: WorkerFilterEligibility,
  sourceIndexes?: readonly number[] | Uint32Array,
): WorkerFilterPayload | null {
  if (!eligibility.eligible) return null;

  const rowCount = rows.length;
  const scanIdxs = sourceIndexes
    ? (sourceIndexes instanceof Uint32Array
        ? sourceIndexes
        : new Uint32Array(sourceIndexes))
    : null;

  const fields: WorkerFilterFieldEntry[] = [];

  for (const entry of eligibility.fields) {
    const { field, config } = entry;
    const model = filterModel[field];
    if (!model) continue;

    const fieldParts = field.includes(".") ? field.split(".") : null;
    const cache = buildFilterFieldTypedValueCache({
      rows,
      field,
      config,
      readValue: (row, _rowIndex, valueField) => readValue(row, valueField, fieldParts),
      sourceIndexes: scanIdxs,
    });

    fields.push({ field, model, cache });
  }

  if (fields.length === 0) return null;

  return { rowCount, sourceIndexes: scanIdxs, fields };
}

function readValue(row: RowData, field: string, parts: string[] | null): unknown {
  return parts ? resolveDotPath(row, parts) : row[field];
}
