import type { ReactNode } from "react";

type PanelToggleRowProps = {
  label: string;
  description?: string;
  icon?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/** Shared label + switch row (Filters, Advanced export, Settings). */
export function PanelToggleRow({
  label,
  description,
  icon,
  checked,
  onChange,
}: PanelToggleRowProps) {
  return (
    <div className="interactive-demo-panel-toggle">
      {icon ? (
        <span className="interactive-demo-panel-toggle-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="interactive-demo-panel-toggle-copy">
        <span className="interactive-demo-panel-toggle-label">{label}</span>
        {description ? (
          <span className="interactive-demo-panel-toggle-desc">{description}</span>
        ) : null}
      </span>
      <button
        type="button"
        className={`interactive-demo-switch${checked ? " is-on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span className="interactive-demo-switch-thumb" />
      </button>
    </div>
  );
}
