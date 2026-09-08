import type { ReactNode } from "react";

import { preventToolbarFocusSteal } from "./preventToolbarFocusSteal.ts";

export type ToolbarPanelAlign = "start" | "end";

type ToolbarPanelHostProps = {
  children: ReactNode;
  /** Accessible name for the dialog (panel owns visible title if any). */
  ariaLabel: string;
  /** Anchor against the trigger: start = left edge, end = right edge. */
  align?: ToolbarPanelAlign;
};

/**
 * Shared dropdown chrome for every toolbar panel.
 * Non-modal dialog: does not trap focus or block the page (aria-modal=false).
 */
export function ToolbarPanelHost({
  children,
  ariaLabel,
  align = "start",
}: ToolbarPanelHostProps) {
  return (
    <div
      className="interactive-demo-panel"
      data-align={align}
      role="dialog"
      aria-modal={false}
      aria-label={ariaLabel}
      onMouseDown={preventToolbarFocusSteal}
    >
      {children}
    </div>
  );
}
