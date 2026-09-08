import type { ReactNode } from "react";

type PanelInfoFooterProps = {
  children: ReactNode;
};

/** Shared bordered info callout at the bottom of toolbar dropdowns. */
export function PanelInfoFooter({ children }: PanelInfoFooterProps) {
  return (
    <div className="interactive-demo-panel-info">
      <span className="interactive-demo-panel-info-icon" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </span>
      <p className="interactive-demo-panel-info-text">{children}</p>
    </div>
  );
}
