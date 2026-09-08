import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDemoSortRows,
  moveSortModelEntry,
  nextAvailableSortColumn,
  orderDemoSortColumns,
  suggestNextDemoSortColumn,
  withAddedSort,
  withoutSortAt,
  withSortDirectionAt,
  withSortFieldAt,
} from "./sortPanelModel.ts";

describe("buildDemoSortRows", () => {
  it("maps sort model to labeled rows", () => {
    const rows = buildDemoSortRows({
      sortModel: [
        { field: "createdAt", sort: "desc" },
        { field: "balance", sort: "asc" },
      ],
      columns: [
        { field: "createdAt", headerName: "Created" },
        { field: "balance", headerName: "Balance" },
      ],
    });
    assert.equal(rows.length, 2);
    const firstRow = rows[0];
    const secondRow = rows[1];
    assert.ok(firstRow);
    assert.ok(secondRow);
    assert.equal(firstRow.label, "Created");
    assert.equal(firstRow.sort, "desc");
    assert.equal(secondRow.label, "Balance");
  });
});

describe("sort model helpers", () => {
  const base = [
    { field: "createdAt", sort: "desc" as const },
    { field: "balance", sort: "asc" as const },
  ];

  it("reorders by priority index", () => {
    assert.deepEqual(moveSortModelEntry(base, 1, 0), [
      { field: "balance", sort: "asc" },
      { field: "createdAt", sort: "desc" },
    ]);
  });

  it("updates field and direction", () => {
    assert.deepEqual(withSortFieldAt(base, 0, "name"), [
      { field: "name", sort: "desc" },
      { field: "balance", sort: "asc" },
    ]);
    assert.deepEqual(withSortDirectionAt(base, 1, "desc"), [
      { field: "createdAt", sort: "desc" },
      { field: "balance", sort: "desc" },
    ]);
  });

  it("adds and removes entries", () => {
    assert.deepEqual(withAddedSort(base, "name"), [
      ...base,
      { field: "name", sort: "asc" },
    ]);
    assert.deepEqual(withoutSortAt(base, 0), [
      { field: "balance", sort: "asc" },
    ]);
  });

  it("picks next unused sortable column", () => {
    const columns = [
      { field: "createdAt", label: "Created" },
      { field: "balance", label: "Balance" },
      { field: "name", label: "Customer" },
    ];
    assert.equal(
      nextAvailableSortColumn(columns, new Set(["createdAt", "balance"]))
        ?.field,
      "name",
    );
  });

  it("orders preferred low-cardinality columns first", () => {
    const ordered = orderDemoSortColumns(
      [
        { field: "name", label: "Customer" },
        { field: "bankBalance", label: "Balance" },
        { field: "status", label: "Status" },
        { field: "country", label: "Country" },
      ],
      ["status", "country"],
    );
    assert.deepEqual(
      ordered.map((column) => column.field),
      ["status", "country", "name", "bankBalance"],
    );
  });

  it("auto-picks Status then Balance and skips unique Customer", () => {
    const columns = [
      { field: "name", label: "Customer" },
      { field: "email", label: "Email" },
      { field: "status", label: "Status" },
      { field: "bankBalance", label: "Balance" },
      { field: "country", label: "Country" },
    ];
    const skipAutoFields = new Set(["name", "email", "__rowNumber"]);
    const first = suggestNextDemoSortColumn({
      columns,
      usedFields: new Set(),
      groupFields: ["status", "country"],
      tieBreakFields: ["bankBalance", "createdAt"],
      skipAutoFields,
    });
    assert.equal(first?.field, "status");

    const second = suggestNextDemoSortColumn({
      columns,
      usedFields: new Set(["status"]),
      groupFields: ["status", "country"],
      tieBreakFields: ["bankBalance", "createdAt"],
      skipAutoFields,
    });
    assert.equal(second?.field, "bankBalance");
  });
});
