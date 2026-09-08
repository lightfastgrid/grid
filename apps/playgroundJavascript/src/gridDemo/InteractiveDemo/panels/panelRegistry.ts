import { mountDensityPanel } from "../actions/density/DensityPanel.ts";
import { mountExportPanel } from "../actions/export/ExportPanel.ts";
import type { InteractiveDemoPanelProps } from "../runtime/types.ts";
import type { InteractiveDemoPanelId } from "../types.ts";

import { mountColumnsPanel } from "./columns/ColumnsPanel.ts";
import { mountFiltersPanel } from "./filters/FiltersPanel.ts";
import { mountSettingsPanel } from "./settings/SettingsPanel.ts";
import { mountSortPanel } from "./sort/SortPanel.ts";

export type OpenPanelId = Exclude<InteractiveDemoPanelId, null>;

export type PanelMountFn = (
  host: HTMLElement,
  props: InteractiveDemoPanelProps,
) => () => void;

export type PanelEntry = {
  title: string;
  mount: PanelMountFn;
};

const PANEL_REGISTRY: Record<OpenPanelId, PanelEntry> = {
  columns: { title: "Columns", mount: mountColumnsPanel },
  filters: { title: "Filters", mount: mountFiltersPanel },
  sort: { title: "Sort", mount: mountSortPanel },
  density: { title: "Density", mount: mountDensityPanel },
  export: { title: "Export", mount: mountExportPanel },
  settings: { title: "Settings", mount: mountSettingsPanel },
};

export function getPanelEntry(id: OpenPanelId): PanelEntry {
  return PANEL_REGISTRY[id];
}
