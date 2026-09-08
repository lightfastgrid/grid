import type { DomGridFeatureContext } from "../types";

import { normalizeAriaAttributeValue } from "./utils/normalizeAriaAttributeValue";
import type { AccessibilityGridReadSeam } from "./accessibilityGridReadSeam";

/**
 * Composite-grid snapshot applied to `.lfg-grid-surface`
 * (ACCESSIBILITY_V2_SURFACE §1).
 */
export interface GridRootSnapshot {
  readonly role: "grid" | "treegrid";
  readonly ariaRowCount: number;
  readonly ariaColCount: number;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
  readonly ariaDescribedBy?: string;
  readonly ariaMultiselectable: boolean;
  readonly ariaBusy: boolean;
}
// `aria-activedescendant` is intentionally absent: the body-cell accessibility
// reconciler owns it through stable physical cell IDs. The focus feature owns
// only focused-cell state and visual classes.

/**
 * Header rows in the accessibility row index space: group levels (if any) plus
 * one leaf header row plus the optional floating-filter row.
 */
export function countAccessibilityHeaderRows(ctx: DomGridFeatureContext): number {
  const groupLevels = ctx.getColumnGroupHeaders?.()?.depth ?? 0;
  const floatingFilterRows = ctx.hasFloatingFilterRow?.() === true ? 1 : 0;
  return 1 + (groupLevels > 0 ? groupLevels : 0) + floatingFilterRows;
}

/**
 * Pull semantic-surface state from the feature context and grid read seam.
 * Performs no layout reads.
 */
export function captureGridRootSnapshot(
  ctx: DomGridFeatureContext,
  read: AccessibilityGridReadSeam,
  overlayDescriptionId?: string,
): GridRootSnapshot {
  const dataRowCount = ctx.getDisplayRows().rowCount;
  const headerRowCount = countAccessibilityHeaderRows(ctx);
  const ariaRowCount = headerRowCount + dataRowCount;
  const ariaColCount = ctx.getColumns().length;

  const options = read.getAccessibilityOptions() ?? {};
  const ariaLabelledBy = normalizeAriaAttributeValue(
    options.ariaLabelledBy,
  );
  const explicitAriaLabel = normalizeAriaAttributeValue(options.ariaLabel);
  const applicationDescription = normalizeAriaAttributeValue(
    options.ariaDescribedBy,
  );
  const ariaDescribedBy =
    overlayDescriptionId === undefined
      ? applicationDescription
      : appendIdReferenceToken(
          applicationDescription,
          overlayDescriptionId,
        );
  const columnSelection = ctx.getColumnSelectionConfig?.();

  return {
    role: "grid",
    ariaRowCount,
    ariaColCount,
    ariaLabel:
      ariaLabelledBy === undefined
        ? (explicitAriaLabel ?? "Data grid")
        : undefined,
    ariaLabelledBy,
    ariaDescribedBy,
    ariaMultiselectable:
      read.getRowSelectionMode() === "multiple" ||
      (columnSelection?.enabled === true &&
        columnSelection.mode === "multiple"),
    ariaBusy: read.isGridBusy(),
  };
}

function appendIdReferenceToken(
  current: string | undefined,
  token: string,
): string {
  if (current === undefined) return token;
  const values = current.split(/\s+/);
  return values.includes(token) ? current : `${current} ${token}`;
}
