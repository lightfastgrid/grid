import "@lightfastgrid/core/themes/default.css";
import "@lfg-benchmarks/shared/styles.css";

import { Grid } from "@lightfastgrid/core";
import {
  createBundleFixture,
  getRowId,
  LIGHTFASTGRID_DEFAULT_COL_DEF,
  LIGHTFASTGRID_THEME,
  mountVanillaBenchmarkChrome,
  toLightFastGridColumns,
} from "@lfg-benchmarks/shared/bundle";

const fixture = createBundleFixture();
const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root");
}

const chrome = mountVanillaBenchmarkChrome(container, {
  title: "LightFastGrid Vanilla",
  label: "lightfastgrid-vanilla",
  status: `${fixture.scenario} · bundle consumer · ${fixture.rows.length} rows × ${fixture.columns.length} columns`,
});

const grid = new Grid({
  rows: fixture.rows,
  columns: toLightFastGridColumns(fixture.columns),
  getRowId,
  defaultColDef: LIGHTFASTGRID_DEFAULT_COL_DEF,
  columnMenu: { enabled: false },
  cellMenu: { enabled: false },
  quickFilter: true,
  pagination: false,
  theme: LIGHTFASTGRID_THEME,
});
grid.mount(chrome.host);
