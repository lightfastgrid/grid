import { describe, expect, it } from "vitest";

import type { ColumnDef } from "../../../types";
import { resolveCellEditEligibility } from "../eligibility";

function ctx(
  column: Partial<ColumnDef>,
  overrides: { value?: unknown } = {},
) {
  return {
    row: { name: "Alice" },
    rowIndex: 0,
    column: { field: "name", ...column } as ColumnDef,
    field: "name",
    value: overrides.value ?? "Alice",
  };
}

describe("resolveCellEditEligibility", () => {
  it("editable true is editable", () => {
    const result = resolveCellEditEligibility(ctx({ editable: true }));
    expect(result.editable).toBe(true);
  });

  it("editable false is not editable", () => {
    const result = resolveCellEditEligibility(ctx({ editable: false }));
    expect(result.editable).toBe(false);
  });

  it("editable omitted is not editable", () => {
    const result = resolveCellEditEligibility(ctx({}));
    expect(result.editable).toBe(false);
  });

  it("editable callback returning true is editable", () => {
    const result = resolveCellEditEligibility(
      ctx({ editable: () => true }),
    );
    expect(result.editable).toBe(true);
  });

  it("editable callback returning false is not editable", () => {
    const result = resolveCellEditEligibility(
      ctx({ editable: () => false }),
    );
    expect(result.editable).toBe(false);
    expect(result.reason).toBe("Callback returned false");
  });

  it("editable callback that throws is not editable", () => {
    const result = resolveCellEditEligibility(
      ctx({
        editable: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(result.editable).toBe(false);
    expect(result.reason).toBe("Editable callback threw");
  });

  it("editable callback receives correct context", () => {
    let captured: unknown;
    resolveCellEditEligibility(
      ctx({
        editable: (c) => {
          captured = c;
          return true;
        },
      }),
    );
    expect(captured).toEqual({
      row: { name: "Alice" },
      rowIndex: 0,
      column: expect.objectContaining({ field: "name" }),
      field: "name",
      value: "Alice",
    });
  });

  it("internal column is not editable", () => {
    const result = resolveCellEditEligibility(
      ctx({ editable: true, internal: "selection" }),
    );
    expect(result.editable).toBe(false);
    expect(result.reason).toBe("Internal column");
  });

  it("action column is not editable", () => {
    const result = resolveCellEditEligibility(
      ctx({ editable: true, cellKind: "actions" }),
    );
    expect(result.editable).toBe(false);
    expect(result.reason).toBe("Action column");
  });

  it("column with valueGetter is not editable", () => {
    const result = resolveCellEditEligibility(
      ctx({ editable: true, valueGetter: () => "computed" }),
    );
    expect(result.editable).toBe(false);
    expect(result.reason).toBe("Column has valueGetter");
  });

  it("unsafe field path is not editable", () => {
    const result = resolveCellEditEligibility({
      row: {},
      rowIndex: 0,
      column: { field: "__proto__", editable: true } as ColumnDef,
      field: "__proto__",
      value: undefined,
    });
    expect(result.editable).toBe(false);
    expect(result.reason).toBe("Unsafe field path");
  });
});
