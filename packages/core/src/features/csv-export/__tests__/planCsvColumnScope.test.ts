import { describe, expect, it } from "vitest";

import type { ColumnDef } from "../../../types";
import {
  CsvExportDuplicateColumnError,
  CsvExportUnknownColumnError,
} from "../csvExportErrors";
import { normalizeCsvExportOptions } from "../normalizeCsvExportOptions";
import { planCsvColumnScope } from "../planCsvColumnScope";

import { makeSnapshot, membership } from "./support";

const SELECT: ColumnDef = { field: "__select", internal: "selection" };
const NAME: ColumnDef = { field: "name" };
const AGE: ColumnDef = { field: "age" };
const EMAIL: ColumnDef = { field: "email", visible: false };
const ACTIONS: ColumnDef = { field: "__actions", cellKind: "actions" };
const SECRET: ColumnDef = { field: "secret", exportable: false };
const CITY: ColumnDef = { field: "address.city" };

const VISIBLE: readonly ColumnDef[] = [SELECT, NAME, AGE, ACTIONS];
const ALL_LEAVES: readonly ColumnDef[] = [
  SELECT, NAME, AGE, EMAIL, ACTIONS, SECRET, CITY,
];

function snapshot(selectedColumns: readonly string[] = []) {
  return makeSnapshot({
    visibleColumns: VISIBLE,
    allLeafColumns: ALL_LEAVES,
    selectedColumnIds: membership(selectedColumns),
  });
}

const DEFAULTS = normalizeCsvExportOptions({});

function fields(plan: ReturnType<typeof planCsvColumnScope>): string[] {
  return plan.map((c) => (c.kind === "data" ? c.field : "#rowNumber"));
}

describe("planCsvColumnScope - visible scope (test 19)", () => {
  it("keeps lane order and excludes internal/utility by default", () => {
    const plan = planCsvColumnScope(snapshot(), { mode: "visible" }, DEFAULTS);
    expect(fields(plan)).toEqual(["name", "age"]);
  });
});

describe("planCsvColumnScope - all scope (test 20)", () => {
  it("includes hidden leaves in source order, excludes internal/utility/non-exportable", () => {
    const plan = planCsvColumnScope(snapshot(), { mode: "all" }, DEFAULTS);
    expect(fields(plan)).toEqual(["name", "age", "email", "address.city"]);
  });
});

describe("planCsvColumnScope - selected scope (test 21)", () => {
  it("emits selected visible columns in display lane order", () => {
    const plan = planCsvColumnScope(
      snapshot(["age", "name"]),
      { mode: "selected" },
      DEFAULTS,
    );
    expect(fields(plan)).toEqual(["name", "age"]);
  });
});

describe("planCsvColumnScope - fields scope (tests 22-23)", () => {
  it("emits caller field order, including hidden columns", () => {
    const plan = planCsvColumnScope(
      snapshot(),
      { mode: "fields", fields: ["age", "email", "name"] },
      DEFAULTS,
    );
    expect(fields(plan)).toEqual(["age", "email", "name"]);
  });

  it("unknown field throws", () => {
    expect(() =>
      planCsvColumnScope(snapshot(), { mode: "fields", fields: ["nope"] }, DEFAULTS),
    ).toThrow(CsvExportUnknownColumnError);
  });

  it("duplicate field throws", () => {
    expect(() =>
      planCsvColumnScope(
        snapshot(),
        { mode: "fields", fields: ["name", "name"] },
        DEFAULTS,
      ),
    ).toThrow(CsvExportDuplicateColumnError);
  });

  it("nested dot-path field name resolves as an ordinary column id", () => {
    const plan = planCsvColumnScope(
      snapshot(),
      { mode: "fields", fields: ["address.city"] },
      DEFAULTS,
    );
    expect(fields(plan)).toEqual(["address.city"]);
  });

  it("a single field represents a one-column (one-cell) export", () => {
    const plan = planCsvColumnScope(
      snapshot(),
      { mode: "fields", fields: ["name"] },
      DEFAULTS,
    );
    expect(plan).toHaveLength(1);
    expect(fields(plan)).toEqual(["name"]);
  });
});

describe("planCsvColumnScope - internal/utility opt-in (test 24)", () => {
  it("excludes internal & utility columns by default", () => {
    const plan = planCsvColumnScope(snapshot(), { mode: "visible" }, DEFAULTS);
    expect(fields(plan)).toEqual(["name", "age"]);
  });

  it("includes internal columns when opted in", () => {
    const opts = normalizeCsvExportOptions({ includeInternalColumns: true });
    const plan = planCsvColumnScope(snapshot(), { mode: "visible" }, opts);
    expect(fields(plan)).toEqual(["__select", "name", "age"]);
  });

  it("allows an applicable internal column to be requested explicitly", () => {
    const plan = planCsvColumnScope(
      snapshot(),
      { mode: "fields", fields: ["__select"] },
      DEFAULTS,
    );
    expect(fields(plan)).toEqual(["__select"]);
  });

  it("includes utility columns when opted in", () => {
    const opts = normalizeCsvExportOptions({ includeUtilityColumns: true });
    const plan = planCsvColumnScope(snapshot(), { mode: "visible" }, opts);
    expect(fields(plan)).toEqual(["name", "age", "__actions"]);
  });

  it("exportable:false stays excluded even when explicitly requested", () => {
    expect(() =>
      planCsvColumnScope(
        snapshot(),
        { mode: "fields", fields: ["secret"] },
        DEFAULTS,
      ),
    ).toThrow(CsvExportUnknownColumnError);
  });
});

describe("planCsvColumnScope - synthetic row-number column (test 25)", () => {
  it("prepends default Row / 1", () => {
    const opts = normalizeCsvExportOptions({ includeRowNumbers: true });
    const plan = planCsvColumnScope(snapshot(), { mode: "visible" }, opts);
    expect(plan[0]).toStrictEqual({
      kind: "rowNumber",
      headerName: "Row",
      startAt: 1,
    });
    expect(fields(plan)).toEqual(["#rowNumber", "name", "age"]);
  });

  it("preserves explicit zero start and empty header", () => {
    const opts = normalizeCsvExportOptions({
      includeRowNumbers: { headerName: "", startAt: 0 },
    });
    const plan = planCsvColumnScope(snapshot(), { mode: "visible" }, opts);
    expect(plan[0]).toStrictEqual({
      kind: "rowNumber",
      headerName: "",
      startAt: 0,
    });
  });
});

describe("planCsvColumnScope - no ColumnDef mutation", () => {
  it("references column defs without cloning or mutating them", () => {
    const cols = [NAME, AGE].map((c) => Object.freeze({ ...c }) as ColumnDef);
    const snap = makeSnapshot({
      visibleColumns: Object.freeze([...cols]) as readonly ColumnDef[],
      allLeafColumns: Object.freeze([...cols]) as readonly ColumnDef[],
    });
    const plan = planCsvColumnScope(snap, { mode: "visible" }, DEFAULTS);
    expect(plan[0]).toMatchObject({ kind: "data" });
    if (plan[0]?.kind === "data") expect(plan[0].column).toBe(cols[0]);
    if (plan[1]?.kind === "data") expect(plan[1].column).toBe(cols[1]);
  });
});
