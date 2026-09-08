import { describe, expect, it } from "vitest";

import type {
  ColumnDef,
  ColumnGroupHeadersSnapshot,
} from "../../../../types";
import { planKeyboardNavigationTopology } from "../planNavigationTopology";

function column(
  field: string,
  overrides: Partial<ColumnDef> = {},
): ColumnDef {
  return { field, ...overrides };
}

function groups(
  paths: Record<string, Array<[id: string, headerName: string]>>,
): ColumnGroupHeadersSnapshot {
  let depth = 0;
  const byField: ColumnGroupHeadersSnapshot["byField"] = {};
  for (const [field, path] of Object.entries(paths)) {
    if (path.length > depth) depth = path.length;
    byField[field] = {
      path: path.map(([id, headerName], level) => ({ id, headerName, level })),
    };
  }
  return { depth, byField };
}

describe("Accessibility V2 keyboard topology", () => {
  it("138: orders visible columns by pin lane and preserves definitions", () => {
    const center = column("center");
    const right = column("right", { pinned: "right" });
    const hidden = column("hidden", { visible: false });
    const left = column("left", { pinned: "left" });

    const plan = planKeyboardNavigationTopology({
      columns: [center, right, hidden, left],
      hasFloatingFilterRow: false,
      topologyRevision: 1,
    });

    expect(plan.columns.map((entry) => entry.field)).toEqual([
      "left",
      "center",
      "right",
    ]);
    expect(plan.columns[1]!.column).toBe(center);
    expect(plan.columnOrdinalByField.get("right")).toBe(2);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.columns)).toBe(true);
  });

  it("139: splits group runs on gaps, identities, and pin boundaries", () => {
    const plan = planKeyboardNavigationTopology({
      columns: [
        column("a", { pinned: "left" }),
        column("b"),
        column("gap"),
        column("c"),
        column("d"),
      ],
      columnGroupHeaders: groups({
        a: [["root/team", "Team"]],
        b: [["root/team", "Team"]],
        c: [["root/team", "Team"]],
        d: [["root/other", "Other"]],
      }),
      hasFloatingFilterRow: true,
      topologyRevision: 2,
    });

    expect(plan.groupRows).toHaveLength(1);
    expect(plan.groupRows[0]!.spans).toEqual([
      expect.objectContaining({ groupId: "root/team", startColumnOrdinal: 0, endColumnOrdinal: 0 }),
      expect.objectContaining({ groupId: "root/team", startColumnOrdinal: 1, endColumnOrdinal: 1 }),
      expect.objectContaining({ groupId: "root/team", startColumnOrdinal: 3, endColumnOrdinal: 3 }),
      expect.objectContaining({ groupId: "root/other", startColumnOrdinal: 4, endColumnOrdinal: 4 }),
    ]);
    expect(plan.hasFloatingFilterRow).toBe(true);
  });

  it("builds O(1) previous/next data-column links around internals", () => {
    const plan = planKeyboardNavigationTopology({
      columns: [
        column("select", { internal: "selection" }),
        column("a"),
        column("aux", { internal: "selection" }),
        column("b"),
      ],
      hasFloatingFilterRow: false,
      topologyRevision: 3,
    });

    expect(plan.previousDataColumnOrdinal).toEqual([-1, -1, 1, 1]);
    expect(plan.nextDataColumnOrdinal).toEqual([1, 3, 3, -1]);
    expect(plan.firstDataColumnOrdinal).toBe(1);
    expect(plan.lastDataColumnOrdinal).toBe(3);
  });

  it("fails closed on duplicate fields and invalid revisions/depth", () => {
    expect(() => planKeyboardNavigationTopology({
      columns: [column("a"), column("a")],
      hasFloatingFilterRow: false,
      topologyRevision: 1,
    })).toThrow("Duplicate visible keyboard field");

    expect(() => planKeyboardNavigationTopology({
      columns: [column("a")],
      hasFloatingFilterRow: false,
      topologyRevision: -1,
    })).toThrow("Invalid keyboard topology revision");

    expect(() => planKeyboardNavigationTopology({
      columns: [column("a")],
      columnGroupHeaders: { depth: Number.NaN, byField: {} },
      hasFloatingFilterRow: false,
      topologyRevision: 1,
    })).toThrow("Invalid keyboard group depth");
  });
});
