import "@lfg-benchmarks/shared/styles.css";

import {
  AllCommunityModule,
  createGrid,
  ModuleRegistry,
  themeQuartz,
} from "ag-grid-community";
import {
  AG_GRID_DEFAULT_COL_DEF,
  createBundleFixture,
  HEADER_HEIGHT_PX,
  mountVanillaBenchmarkChrome,
  OVERSCAN_ROWS_PER_SIDE,
  ROW_HEIGHT_PX,
  toAgGridColDefs,
} from "@lfg-benchmarks/shared/bundle";

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  rowHeight: ROW_HEIGHT_PX,
  headerHeight: HEADER_HEIGHT_PX,
  browserColorScheme: "light",
});

const fixture = createBundleFixture();
const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root");
}

const chrome = mountVanillaBenchmarkChrome(container, {
  title: "AG Grid Community Vanilla",
  label: "ag-grid-vanilla",
  status: `${fixture.scenario} · bundle consumer · ${fixture.rows.length} rows × ${fixture.columns.length} columns`,
});

createGrid(chrome.host, {
  theme,
  rowData: fixture.rows,
  columnDefs: toAgGridColDefs(fixture.columns),
  defaultColDef: { ...AG_GRID_DEFAULT_COL_DEF },
  getRowId: (params) => String(params.data.id),
  animateRows: false,
  cellFlashDuration: 0,
  cellFadeDuration: 0,
  rowBuffer: OVERSCAN_ROWS_PER_SIDE,
  rowHeight: ROW_HEIGHT_PX,
  headerHeight: HEADER_HEIGHT_PX,
  pagination: false,
  suppressMovableColumns: true,
  loadThemeGoogleFonts: false,
});
