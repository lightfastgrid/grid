import type { ReactNode } from "react";

import { preventToolbarFocusSteal } from "../preventToolbarFocusSteal.ts";

type PanelMenuItemProps = {
  icon: ReactNode;
  title: string;
  /** Optional muted hint on the right (e.g. “Select columns to hide”). */
  hint?: string;
  disabled?: boolean;
  /** Optional selected highlight (Settings demo overlays). */
  selected?: boolean;
  onClick: () => void;
};

/** Compact icon + label row for bulk panel actions. */
export function PanelMenuItem({
  icon,
  title,
  hint,
  disabled = false,
  selected = false,
  onClick,
}: PanelMenuItemProps) {
  return (
    <button
      type="button"
      className={`interactive-demo-panel-menu-item${
        selected ? " is-selected" : ""
      }`}
      disabled={disabled}
      aria-pressed={selected}
      onMouseDown={preventToolbarFocusSteal}
      onClick={onClick}
    >
      <span className="interactive-demo-panel-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="interactive-demo-panel-menu-title">{title}</span>
      {hint ? (
        <span className="interactive-demo-panel-menu-hint">{hint}</span>
      ) : null}
    </button>
  );
}
