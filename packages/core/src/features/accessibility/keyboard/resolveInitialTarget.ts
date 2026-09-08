import type { VisualRowLayout } from "../../../internal/layoutTypes";

import {
  clearKeyboardTarget,
  type KeyboardTargetState,
  setBodyCellTarget,
  setLeafHeaderTarget,
} from "./keyboardTarget";
import type { KeyboardNavigationPlan } from "./navigationPlan";
import {
  keyboardDisplayIndexAtVisual,
  keyboardVisualRowCount,
} from "./visualRows";

/** Write the initial target into caller-owned storage. */
export function resolveInitialKeyboardTarget(
  plan: KeyboardNavigationPlan,
  rowLayout: VisualRowLayout,
  target: KeyboardTargetState,
): boolean {
  if (plan.columns.length === 0) {
    clearKeyboardTarget(target);
    return false;
  }
  if (
    keyboardVisualRowCount(rowLayout) > 0 &&
    plan.firstDataColumnOrdinal >= 0
  ) {
    setBodyCellTarget(
      target,
      0,
      keyboardDisplayIndexAtVisual(rowLayout, 0),
      plan.firstDataColumnOrdinal,
    );
    return true;
  }
  setLeafHeaderTarget(target, 0);
  return true;
}
