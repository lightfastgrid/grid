import { describe, expect, it } from "vitest";

import type { ColumnGroupPathMeta } from "../../../types";
import type { CsvPlannedColumn } from "../planCsvColumnScope";
import {
  type CsvGroupHeaderRow,
  planCsvGroupHeaders,
} from "../planCsvGroupHeaders";

import { makeSnapshot } from "./support";

function dataCol(field: string): CsvPlannedColumn {
  return { kind: "data", column: { field }, field };
}
const ROW_NUMBER: CsvPlannedColumn = {
  kind: "rowNumber",
  headerName: "Row",
  startAt: 1,
};

// a,b under G1>S1; c under G1>S2; e under G2>S3; d is ungrouped.
const META: Record<string, ColumnGroupPathMeta> = {
  a: { path: [{ id: "g1", headerName: "G1", level: 0 }, { id: "s1", headerName: "S1", level: 1 }] },
  b: { path: [{ id: "g1", headerName: "G1", level: 0 }, { id: "s1", headerName: "S1", level: 1 }] },
  c: { path: [{ id: "g1", headerName: "G1", level: 0 }, { id: "s2", headerName: "S2", level: 1 }] },
  e: { path: [{ id: "g2", headerName: "G2", level: 0 }, { id: "s3", headerName: "S3", level: 1 }] },
};

function describeRow(row: CsvGroupHeaderRow): string[] {
  return row.segments.map((s) => (s.run ? `${s.run.headerName}:${s.span}` : `_:${s.span}`));
}

function plan(columns: CsvPlannedColumn[], displayEnabled = true) {
  const snapshot = makeSnapshot({
    groupMetaByField: META,
    groupHeaderDisplayEnabled: displayEnabled,
  });
  return planCsvGroupHeaders(snapshot, columns, undefined);
}

describe("planCsvGroupHeaders - flat columns (test 27)", () => {
  it("returns no rows when no column has group depth", () => {
    const snapshot = makeSnapshot({ groupMetaByField: {}, groupHeaderDisplayEnabled: true });
    const result = planCsvGroupHeaders(snapshot, [dataCol("x"), dataCol("y")], undefined);
    expect(result.rows).toEqual([]);
  });
});

describe("planCsvGroupHeaders - nested contiguous runs (test 26)", () => {
  it("emits one row per depth with contiguous spans", () => {
    const result = plan([dataCol("a"), dataCol("b"), dataCol("c")]);
    expect(result.rows).toHaveLength(2);
    expect(describeRow(result.rows[0]!)).toEqual(["G1:3"]);
    expect(describeRow(result.rows[1]!)).toEqual(["S1:2", "S2:1"]);
  });

  it("retains groupId, level, and covered fields per run", () => {
    const result = plan([dataCol("a"), dataCol("b"), dataCol("c")]);
    const level0 = result.rows[0]!.segments[0]!.run!;
    expect(level0).toMatchObject({ groupId: "g1", level: 0 });
    expect(level0.fields).toEqual(["a", "b", "c"]);
    const level1 = result.rows[1]!.segments[0]!.run!;
    expect(level1).toMatchObject({ groupId: "s1", level: 1 });
    expect(level1.fields).toEqual(["a", "b"]);
  });
});

describe("planCsvGroupHeaders - split runs", () => {
  it("splits a group when an ungrouped leaf creates a gap", () => {
    const result = plan([dataCol("a"), dataCol("d"), dataCol("c")]);
    expect(describeRow(result.rows[0]!)).toEqual(["G1:1", "_:1", "G1:1"]);
    expect(describeRow(result.rows[1]!)).toEqual(["S1:1", "_:1", "S2:1"]);
  });

  it("splits a group when column order interleaves another group", () => {
    const result = plan([dataCol("a"), dataCol("e"), dataCol("b")]);
    expect(describeRow(result.rows[0]!)).toEqual(["G1:1", "G2:1", "G1:1"]);
    expect(describeRow(result.rows[1]!)).toEqual(["S1:1", "S3:1", "S1:1"]);
  });
});

describe("planCsvGroupHeaders - row-number spacer", () => {
  it("contributes an empty group cell at every level", () => {
    const result = plan([ROW_NUMBER, dataCol("a"), dataCol("b")]);
    expect(describeRow(result.rows[0]!)).toEqual(["_:1", "G1:2"]);
    expect(describeRow(result.rows[1]!)).toEqual(["_:1", "S1:2"]);
  });
});

describe("planCsvGroupHeaders - includeColumnGroupHeaders tri-state", () => {
  const columns = [dataCol("a"), dataCol("b")];

  it("undefined follows captured display state", () => {
    const enabled = makeSnapshot({ groupMetaByField: META, groupHeaderDisplayEnabled: true });
    const disabled = makeSnapshot({ groupMetaByField: META, groupHeaderDisplayEnabled: false });
    expect(planCsvGroupHeaders(enabled, columns, undefined).rows).toHaveLength(2);
    expect(planCsvGroupHeaders(disabled, columns, undefined).rows).toEqual([]);
  });

  it("true forces structural headers even when display is suppressed", () => {
    const disabled = makeSnapshot({ groupMetaByField: META, groupHeaderDisplayEnabled: false });
    expect(planCsvGroupHeaders(disabled, columns, true).rows).toHaveLength(2);
  });

  it("false suppresses headers even when display is enabled", () => {
    const enabled = makeSnapshot({ groupMetaByField: META, groupHeaderDisplayEnabled: true });
    expect(planCsvGroupHeaders(enabled, columns, false).rows).toEqual([]);
  });
});
