import type { ComponentType } from "react";

import { DensityPanel } from "../actions/density/DensityPanel.tsx";
import { ExportPanel } from "../actions/export/ExportPanel.tsx";
import type { InteractiveDemoPanelProps } from "../runtime/types.ts";
import type { InteractiveDemoPanelId } from "../types.ts";

import { ColumnsPanel } from "./columns/ColumnsPanel.tsx";
import { FiltersPanel } from "./filters/FiltersPanel.tsx";
import { SettingsPanel } from "./settings/SettingsPanel.tsx";
import { SortPanel } from "./sort/SortPanel.tsx";

export type OpenPanelId = Exclude<InteractiveDemoPanelId, null>;

const PANEL_REGISTRY: Record<
  OpenPanelId,
  { title: string; Panel: ComponentType<InteractiveDemoPanelProps> }
> = {
  columns: { title: "Columns", Panel: ColumnsPanel },
  filters: { title: "Filters", Panel: FiltersPanel },
  sort: { title: "Sort", Panel: SortPanel },
  density: { title: "Density", Panel: DensityPanel },
  export: { title: "Export", Panel: ExportPanel },
  settings: { title: "Settings", Panel: SettingsPanel },
};

export function getPanelEntry(id: OpenPanelId) {
  return PANEL_REGISTRY[id];
}
