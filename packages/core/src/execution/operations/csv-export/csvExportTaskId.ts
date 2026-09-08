/**
 * CSV Export V1 - shared task-id predicate (Stage 4A).
 *
 * Consumed by the protocol validator and projection-chunk builder without
 * creating a circular dependency on protocol message types.
 */

/** True for 0 and positive safe integers only. */
export function isCsvExportTaskId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
