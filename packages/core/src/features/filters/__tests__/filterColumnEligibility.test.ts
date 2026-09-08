import { describe, expect, it } from "vitest";

import {
  isColumnFilterEligible,
  resolveColumnFilterable,
} from "../filterColumnEligibility";

describe("filter column eligibility", () => {
  it("excludes action columns even when filtering is enabled by default", () => {
    const column = { field: "actions", cellKind: "actions" } as const;

    expect(isColumnFilterEligible(column)).toBe(false);
    expect(
      resolveColumnFilterable({ column, defaultFilter: true }),
    ).toBe(false);
  });

  it("excludes the internal selection column", () => {
    const column = { field: "__lfg_selection__", internal: "selection" } as const;

    expect(isColumnFilterEligible(column)).toBe(false);
    expect(
      resolveColumnFilterable({ column, columnFilterable: true }),
    ).toBe(false);
  });

  it("excludes the internal row-drag column", () => {
    const column = { field: "__lfg_row_drag__", internal: "row-drag" } as const;

    expect(isColumnFilterEligible(column)).toBe(false);
    expect(
      resolveColumnFilterable({ column, columnFilterable: true }),
    ).toBe(false);
  });

  it("excludes the internal combined row-controls column", () => {
    const column = { field: "__lfg_row_controls__", internal: "row-controls" } as const;

    expect(isColumnFilterEligible(column)).toBe(false);
    expect(
      resolveColumnFilterable({ column, columnFilterable: true }),
    ).toBe(false);
  });

  it("preserves default filter inheritance for data columns", () => {
    const column = { field: "name" };

    expect(isColumnFilterEligible(column)).toBe(true);
    expect(
      resolveColumnFilterable({ column, defaultFilter: true }),
    ).toBe(true);
  });
});
