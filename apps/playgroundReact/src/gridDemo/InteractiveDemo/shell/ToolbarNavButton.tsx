import type { ReactNode } from "react";

import { preventToolbarFocusSteal } from "./preventToolbarFocusSteal.ts";
import { IconChevronDown } from "./ToolbarIcons.tsx";

type ToolbarNavButtonProps = {
  label: string;
  icon: ReactNode;
  active?: boolean;
  primary?: boolean;
  chevron?: boolean;
  menu?: boolean;
  badge?: number;
  title?: string;
  ariaLabel?: string;
  onClick: () => void;
};

/** Shared toolbar nav control. */
export function ToolbarNavButton({
  label,
  icon,
  active = false,
  primary = false,
  chevron = false,
  menu = false,
  badge,
  title,
  ariaLabel,
  onClick,
}: ToolbarNavButtonProps) {
  const isMenu = menu || chevron;
  const className = [
    "interactive-demo-btn",
    primary ? "interactive-demo-btn-primary" : "",
    active ? "is-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={isMenu ? active : undefined}
      aria-haspopup={isMenu ? "dialog" : undefined}
      onMouseDown={preventToolbarFocusSteal}
      onClick={onClick}
    >
      <span className="interactive-demo-btn-icon">{icon}</span>
      <span className="interactive-demo-btn-label">{label}</span>
      {typeof badge === "number" && badge > 0 ? (
        <span className="interactive-demo-badge">{badge}</span>
      ) : null}
      {chevron ? (
        <span className="interactive-demo-btn-chevron">
          <IconChevronDown />
        </span>
      ) : null}
    </button>
  );
}
