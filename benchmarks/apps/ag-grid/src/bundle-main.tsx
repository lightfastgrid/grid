import "@lfg-benchmarks/shared/styles.css";

import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import {
  AG_GRID_DEFAULT_COL_DEF,
  createBundleFixture,
  HEADER_HEIGHT_PX,
  OVERSCAN_ROWS_PER_SIDE,
  ROW_HEIGHT_PX,
  toAgGridColDefs,
} from "@lfg-benchmarks/shared/bundle";
import { BenchmarkShell, GridHost } from "@lfg-benchmarks/shared/react-shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

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

createRoot(container).render(
  <StrictMode>
    <BenchmarkShell
      title="AG Grid Community"
      status={`${fixture.scenario} · bundle consumer · ${fixture.rows.length} rows × ${fixture.columns.length} columns`}
    >
      <GridHost label="ag-grid">
        <AgGridReact
          theme={theme}
          rowData={fixture.rows}
          columnDefs={toAgGridColDefs(fixture.columns)}
          defaultColDef={{ ...AG_GRID_DEFAULT_COL_DEF }}
          getRowId={(params) => String(params.data.id)}
          animateRows={false}
          cellFlashDuration={0}
          cellFadeDuration={0}
          rowBuffer={OVERSCAN_ROWS_PER_SIDE}
          rowHeight={ROW_HEIGHT_PX}
          headerHeight={HEADER_HEIGHT_PX}
          pagination={false}
          suppressMovableColumns
          loadThemeGoogleFonts={false}
        />
      </GridHost>
    </BenchmarkShell>
  </StrictMode>,
);
