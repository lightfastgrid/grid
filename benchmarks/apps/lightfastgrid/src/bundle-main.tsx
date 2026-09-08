import "@lightfastgrid/core/themes/default.css";
import "@lfg-benchmarks/shared/styles.css";

import { LightFastGrid } from "@lightfastgrid/react";
import {
  createBundleFixture,
  getRowId,
  LIGHTFASTGRID_DEFAULT_COL_DEF,
  LIGHTFASTGRID_THEME,
  toLightFastGridColumns,
} from "@lfg-benchmarks/shared/bundle";
import { BenchmarkShell, GridHost } from "@lfg-benchmarks/shared/react-shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const fixture = createBundleFixture();
const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root");
}

createRoot(container).render(
  <StrictMode>
    <BenchmarkShell
      title="LightFastGrid"
      status={`${fixture.scenario} · bundle consumer · ${fixture.rows.length} rows × ${fixture.columns.length} columns`}
    >
      <GridHost label="lightfastgrid">
        <LightFastGrid
          rows={fixture.rows}
          columns={toLightFastGridColumns(fixture.columns)}
          getRowId={getRowId}
          defaultColDef={LIGHTFASTGRID_DEFAULT_COL_DEF}
          columnMenu={{ enabled: false }}
          cellMenu={{ enabled: false }}
          quickFilter
          pagination={false}
          theme={LIGHTFASTGRID_THEME}
          height="100%"
        />
      </GridHost>
    </BenchmarkShell>
  </StrictMode>,
);
