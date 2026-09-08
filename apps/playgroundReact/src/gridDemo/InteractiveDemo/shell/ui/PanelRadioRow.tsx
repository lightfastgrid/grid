import { preventToolbarFocusSteal } from "../preventToolbarFocusSteal.ts";

type PanelRadioRowProps = {
  title: string;
  description?: string;
  badge?: string;
  selected: boolean;
  onSelect: () => void;
};

/** Shared radio + title + subtitle row (Density, Advanced export, etc.). */
export function PanelRadioRow({
  title,
  description,
  badge,
  selected,
  onSelect,
}: PanelRadioRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`interactive-demo-panel-radio${selected ? " is-selected" : ""}`}
      onMouseDown={preventToolbarFocusSteal}
      onClick={onSelect}
    >
      <span className="interactive-demo-panel-radio-mark" aria-hidden="true" />
      <span className="interactive-demo-panel-radio-text">
        <span className="interactive-demo-panel-radio-title-row">
          <span className="interactive-demo-panel-radio-title">{title}</span>
          {badge ? (
            <span className="interactive-demo-panel-radio-badge">{badge}</span>
          ) : null}
        </span>
        {description ? (
          <span className="interactive-demo-panel-radio-desc">{description}</span>
        ) : null}
      </span>
    </button>
  );
}
