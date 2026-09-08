import {
  COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
  COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE,
  COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
} from "../../../internal/columnGroupHeaderDomMetadata";

import type { KeyboardTargetState } from "./keyboardTarget";
import type { KeyboardNavigationPlan } from "./navigationPlan";

const COLUMN_FIELD_ATTRIBUTE = "data-col-id";
const ROW_INDEX_ATTRIBUTE = "data-row-index";

export function isKeyboardTargetElementBound(
  element: HTMLElement,
  target: Readonly<KeyboardTargetState>,
  plan: KeyboardNavigationPlan,
): boolean {
  if (!element.isConnected || element.style.display === "none") return false;

  switch (target.kind) {
    case "none":
      return false;
    case "bodyCell":
      return (
        element.getAttribute(COLUMN_FIELD_ATTRIBUTE) ===
          plan.columns[target.columnOrdinal]?.field &&
        readBoundRowIndex(element.parentElement) === target.displayRowIndex
      );
    case "leafHeader":
    case "floatingFilter":
      return (
        element.getAttribute(COLUMN_FIELD_ATTRIBUTE) ===
        plan.columns[target.columnOrdinal]?.field
      );
    case "groupHeader": {
      const row = plan.groupRows[target.level];
      const span = row?.spans[target.spanIndex];
      if (
        row === undefined ||
        span === undefined ||
        target.anchorColumnOrdinal < span.startColumnOrdinal ||
        target.anchorColumnOrdinal > span.endColumnOrdinal
      ) {
        return false;
      }
      return (
        readBoundGroupLevel(element.parentElement) === target.level &&
        element.getAttribute(COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE) ===
          plan.columns[span.startColumnOrdinal]?.field &&
        element.getAttribute(COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE) ===
          plan.columns[span.endColumnOrdinal]?.field
      );
    }
  }
}

function readBoundRowIndex(row: HTMLElement | null): number {
  if (row === null || row.style.display === "none") return -1;
  return readNonNegativeSafeInteger(row.getAttribute(ROW_INDEX_ATTRIBUTE));
}

function readBoundGroupLevel(row: HTMLElement | null): number {
  if (row === null || row.style.display === "none") return -1;
  return readNonNegativeSafeInteger(
    row.getAttribute(COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE),
  );
}

function readNonNegativeSafeInteger(value: string | null): number {
  if (value === null || value === "") return -1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
}
