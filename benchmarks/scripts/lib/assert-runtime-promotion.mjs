import { assertMergedRuntimeReport } from "../../tests/performance/metrics/schema.ts";
import {
  CANONICAL_PUBLIC_COLUMN_COUNT,
  CANONICAL_PUBLIC_ROW_COUNT,
  CANONICAL_PUBLIC_SCENARIO_NAME,
} from "../../shared/src/canonicalPublicScenario.ts";
import {
  FILTER_CLEAR_OPERATIONS,
  FILTER_SCHEDULED_OPERATIONS,
} from "../../shared/src/filterScenarios.ts";

export function collectFilterProducerPromotionReasons(comparison) {
  const reasons = [];
  if (!comparison?.lanes) return reasons;
  for (const [laneName, lane] of Object.entries(comparison.lanes)) {
    if (!lane || typeof lane !== "object") continue;
    for (const operation of FILTER_CLEAR_OPERATIONS) {
      const lfg = lane[operation]?.lightfastgrid;
      if (!lfg) continue;
      if (lfg.workerRouteConfirmed === true) {
        reasons.push(`${laneName} ${operation} must not confirm a Filter Worker route for Clear`);
      }
      if ((lfg.producerDistribution?.worker ?? 0) > 0) {
        reasons.push(
          `${laneName} ${operation} must not treat Clear as Filter Worker evidence`,
        );
      }
    }
    for (const operation of FILTER_SCHEDULED_OPERATIONS) {
      const lfg = lane[operation]?.lightfastgrid;
      if (!lfg) continue;
      const dist = lfg.producerDistribution ?? {};
      if ((dist.unknown ?? 0) > 0 || (lfg.validSampleCount > 0 && (dist.worker ?? 0) + (dist.mainThread ?? 0) + (dist.cache ?? 0) === 0)) {
        reasons.push(`${laneName} ${operation} is missing direct producer evidence`);
      }
    }
  }
  return reasons;
}

export function assertPromotableRuntimeArtifact(summary, environment, expected) {
  const reasons = [];
  const push = (reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  if (summary.profile !== "publish-native") {
    push(`profile must be publish-native for primary Worker comparisons, got ${summary.profile}`);
  }
  if (summary.publishable !== true) push("publishable must be true");
  if (summary.complete !== true) push("complete must be true");
  if (environment?.git?.dirtyWorktree) push("worktree must be clean and committed");
  const rowCount = expected?.rowCount ?? environment?.rowCount;
  const columnCount = expected?.columnCount ?? environment?.columnCount;
  const scenario = expected?.scenario ?? summary.methodology?.scenario;
  if (
    scenario !== CANONICAL_PUBLIC_SCENARIO_NAME ||
    rowCount !== CANONICAL_PUBLIC_ROW_COUNT ||
    columnCount !== CANONICAL_PUBLIC_COLUMN_COUNT
  ) {
    push(
      `canonical workload must be ${CANONICAL_PUBLIC_SCENARIO_NAME} ${CANONICAL_PUBLIC_ROW_COUNT} × ${CANONICAL_PUBLIC_COLUMN_COUNT}`,
    );
  }
  if (summary.quickSearchModeComparison?.provisional === true) {
    push("Quick Search comparison must be non-provisional");
  }
  if (summary.filterModeComparison?.provisional === true) {
    push("Filter comparison must be non-provisional");
  }
  if (!summary.quickSearchModeComparison) push("Quick Search producer comparison is missing");
  if (!summary.filterModeComparison) push("Filter producer comparison is missing");
  if (Object.prototype.hasOwnProperty.call(summary, "winner")) {
    push("artifact must not declare a winner");
  }
  if (!expected?.datasetSha256 || !expected?.columnSchemaSha256) {
    push("dataset and column-schema SHA-256 are required");
  }
  if (!environment?.packages) push("package versions are required");
  if (!environment?.playwright?.version) push("Playwright version is required");
  if (!environment?.browser?.name) push("browser evidence is required");
  for (const reason of collectFilterProducerPromotionReasons(summary.filterModeComparison)) {
    push(reason);
  }
  try {
    assertMergedRuntimeReport(summary);
  } catch (error) {
    push(error instanceof Error ? error.message : String(error));
  }
  if (reasons.length > 0) {
    throw new Error(`Runtime artifact is not promotable:\n- ${reasons.join("\n- ")}`);
  }
}
