/**
 * Execution operation registry.
 *
 * Central list of {@link ExecutionOperation} implementations routed
 * through the generic execution pipeline. Generic test suites (e.g.
 * main-thread/worker parity) iterate this list so new operations are
 * covered automatically; filter/search/formula register here as they
 * are built.
 */

import { filterOperation } from "./filter";
import { quickSearchOperation } from "./quick-search";
import { sortOperation } from "./sort";

export const executionOperations = [
  sortOperation,
  filterOperation,
  quickSearchOperation,
] as const;
