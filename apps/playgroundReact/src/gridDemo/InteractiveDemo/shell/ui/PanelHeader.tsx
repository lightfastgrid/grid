import { preventToolbarFocusSteal } from "../preventToolbarFocusSteal.ts";

type PanelHeaderProps = {
  title: string;
  onClose: () => void;
};

/** Title + close control used by Filters (and later panels with headers). */
export function PanelHeader({ title, onClose }: PanelHeaderProps) {
  return (
    <div className="interactive-demo-panel-heading">
      <strong className="interactive-demo-panel-heading-title">{title}</strong>
      <button
        type="button"
        className="interactive-demo-panel-heading-close"
        aria-label="Close"
        onMouseDown={preventToolbarFocusSteal}
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
