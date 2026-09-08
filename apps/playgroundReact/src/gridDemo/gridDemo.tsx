import type { GridThemeDensity } from "@lightfastgrid/core";
import {
  LightFastGrid,
  type ReactLightFastGridHandle,
} from "@lightfastgrid/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createGridDemoCellMenu } from "./cellMenu/index.ts";
import {
  type GridDemoRowDialogState,
  saveGridDemoRowEdit,
} from "./cellRenderers/handleGridDemoRowAction.ts";
import { createGridDemoCellRenderers } from "./cellRenderers/index.ts";
import { setGridDemoRowActionHost } from "./cellRenderers/rowActionHost.ts";
import { RowRecordDialog } from "./cellRenderers/RowRecordDialog.tsx";
import {
  readStoredDemoDensity,
  writeStoredDemoDensity,
} from "./InteractiveDemo/actions/density/demoDensityStorage.ts";
import { InteractiveDemoToolbar } from "./InteractiveDemo/InteractiveDemoToolbar.tsx";
import { resolveDemoColumns } from "./InteractiveDemo/panels/settings/commands/groupDemoColumns.ts";
import {
  DEFAULT_DEMO_SETTINGS,
  type DemoThemePreference,
  resolveDemoThemeBase,
} from "./InteractiveDemo/panels/settings/commands/settingsPanelModel.ts";
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
} from "./config";
import {
  createGridDemoOverlays,
  resolveGridDatasetUrl,
  useGridDataset,
} from "./dataLoading";
import { DemoStatus } from "./DemoStatus.tsx";
import { useDemoGridEvents } from "./useDemoGridEvents.ts";
import { useDemoStatus } from "./useDemoStatus.ts";

import "./gridDemo.css";

function readSystemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function GridDemo() {
  const gridRef = useRef<ReactLightFastGridHandle>(null);
  const datasetUrl = resolveGridDatasetUrl();
  const { rows, columns, loading, error } = useGridDataset(datasetUrl);
  const overlays = useMemo(() => createGridDemoOverlays(error), [error]);
  const { status, announce } = useDemoStatus();
  const [dialog, setDialog] = useState<GridDemoRowDialogState | null>(null);
  const [density, setDensity] = useState<GridThemeDensity>(
    () => readStoredDemoDensity() ?? "standard",
  );
  const [floatingFiltersEnabled, setFloatingFiltersEnabled] = useState(
    () =>
      DEFAULT_DEMO_SETTINGS.floatingFiltersEnabled &&
      gridDemoFloatingFilters.enabled !== false,
  );
  const [groupedHeadersEnabled, setGroupedHeadersEnabled] = useState(
    () => DEFAULT_DEMO_SETTINGS.groupedHeadersEnabled,
  );
  const [paginationEnabled, setPaginationEnabled] = useState(
    () => DEFAULT_DEMO_SETTINGS.paginationEnabled,
  );
  const [themePreference, setThemePreference] = useState<DemoThemePreference>(
    () => DEFAULT_DEMO_SETTINGS.themePreference,
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(readSystemPrefersDark);

  const themeBase = resolveDemoThemeBase(themePreference, systemPrefersDark);
  const theme = useMemo(
    () => ({ base: themeBase, density }),
    [themeBase, density],
  );
  const floatingFilters = useMemo(
    () => ({ ...gridDemoFloatingFilters, enabled: floatingFiltersEnabled }),
    [floatingFiltersEnabled],
  );
  const displayColumns = useMemo(
    () => resolveDemoColumns(columns, groupedHeadersEnabled),
    [columns, groupedHeadersEnabled],
  );
  const cellRenderers = useMemo(() => createGridDemoCellRenderers(), []);
  const cellMenu = useMemo(() => createGridDemoCellMenu(), []);
  const { gridEvents, activeFilterCount, activeSortCount } = useDemoGridEvents();

  const getGrid = useCallback(() => gridRef.current, []);

  const handleDensityChange = useCallback((next: GridThemeDensity) => {
    setDensity(next);
    writeStoredDemoDensity(next);
  }, []);

  useEffect(() => {
    if (themePreference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemPrefersDark(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [themePreference]);

  useEffect(() => {
    setGridDemoRowActionHost({
      getGrid,
      openDialog: setDialog,
    });
    return () => setGridDemoRowActionHost(null);
  }, [getGrid]);

  const closeDialog = () => {
    setDialog(null);
  };

  return (
    <div
      className={`grid-demo${themeBase === "light" ? " grid-demo--light" : ""}`}
      data-demo-theme={themeBase}
    >
      <InteractiveDemoToolbar
        getGrid={getGrid}
        density={density}
        onDensityChange={handleDensityChange}
        activeFilterCount={activeFilterCount}
        activeSortCount={activeSortCount}
        floatingFiltersEnabled={floatingFiltersEnabled}
        onFloatingFiltersChange={setFloatingFiltersEnabled}
        groupedHeadersEnabled={groupedHeadersEnabled}
        onGroupedHeadersChange={setGroupedHeadersEnabled}
        paginationEnabled={paginationEnabled}
        onPaginationChange={setPaginationEnabled}
        themePreference={themePreference}
        onThemePreferenceChange={setThemePreference}
        onStatus={announce}
      />
      <DemoStatus message={status} />
      <div className="grid-demo-surface">
        <LightFastGrid
          ref={gridRef}
          theme={theme}
          rows={rows}
          columns={displayColumns}
          columnGroupHeaders={groupedHeadersEnabled}
          getRowId={gridDemoGetRowId}
          loading={loading}
          pagination={paginationEnabled}
          paginationPageSize={1000}
          paginationPageSizeOptions={[25, 50, 100, 250, 500, 1000]}
          rowSelection={gridDemoRowSelection}
          columnSelection={gridDemoColumnSelection}
          defaultColDef={gridDemoDefaultColDef}
          execution={gridDemoExecution}
          columnMenu={gridDemoColumnMenu}
          floatingFilters={floatingFilters}
          columnOrder={gridDemoColumnOrder}
          rowDrag={gridDemoRowDrag}
          overlays={overlays}
          cellRenderers={cellRenderers}
          cellMenu={cellMenu}
          accessibility={{ ariaLabel: "Customers" }}
          {...gridEvents}
        />
      </div>
      {dialog ? (
        <RowRecordDialog
          key={`${dialog.mode}:${dialog.record.rowId}`}
          mode={dialog.mode}
          record={dialog.record}
          onClose={closeDialog}
          onSave={(fields) => {
            saveGridDemoRowEdit({
              grid: gridRef.current,
              row: dialog.row,
              fields,
            });
            closeDialog();
          }}
        />
      ) : null}
    </div>
  );
}

export default GridDemo;
