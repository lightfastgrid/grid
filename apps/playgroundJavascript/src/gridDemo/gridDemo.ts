import {
  Grid,
  type GridThemeDensity,
  type LightFastGridColumnInput,
  type Unsubscribe,
} from "@lightfastgrid/core";

import { createGridDemoCellMenu } from "./cellMenu/index.ts";
import {
  createGridDemoCellRenderers,
  type GridDemoRowDialogState,
  openRowRecordDialog,
  saveGridDemoRowEdit,
  setGridDemoRowActionHost,
} from "./cellRenderers/index.ts";
import {
  gridDemoColumnMenu,
  gridDemoColumnOrder,
  gridDemoColumnSelection,
  gridDemoDefaultColDef,
  gridDemoExecution,
  gridDemoFloatingFilters,
  gridDemoGetRowId,
  gridDemoRowDrag,
  gridDemoRowSelection,
} from "./config/index.ts";
import { createGridDemoOverlays, loadGridDataset } from "./dataLoading/index.ts";
import { readStoredDemoDensity, writeStoredDemoDensity } from "./InteractiveDemo/actions/density/demoDensityStorage.ts";
import {
  countActiveFilters,
  type DemoThemePreference,
  type InteractiveDemoToolbarHandle,
  mountInteractiveDemoToolbar,
} from "./InteractiveDemo/index.ts";
import { resolveDemoColumns } from "./InteractiveDemo/panels/settings/commands/groupDemoColumns.ts";
import {
  DEFAULT_DEMO_SETTINGS,
  resolveDemoThemeBase,
} from "./InteractiveDemo/panels/settings/commands/settingsPanelModel.ts";

import "@lightfastgrid/core/themes/default.css";
import "./gridDemo.css";

export type StartGridDemoOptions = {
  host: HTMLElement;
  statusLine: HTMLElement;
  toolbarHost: HTMLElement;
  demoRoot: HTMLElement;
};

export type GridDemoHandle = {
  destroy: () => void;
};

function readSystemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function liveDemoGrid(destroyed: boolean, grid: Grid | null): Grid | null {
  if (destroyed) return null;
  return grid;
}

function liveDemoToolbar(
  destroyed: boolean,
  toolbar: InteractiveDemoToolbarHandle | null,
): InteractiveDemoToolbarHandle | null {
  if (destroyed) return null;
  return toolbar;
}

/**
 * Create, subscribe, mount, and wire the vanilla grid demo with InteractiveDemo toolbar.
 */
