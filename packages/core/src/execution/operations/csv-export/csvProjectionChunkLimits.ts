/**
 * CSV Export V1 - binding wire limits for projection chunks (Stage 4A).
 *
 * Single ownership location consumed by the chunk builder and protocol
 * validator. Avoids a circular dependency with protocol message types.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 18–19.
 */

export const CSV_CHUNK_MAX_ESTIMATED_BYTES = 64 * 1024;
export const CSV_CHUNK_MAX_VALUES = 4096;
export const CSV_CHUNK_MAX_COMPLETED_ROWS = 256;

export interface CsvProjectionChunkLimits {
  maxEstimatedBytes: number;
  maxValues: number;
  maxCompletedRows: number;
}

function sanitizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}

/**
 * Resolve builder limits. Invalid values fall back to production defaults.
 * Positive overrides may tighten limits but never raise them above the binding
 * wire maxima.
 */
export function resolveCsvProjectionChunkLimits(
  limits?: Partial<CsvProjectionChunkLimits>,
): CsvProjectionChunkLimits {
  return {
    maxEstimatedBytes: Math.min(
      sanitizePositiveInteger(
        limits?.maxEstimatedBytes,
        CSV_CHUNK_MAX_ESTIMATED_BYTES,
      ),
      CSV_CHUNK_MAX_ESTIMATED_BYTES,
    ),
    maxValues: Math.min(
      sanitizePositiveInteger(limits?.maxValues, CSV_CHUNK_MAX_VALUES),
      CSV_CHUNK_MAX_VALUES,
    ),
    maxCompletedRows: Math.min(
      sanitizePositiveInteger(
        limits?.maxCompletedRows,
        CSV_CHUNK_MAX_COMPLETED_ROWS,
      ),
      CSV_CHUNK_MAX_COMPLETED_ROWS,
    ),
  };
}
