import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { PanelHeader } from "../../shell/ui/PanelHeader.tsx";
import { PanelInfoFooter } from "../../shell/ui/PanelInfoFooter.tsx";
import { PanelRadioRow } from "../../shell/ui/PanelRadioRow.tsx";

import { DEMO_DENSITY_OPTIONS } from "./densityOptions.ts";

/**
 * Density dropdown — controlled theme density only (architecture actions/*).
 * Does not call the grid handle; parent owns React `theme.density`.
 */
export function DensityPanel({
  density = "standard",
  onDensityChange,
  onClose,
}: InteractiveDemoPanelProps) {
  return (
    <div className="interactive-demo-panel-stack">
      <PanelHeader title="Density" onClose={onClose} />

      <div
        className="interactive-demo-density-list"
        role="radiogroup"
        aria-label="Grid density"
      >
        {DEMO_DENSITY_OPTIONS.map((option) => (
          <PanelRadioRow
            key={option.value}
            title={option.label}
            description={option.description}
            selected={density === option.value}
            onSelect={() => onDensityChange?.(option.value)}
          />
        ))}
      </div>

      <PanelInfoFooter>
        Density changes are saved to your browser.
      </PanelInfoFooter>
    </div>
  );
}