export async function startGridDemo(
  options: StartGridDemoOptions,
): Promise<GridDemoHandle> {
  const { host, statusLine, toolbarHost, demoRoot } = options;

  const announce = (message: string) => {
    statusLine.textContent = message;
  };

  let destroyed = false;
  let grid: Grid | null = null;
  let unsubscribers: Unsubscribe[] = [];
  let toolbar: InteractiveDemoToolbarHandle | null = null;
  let disposeDialog: (() => void) | null = null;
  let sourceColumns: LightFastGridColumnInput[] = [];
  let systemPrefersDark = readSystemPrefersDark();

  let density: GridThemeDensity =
    readStoredDemoDensity() ?? "standard";
  let floatingFiltersEnabled =
    DEFAULT_DEMO_SETTINGS.floatingFiltersEnabled &&
    gridDemoFloatingFilters.enabled !== false;
  let groupedHeadersEnabled = DEFAULT_DEMO_SETTINGS.groupedHeadersEnabled;
  let paginationEnabled = DEFAULT_DEMO_SETTINGS.paginationEnabled;
  let themePreference: DemoThemePreference =
    DEFAULT_DEMO_SETTINGS.themePreference;

  const getThemeBase = () =>
    resolveDemoThemeBase(themePreference, systemPrefersDark);

  const applyThemeChrome = () => {
    const base = getThemeBase();
    demoRoot.classList.toggle("grid-demo--light", base === "light");
    demoRoot.dataset.demoTheme = base;
    grid?.setTheme({ base, density });
  };

  const applyFloatingFilters = () => {
    grid?.setFloatingFilters({
      ...gridDemoFloatingFilters,
      enabled: floatingFiltersEnabled,
    });
  };

  const applyPagination = () => {
    grid?.setPaginationConfig({
      enabled: paginationEnabled,
      pageSize: 1000,
      pageSizeOptions: [25, 50, 100, 250, 500, 1000],
    });
  };

  const applyColumns = () => {
    if (!grid) return;
    grid.setColumns(resolveDemoColumns(sourceColumns, groupedHeadersEnabled));
    grid.setColumnGroupHeaders(groupedHeadersEnabled);
  };

  const closeDialog = () => {
    disposeDialog?.();
    disposeDialog = null;
  };

  const openDialog = (state: GridDemoRowDialogState) => {
    closeDialog();
    disposeDialog = openRowRecordDialog({
      mode: state.mode,
      record: state.record,
      onClose: () => {
        disposeDialog = null;
      },
      onSave:
        state.mode === "edit"
          ? (fields) => {
              saveGridDemoRowEdit({
                grid,
                row: state.row,
                fields,
              });
            }
          : undefined,
    });
  };

  const onSystemThemeChange = () => {
    systemPrefersDark = readSystemPrefersDark();
    if (themePreference === "system") applyThemeChrome();
  };

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onSystemThemeChange);

  applyThemeChrome();

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    window.removeEventListener("pagehide", destroy);
    media.removeEventListener("change", onSystemThemeChange);
    closeDialog();
    setGridDemoRowActionHost(null);
    toolbar?.destroy();
    toolbar = null;

    for (let index = unsubscribers.length - 1; index >= 0; index -= 1) {
      unsubscribers[index]?.();
    }
    unsubscribers = [];

    if (grid) {
      grid.destroy();
      grid = null;
    }
  };

  window.addEventListener("pagehide", destroy);

  const themeBase = getThemeBase();
  applyThemeChrome();

  grid = new Grid({
    columns: [],
    rows: [],
    loading: true,
    overlays: createGridDemoOverlays(null),
    getRowId: gridDemoGetRowId,
    defaultColDef: gridDemoDefaultColDef,
    rowSelection: gridDemoRowSelection,
    columnSelection: gridDemoColumnSelection,
    columnOrder: gridDemoColumnOrder,
    columnGroupHeaders: groupedHeadersEnabled,
    pagination: paginationEnabled,
    paginationPageSize: 1000,
    paginationPageSizeOptions: [25, 50, 100, 250, 500, 1000],
    floatingFilters: {
      ...gridDemoFloatingFilters,
      enabled: floatingFiltersEnabled,
    },
    quickFilter: true,
    columnMenu: gridDemoColumnMenu,
    cellMenu: createGridDemoCellMenu(),
    cellRenderers: createGridDemoCellRenderers(),
    rowDrag: gridDemoRowDrag,
    execution: gridDemoExecution,
    theme: { base: themeBase, density },
    accessibility: { ariaLabel: "Customers" },
    csvExport: { fileName: "lightfastgrid-demo.csv" },
  });

  setGridDemoRowActionHost({
    getGrid: () => grid,
    openDialog,
  });

  unsubscribers.push(
    grid.on("filter:changed", (event) => {
      toolbar?.setActiveFilterCount(event.activeFilterCount);
    }),
    grid.on("sort:changed", (event) => {
      toolbar?.setActiveSortCount(event.sortModel.length);
    }),
  );

  grid.mount(host);

  toolbar = mountInteractiveDemoToolbar(toolbarHost, {
    getGrid: () => grid,
    density,
    onDensityChange: (next) => {
      density = next;
      writeStoredDemoDensity(next);
      applyThemeChrome();
      toolbar?.setDensity(next);
    },
    activeFilterCount: 0,
    activeSortCount: 0,
    floatingFiltersEnabled,
    onFloatingFiltersChange: (enabled) => {
      floatingFiltersEnabled = enabled;
      applyFloatingFilters();
      toolbar?.setFloatingFiltersEnabled(enabled);
    },
    groupedHeadersEnabled,
    onGroupedHeadersChange: (enabled) => {
      groupedHeadersEnabled = enabled;
      applyColumns();
      toolbar?.setGroupedHeadersEnabled(enabled);
    },
    paginationEnabled,
    onPaginationChange: (enabled) => {
      paginationEnabled = enabled;
      applyPagination();
      toolbar?.setPaginationEnabled(enabled);
    },
    themePreference,
    onThemePreferenceChange: (preference) => {
      themePreference = preference;
      applyThemeChrome();
      toolbar?.setThemePreference(preference);
    },
    onStatus: announce,
  });

  try {
    const dataset = await loadGridDataset();
    const liveGrid = liveDemoGrid(destroyed, grid);
    if (!liveGrid) {
      return { destroy };
    }

    sourceColumns = dataset.columnDefs;
    liveGrid.setColumns(resolveDemoColumns(sourceColumns, groupedHeadersEnabled));
    liveGrid.setRows(dataset.rowData);
    liveGrid.setOverlays(createGridDemoOverlays(null));
    liveGrid.setLoading(false);
    const liveToolbar = liveDemoToolbar(destroyed, toolbar);
    liveToolbar?.setActiveFilterCount(countActiveFilters(liveGrid.getFilterModel()));
    liveToolbar?.setActiveSortCount(liveGrid.getSortModel().length);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const liveGrid = liveDemoGrid(destroyed, grid);
    if (liveGrid) {
      liveGrid.setOverlays(createGridDemoOverlays(message));
      liveGrid.setRows([]);
      liveGrid.setLoading(false);
    }
    announce("Couldn't load dataset");
  }

  return { destroy };
}
