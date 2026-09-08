/**
 * Worker-eligibility check for quick-search execution.
 *
 * Determines whether a quick-search request can be offloaded to the
 * worker. Pure, side-effect-free inspection of the operation input's
 * cached dependency plan — does not resolve searchable fields from
 * columns.
 *
 * Eligibility rules (checked in order for meaningful reasons):
 * - Custom `parser` on quickFilter options → ineligible.
 * - Custom `matcher` on quickFilter options → ineligible.
 * - Empty plan descriptors → ineligible (`no-searchable-columns`).
 * - `!plan.workerSafe` → ineligible (`custom-extractor`).
 * - Otherwise → eligible, reusing plan descriptors and signature.
 */

import type { SearchableFieldDescriptor } from "../../../features/quick-search/searchableFieldResolver";
import type { WorkerEligibility } from "../types";

import type { QuickSearchOperationInput } from "./types";

const EMPTY_DESCRIPTORS: readonly SearchableFieldDescriptor[] = [];

export interface QuickSearchWorkerEligibility extends WorkerEligibility {
  descriptors: readonly SearchableFieldDescriptor[];
  fieldsSignature: string;
}

export function resolveQuickSearchWorkerEligibility(
  input: QuickSearchOperationInput,
): QuickSearchWorkerEligibility {
  const qfOpts = typeof input.quickFilter === "object" ? input.quickFilter : undefined;
  const plan = input.dependencyPlan;

  if (qfOpts?.parser) {
    return {
      eligible: false,
      descriptors: EMPTY_DESCRIPTORS,
      fieldsSignature: "",
      reason: "custom-parser",
    };
  }
  if (qfOpts?.matcher) {
    return {
      eligible: false,
      descriptors: EMPTY_DESCRIPTORS,
      fieldsSignature: "",
      reason: "custom-matcher",
    };
  }

  if (plan.descriptors.length === 0) {
    return {
      eligible: false,
      descriptors: EMPTY_DESCRIPTORS,
      fieldsSignature: "",
      reason: "no-searchable-columns",
    };
  }

  if (!plan.workerSafe) {
    return {
      eligible: false,
      descriptors: EMPTY_DESCRIPTORS,
      fieldsSignature: "",
      reason: "custom-extractor",
    };
  }

  return {
    eligible: true,
    descriptors: plan.descriptors,
    fieldsSignature: plan.fieldsSignature,
  };
}
