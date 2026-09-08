import { describe, expect, it, vi } from "vitest";

import { GridState } from "../../../state/GridState";
import type {
  CellAccessibilityParams,
  LightFastGridColDef,
  LightFastGridDefaultColDef,
} from "../../../types";

describe("Section 6 body-cell public contract", () => {
  it("merges defaults with exact per-column precedence", () => {
    const defaultLabel = vi.fn(
      (_params: CellAccessibilityParams) => "default label",
    );
    const columnLabel = vi.fn(
      (_params: CellAccessibilityParams) => "column label",
    );
    const defaultDescription = vi.fn(
      (_params: CellAccessibilityParams) => "default-description",
    );
    const columnDescription = vi.fn(
      (_params: CellAccessibilityParams) => "column-description",
    );
    const defaultColDef: LightFastGridDefaultColDef = {
      getCellAriaLabel: defaultLabel,
      cellAriaDescribedBy: "default-static",
      getCellAriaDescribedBy: defaultDescription,
    };
    const columns: LightFastGridColDef[] = [
      { field: "inherited" },
      {
        field: "overridden",
        getCellAriaLabel: columnLabel,
        cellAriaDescribedBy: "column-static",
        getCellAriaDescribedBy: columnDescription,
      },
    ];
    const state = new GridState({ columns, rows: [], defaultColDef });

    const [inherited, overridden] = state.getSnapshot().columns;
    expect(inherited?.getCellAriaLabel).toBe(defaultLabel);
    expect(inherited?.cellAriaDescribedBy).toBe("default-static");
    expect(inherited?.getCellAriaDescribedBy).toBe(defaultDescription);
    expect(overridden?.getCellAriaLabel).toBe(columnLabel);
    expect(overridden?.cellAriaDescribedBy).toBe("column-static");
    expect(overridden?.getCellAriaDescribedBy).toBe(columnDescription);
  });
});
