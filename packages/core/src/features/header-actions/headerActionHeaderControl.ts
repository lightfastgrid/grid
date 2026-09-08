import type { HeaderControlDescriptor } from "../../rendering/headerControlTypes";
import type { ColumnDef, HeaderActionDef } from "../../types";

import { HEADER_ACTION_TRIGGER_CLASS } from "./headerActionDom";

function resolveClassName(action: HeaderActionDef): string {
  return action.className
    ? `${HEADER_ACTION_TRIGGER_CLASS} ${action.className}`
    : HEADER_ACTION_TRIGGER_CLASS;
}

export function headerActionHeaderControls(
  col: ColumnDef,
): HeaderControlDescriptor[] {
  const actions = col.headerActions?.filter((a) => !a.hidden);
  if (!actions || actions.length === 0) return [];
  return actions.map((action) => ({
    id: `headerAction:${action.id}`,
    layoutRole: "action" as const,
    className: resolveClassName(action),
    ariaLabel: action.ariaLabel ?? action.id,
    textContent: action.icon ?? "⋮",
    disabled: action.disabled,
    dataset: {
      "header-action-id": action.id,
      "header-action-renderer-key": action.rendererKey,
    },
  }));
}
