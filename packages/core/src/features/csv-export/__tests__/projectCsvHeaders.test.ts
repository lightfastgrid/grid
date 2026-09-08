import { describe, expect, it, vi } from "vitest";

import type { ColumnGroupPathMeta } from "../../../types";
import type { CsvPlannedColumn } from "../planCsvColumnScope";
import { planCsvGroupHeaders } from "../planCsvGroupHeaders";
import { projectCsvHeaders } from "../projectCsvHeaders";

import { makeSnapshot } from "./support";

function dataCol(field: string, headerName?: string): CsvPlannedColumn {
  return { kind: "data", column: { field, headerName }, field };
}
const ROW_NUMBER: CsvPlannedColumn = {
  kind: "rowNumber",
  headerName: "Row",
  startAt: 1,
};

// a,b under G1>S1; c under G1>S2.
const META: Record<string, ColumnGroupPathMeta> = {
  a: { path: [{ id: "g1", headerName: "G1", level: 0 }, { id: "s1", headerName: "S1", level: 1 }] },
  b: { path: [{ id: "g1", headerName: "G1", level: 0 }, { id: "s1", headerName: "S1", level: 1 }] },
  c: { path: [{ id: "g1", headerName: "G1", level: 0 }, { id: "s2", headerName: "S2", level: 1 }] },
};

const COLUMNS: CsvPlannedColumn[] = [
  ROW_NUMBER,
  dataCol("a", "A"),
  dataCol("b"),
  dataCol("c", "C"),
];

function groupPlan(columns: CsvPlannedColumn[], forced = true) {
  const snapshot = makeSnapshot({ groupMetaByField: META, groupHeaderDisplayEnabled: true });
  return planCsvGroupHeaders(snapshot, columns, forced);
}

describe("projectCsvHeaders - leaf row", () => {
  it("uses headerName ?? field, and the row-number virtual header", () => {
    const result = projectCsvHeaders({
      plannedColumns: COLUMNS,
      groupHeaderPlan: { rows: [] },
      includeColumnHeaders: true,
    });
    expect(result.leafRow).toEqual(["Row", "A", "b", "C"]);
  });

  it("is null when includeColumnHeaders is false", () => {
    const result = projectCsvHeaders({
      plannedColumns: COLUMNS,
      groupHeaderPlan: { rows: [] },
      includeColumnHeaders: false,
    });
    expect(result.leafRow).toBeNull();
  });

  it("runs processHeader once per data column only (not row-number)", () => {
    const processHeader = vi.fn((p: { headerName: string }) => `[${p.headerName}]`);
    const result = projectCsvHeaders({
      plannedColumns: COLUMNS,
      groupHeaderPlan: { rows: [] },
      includeColumnHeaders: true,
      processHeader,
    });
    expect(result.leafRow).toEqual(["Row", "[A]", "[b]", "[C]"]);
    expect(processHeader).toHaveBeenCalledTimes(3);
  });
});

describe("projectCsvHeaders - group rows", () => {
  it("expands runs to label plus span-1 empties with spacers", () => {
    const result = projectCsvHeaders({
      plannedColumns: COLUMNS,
      groupHeaderPlan: groupPlan(COLUMNS),
      includeColumnHeaders: false,
    });
    expect(result.groupRows).toEqual([
      ["", "G1", "", ""], // level 0: rowNumber spacer, G1 span 3
      ["", "S1", "", "S2"], // level 1: spacer, S1 span 2, S2 span 1
    ]);
  });

  it("runs processGroupHeader once per contiguous run with exact params", () => {
    const processGroupHeader = vi.fn((p: { headerName: string }) => `<${p.headerName}>`);
    const result = projectCsvHeaders({
      plannedColumns: COLUMNS,
      groupHeaderPlan: groupPlan(COLUMNS),
      includeColumnHeaders: false,
      processGroupHeader,
    });
    expect(result.groupRows).toEqual([
      ["", "<G1>", "", ""],
      ["", "<S1>", "", "<S2>"],
    ]);
    expect(processGroupHeader).toHaveBeenCalledTimes(3);
    expect(processGroupHeader).toHaveBeenCalledWith({
      groupId: "g1",
      headerName: "G1",
      level: 0,
      fields: ["a", "b", "c"],
    });
    expect(processGroupHeader).toHaveBeenCalledWith({
      groupId: "s1",
      headerName: "S1",
      level: 1,
      fields: ["a", "b"],
    });
    expect(processGroupHeader).toHaveBeenCalledWith({
      groupId: "s2",
      headerName: "S2",
      level: 1,
      fields: ["c"],
    });
  });
});

describe("projectCsvHeaders - group/leaf independence", () => {
  it("emits group rows even when leaf headers are suppressed", () => {
    const result = projectCsvHeaders({
      plannedColumns: COLUMNS,
      groupHeaderPlan: groupPlan(COLUMNS),
      includeColumnHeaders: false,
    });
    expect(result.leafRow).toBeNull();
    expect(result.groupRows).toHaveLength(2);
  });
});

describe("projectCsvHeaders - callback error propagation", () => {
  it("propagates processHeader errors", () => {
    expect(() =>
      projectCsvHeaders({
        plannedColumns: COLUMNS,
        groupHeaderPlan: { rows: [] },
        includeColumnHeaders: true,
        processHeader: () => {
          throw new Error("header");
        },
      }),
    ).toThrow("header");
  });

  it("propagates processGroupHeader errors", () => {
    expect(() =>
      projectCsvHeaders({
        plannedColumns: COLUMNS,
        groupHeaderPlan: groupPlan(COLUMNS),
        includeColumnHeaders: false,
        processGroupHeader: () => {
          throw new Error("group");
        },
      }),
    ).toThrow("group");
  });
});
