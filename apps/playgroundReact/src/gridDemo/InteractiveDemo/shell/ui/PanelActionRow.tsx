import type { ReactNode } from "react";

import { preventToolbarFocusSteal } from "../preventToolbarFocusSteal.ts";

type PanelActionRowProps = {
  icon: ReactNode;
  title: string;
  description?: string;
  disabled?: boolean;
  /** Trailing affordance (e.g. Advanced export chevron). */
  trailing?: ReactNode;
  onClick: () => void;
};

/** Shared title+subtitle action row used by Rows / Export / etc. */
export function PanelActionRow({
  icon,
  title,
  description,
  disabled = false,
  trailing,
  onClick,
}: PanelActionRowProps) {
  return (
    <button
      type="button"
      className="interactive-demo-panel-action"
      disabled={disabled}
      onMouseDown={preventToolbarFocusSteal}
      onClick={onClick}
    >
      <span className="interactive-demo-panel-action-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="interactive-demo-panel-action-text">
        <span className="interactive-demo-panel-action-title">{title}</span>
        {description ? (
          <span className="interactive-demo-panel-action-desc">
            {description}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="interactive-demo-panel-action-trailing" aria-hidden="true">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}
