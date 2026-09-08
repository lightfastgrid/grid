import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDemoColumnList,
  filterDemoColumns,
  labelFromColumnField,
} from "./listDemoColumns.ts";

describe("labelFromColumnField", () => {
  it("title-cases camelCase and snake fields", () => {
    assert.equal(labelFromColumnField("bankBalance"), "Bank Balance");
    assert.equal(labelFromColumnField("created_at"), "Created At");
    assert.equal(labelFromColumnField("id"), "Id");
  });
});

describe("buildDemoColumnList", () => {
  it("uses headerName / pinnable and joins live visibility + pin", () => {
    const snapshot = buildDemoColumnList({
      columns: [
        {
          field: "__rowNumber",
          headerName: "ID",
          pinned: "left",
          pinnable: false,
        },
        { field: "name", headerName: "Customer", pinnable: true },
        { field: "balance", headerName: "Balance", visible: false },
        { field: "__sel", headerName: "Sel", internal: "selection" },
      ],
      visibilityState: [
        { field: "__rowNumber", visible: true },
        { field: "name", visible: true },
        { field: "balance", visible: false },
      ],
      pinState: [
        { field: "__rowNumber", pinned: "left" },
        { field: "name", pinned: "left" },
        { field: "balance", pinned: false },
      ],
      selectedColumnIds: ["name"],
    });

    assert.equal(snapshot.totalCount, 3);
    assert.equal(snapshot.hiddenCount, 1);
    const firstColumn = snapshot.columns[0];
    const secondColumn = snapshot.columns[1];
    assert.ok(firstColumn);
    assert.ok(secondColumn);
    assert.equal(firstColumn.label, "ID");
    assert.equal(firstColumn.pinnable, false);
    assert.equal(secondColumn.pinned, "left");
    assert.equal(secondColumn.pinnable, true);
    assert.deepEqual(snapshot.selectedColumnIds, ["name"]);
  });
});

describe("filterDemoColumns", () => {
  it("matches label or field case-insensitively", () => {
    const columns = buildDemoColumnList({
      columns: [
        { field: "id", headerName: "ID" },
        { field: "email", headerName: "Email" },
      ],
      visibilityState: [
        { field: "id", visible: true },
        { field: "email", visible: true },
      ],
      pinState: [],
      selectedColumnIds: [],
    }).columns;

    assert.equal(filterDemoColumns(columns, "em").length, 1);
    assert.equal(filterDemoColumns(columns, "ID")[0]?.field, "id");
    assert.equal(filterDemoColumns(columns, "  ").length, 2);
  });
});
