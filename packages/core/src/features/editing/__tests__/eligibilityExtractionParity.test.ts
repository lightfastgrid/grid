/**
 * Boolean Cell V1 — Test 47.
 *
 * Explicit parity proof for the neutral-eligibility extraction. The rules moved
 * from `features/editing/eligibility.ts` into `internal/cellEditEligibility.ts`
 * and must be observably identical:
 *
 *  - the editing feature's exported symbol resolves to the neutral one;
 *  - every input combination produces the same `{ editable, reason }`;
 *  - the callback contract (arguments, call count, throw handling) is unchanged;
 *  - rule precedence is unchanged.
 */

import { describe, expect, it, vi } from "vitest";

import {
  isCellEditEligible,
  resolveCellEditEligibility as neutralResolver,
} from "../../../internal/cellEditEligibility";
import type { CellEditEligibilityContext, ColumnDef, RowData } from "../../../types";
import { resolveCellEditEligibility as editingResolver } from "../eligibility";

function col(overrides: Partial<ColumnDef> = {}): ColumnDef {
  return { field: "f", ...overrides };
}

interface Case {
  name: string;
  column: ColumnDef;
  field?: string;
  row?: RowData;
  expected: { editable: boolean; reason?: string };
}

/** Every branch of the resolver, including precedence between branches. */
const CASES: Case[] = [
  // Hard exclusions
  {
    name: "internal column",
    column: col({ editable: true, internal: "selection" }),
    expected: { editable: false, reason: "Internal column" },
  },
  {
    name: "action column",
    column: col({ editable: true, cellKind: "actions" }),
    expected: { editable: false, reason: "Action column" },
  },
  {
    name: "valueGetter column",
    column: col({ editable: true, valueGetter: () => 1 }),
    expected: { editable: false, reason: "Column has valueGetter" },
  },
  {
    name: "unsafe field path",
    column: col({ editable: true }),
    field: "__proto__",
    expected: { editable: false, reason: "Unsafe field path" },
  },
  // Static editable
  {
    name: "editable undefined",
    column: col(),
    expected: { editable: false, reason: "Not editable" },
  },
  {
    name: "editable false",
    column: col({ editable: false }),
    expected: { editable: false, reason: "Not editable" },
  },
  {
    name: "editable true",
    column: col({ editable: true }),
    expected: { editable: true },
  },
  // Callback editable
  {
    name: "callback true",
    column: col({ editable: () => true }),
    expected: { editable: true },
  },
  {
    name: "callback false",
    column: col({ editable: () => false }),
    expected: { editable: false, reason: "Callback returned false" },
  },
  {
    name: "callback throws",
    column: col({
      editable: () => {
        throw new Error("boom");
      },
    }),
    expected: { editable: false, reason: "Editable callback threw" },
  },
  // Precedence: a hard exclusion wins over a permissive callback.
  {
    name: "internal beats callback",
    column: col({ internal: "selection", editable: () => true }),
    expected: { editable: false, reason: "Internal column" },
  },
  {
    name: "valueGetter beats callback",
    column: col({ valueGetter: () => 1, editable: () => true }),
    expected: { editable: false, reason: "Column has valueGetter" },
  },
  {
    name: "action beats callback",
    column: col({ cellKind: "actions", editable: () => true }),
    expected: { editable: false, reason: "Action column" },
  },
  {
    name: "unsafe path beats callback",
    column: col({ editable: () => true }),
    field: "a.constructor",
    expected: { editable: false, reason: "Unsafe field path" },
  },
];

describe("eligibility parity after neutral extraction (Test 47)", () => {
  it("the editing export is the neutral implementation, not a copy", () => {
    expect(editingResolver).toBe(neutralResolver);
  });

  it.each(CASES)("$name produces the documented result", (testCase) => {
    const input = {
      row: testCase.row ?? { f: 1 },
      rowIndex: 0,
      column: testCase.column,
      field: testCase.field ?? "f",
      value: 1,
    };
    expect(editingResolver(input)).toEqual(testCase.expected);
  });

  it("both entry points agree on every case", () => {
    for (const testCase of CASES) {
      const input = {
        row: testCase.row ?? { f: 1 },
        rowIndex: 0,
        column: testCase.column,
        field: testCase.field ?? "f",
        value: 1,
      };
      expect(editingResolver(input)).toEqual(neutralResolver(input));
    }
  });

  it("the allocation-free boolean entry point agrees with the detailed result", () => {
    for (const testCase of CASES) {
      const input = {
        row: testCase.row ?? { f: 1 },
        rowIndex: 0,
        column: testCase.column,
        field: testCase.field ?? "f",
        value: 1,
      };
      expect(isCellEditEligible(input)).toBe(testCase.expected.editable);
    }
  });

  it("invokes the editable callback exactly once with the documented context", () => {
    const editable = vi.fn<[CellEditEligibilityContext], boolean>(() => true);
    const column = col({ editable });
    const row: RowData = { f: 42 };

    editingResolver({ row, rowIndex: 7, column, field: "f", value: 42 });

    expect(editable).toHaveBeenCalledTimes(1);
    const received = editable.mock.calls[0]![0];
    expect(received.row).toBe(row);
    expect(received.column).toBe(column);
    expect(received.rowIndex).toBe(7);
    expect(received.field).toBe("f");
    expect(received.value).toBe(42);
  });

  it("does not invoke the callback when a hard exclusion applies", () => {
    const editable = vi.fn(() => true);
    for (const column of [
      col({ internal: "selection", editable }),
      col({ cellKind: "actions", editable }),
      col({ valueGetter: () => 1, editable }),
    ]) {
      editingResolver({ row: { f: 1 }, rowIndex: 0, column, field: "f", value: 1 });
    }
    // Unsafe field path likewise short-circuits before the callback.
    editingResolver({
      row: { f: 1 },
      rowIndex: 0,
      column: col({ editable }),
      field: "__proto__",
      value: 1,
    });
    expect(editable).not.toHaveBeenCalled();
  });

  it("never mutates the column or row", () => {
    const column = col({ editable: true });
    const row: RowData = { f: 1 };
    const columnSnapshot = JSON.stringify(column);
    const rowSnapshot = JSON.stringify(row);

    editingResolver({ row, rowIndex: 0, column, field: "f", value: 1 });

    expect(JSON.stringify(column)).toBe(columnSnapshot);
    expect(JSON.stringify(row)).toBe(rowSnapshot);
  });
});
