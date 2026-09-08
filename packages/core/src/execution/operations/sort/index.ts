/**
 * Sort operation module.
 *
 * Internal barrel for the sort {@link ExecutionOperation} wrapper.
 * Not re-exported from the package's public entry point.
 */

export { SORT_OPERATION_THRESHOLD, sortOperation } from "./sortOperation";
export { sortParityFixtures } from "./sortParityFixtures";
export type { SortOperationCache, SortOperationInput } from "./types";
