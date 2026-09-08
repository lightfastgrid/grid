/**
 * Editing-feature view of cell-edit eligibility.
 *
 * The rules live in the neutral internal module so editing and presentation
 * share exactly one implementation (`BOOLEAN_CELL_V1_ARCHITECTURE.md` §7.2).
 * This file is a re-export only — do not add rules here.
 */

export type { EligibilityResult } from "../../internal/cellEditEligibility";
export { resolveCellEditEligibility } from "../../internal/cellEditEligibility";
