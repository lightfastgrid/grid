import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { el } from "../../shell/dom.ts";
import {
  mountPanelHeader,
  mountPanelInfoFooter,
  mountPanelRadioRow,
} from "../../shell/ui/panelPrimitives.ts";

import { DEMO_DENSITY_OPTIONS } from "./densityOptions.ts";

/**
 * Density dropdown — controlled theme density only.
 * Vanilla DOM port of React DensityPanel.tsx.
 */
export function mountDensityPanel(
  host: HTMLElement,
  props: InteractiveDemoPanelProps,
): () => void {
  const { onClose, density = "standard", onDensityChange } = props;
  const root = el("div", "interactive-demo-panel-stack");
  const cleanups: (() => void)[] = [];

  const headerHandle = mountPanelHeader(root, {
    title: "Density",
    onClose,
  });
  cleanups.push(headerHandle.destroy);

  const radioGroup = el("div", "interactive-demo-density-list");
  radioGroup.setAttribute("role", "radiogroup");
  radioGroup.setAttribute("aria-label", "Grid density");
  root.append(radioGroup);

  for (const option of DEMO_DENSITY_OPTIONS) {
    cleanups.push(
      mountPanelRadioRow(radioGroup, {
        name: "demo-density",
        value: option.value,
        label: option.label,
        description: option.description,
        checked: density === option.value,
        onSelect: (value) => onDensityChange?.(value as typeof option.value),
      }),
    );
  }

  mountPanelInfoFooter(root, "Density changes are saved to your browser.");

  host.append(root);

  return () => {
    for (const fn of cleanups) fn();
    root.remove();
  };
}
