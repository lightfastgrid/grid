// Unit tests for the sizing column menu contribution.
// No DOM, no Grid mount — tests the contribution logic in isolation.

import { describe, expect, it, vi } from "vitest";

import type { ColumnMenuContext } from "../../column-menu/types";
import { sizingMenuContribution } from "../sizingMenuContribution";

function makeCtx(overrides: Partial<ColumnMenuContext> = {}): ColumnMenuContext {
  return {
    field: "a",
    column: { field: "a" },
    columns: [{ field: "a" }, { field: "b" }],
    sortModel: [],
    selectedColumnIds: [],
    close: vi.fn(),
    ...overrides,
  };
}

describe("sizingMenuContribution", () => {
  it("returns empty when sizing option is omitted", () => {
    const sizeColumnsToFit = vi.fn();
    const contrib = sizingMenuContribution({
      sizeColumnsToFit,
      getOptions: () => ({ enabled: true, sort: true }),
    });
    const sections = contrib.getSections(makeCtx());
    expect(sections).toHaveLength(0);
  });

  it("returns empty when sizing option is false", () => {
    const contrib = sizingMenuContribution({
      sizeColumnsToFit: vi.fn(),
      getOptions: () => ({ enabled: true, sizing: false }),
    });
    expect(contrib.getSections(makeCtx())).toHaveLength(0);
  });

  it("returns empty when sizing.sizeColumnsToFit is false", () => {
    const contrib = sizingMenuContribution({
      sizeColumnsToFit: vi.fn(),
      getOptions: () => ({
        enabled: true,
        sizing: { sizeColumnsToFit: false },
      }),
    });
    expect(contrib.getSections(makeCtx())).toHaveLength(0);
  });

  it("shows 'Size columns to fit' when sizing.sizeColumnsToFit is true", () => {
    const contrib = sizingMenuContribution({
      sizeColumnsToFit: vi.fn(),
      getOptions: () => ({
        enabled: true,
        sizing: { sizeColumnsToFit: true },
      }),
    });
    const sections = contrib.getSections(makeCtx());
    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe("sizing");
    expect(sections[0]!.items).toHaveLength(1);
    expect(sections[0]!.items[0]!.id).toBe("size-columns-to-fit");
    expect(sections[0]!.items[0]!.label).toBe("Size columns to fit");
  });

  it("shows item when sizing is true (boolean shorthand)", () => {
    const contrib = sizingMenuContribution({
      sizeColumnsToFit: vi.fn(),
      getOptions: () => ({ enabled: true, sizing: true }),
    });
    const sections = contrib.getSections(makeCtx());
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items[0]!.label).toBe("Size columns to fit");
  });

  it("clicking the item calls sizeColumnsToFit with source 'ui'", () => {
    const sizeColumnsToFit = vi.fn();
    const contrib = sizingMenuContribution({
      sizeColumnsToFit,
      getOptions: () => ({ sizing: { sizeColumnsToFit: true } }),
    });
    const ctx = makeCtx();
    const sections = contrib.getSections(ctx);
    sections[0]!.items[0]!.action!();
    expect(sizeColumnsToFit).toHaveBeenCalledTimes(1);
    expect(sizeColumnsToFit).toHaveBeenCalledWith("ui");
  });

  it("clicking the item closes the menu", () => {
    const close = vi.fn();
    const contrib = sizingMenuContribution({
      sizeColumnsToFit: vi.fn(),
      getOptions: () => ({ sizing: { sizeColumnsToFit: true } }),
    });
    const ctx = makeCtx({ close });
    const sections = contrib.getSections(ctx);
    sections[0]!.items[0]!.action!();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("action does not depend on a specific column being eligible", () => {
    // The sizing action is grid-level, not column-level.
    // It should work regardless of which column's menu it appears in.
    const sizeColumnsToFit = vi.fn();
    const contrib = sizingMenuContribution({
      sizeColumnsToFit,
      getOptions: () => ({ sizing: { sizeColumnsToFit: true } }),
    });
    // Call from column "b"
    const ctx = makeCtx({ field: "b", column: { field: "b" } });
    const sections = contrib.getSections(ctx);
    expect(sections).toHaveLength(1);
    sections[0]!.items[0]!.action!();
    expect(sizeColumnsToFit).toHaveBeenCalledTimes(1);
  });
});
