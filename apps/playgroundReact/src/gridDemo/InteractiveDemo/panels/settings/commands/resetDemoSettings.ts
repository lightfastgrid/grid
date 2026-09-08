import type { DemoGridGetter } from "../../../runtime/types.ts";

import {
  createDefaultDemoSettings,
  type DemoSettingsSnapshot,
} from "./settingsPanelModel.ts";

/**
 * Restore Settings defaults and clear interactive filter/sort/quick-filter
 * state. Does not reset density or reload the dataset.
 */
export function resetDemoSettings(
  getGrid: DemoGridGetter,
  applyChrome: (next: DemoSettingsSnapshot) => void,
): DemoSettingsSnapshot {
  const next = createDefaultDemoSettings();
  applyChrome(next);

  const grid = getGrid();
  if (!grid) return next;

  grid.clearFilters();
  grid.clearSort();
  grid.clearQuickFilter();
  return next;
}
