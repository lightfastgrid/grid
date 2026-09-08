import { describe, expect, it } from "vitest";

import type { RowData } from "../../../types";
import { diffImmutableRows } from "../diffImmutableRows";

const resolveRowId = (row: RowData): string | null => {
  const raw = row.id;
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
};

describe("diffImmutableRows", () => {
  it("classifies added, updated, removed, and unchanged rows", () => {
    const unchanged = { id: "a", v: 1 };
    const previous = [unchanged, { id: "b", v: 2 }, { id: "c", v: 3 }];
    const updatedB = { id: "b", v: 20 };
    const addedD = { id: "d", v: 4 };
    const next = [unchanged, updatedB, addedD];

    const result = diffImmutableRows(previous, next, resolveRowId);

    expect(result.added).toEqual([addedD]);
    expect(result.updated).toEqual([updatedB]);
    expect(result.removed).toEqual([previous[2]]);
    expect(result.addCount).toBe(1);
    expect(result.updateCount).toBe(1);
    expect(result.removeCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it("same object reference is unchanged even after reorder", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const result = diffImmutableRows([a, b], [b, a], resolveRowId);
    expect(result.addCount).toBe(0);
    expect(result.updateCount).toBe(0);
    expect(result.removeCount).toBe(0);
  });

  it("returns nextRows as the authoritative rows (same reference, same order)", () => {
    const previous = [{ id: "a" }];
    const next = [{ id: "b" }, { id: "a", v: 2 }];
    const result = diffImmutableRows(previous, next, resolveRowId);
    expect(result.rows).toBe(next);
  });

  it("next rows with missing ids are skipped but not dropped from rows", () => {
    const previous = [{ id: "a" }];
    const noId = { v: 1 };
    const next = [{ id: "a" }, noId];
    const result = diffImmutableRows(previous, next, resolveRowId);

    expect(result.rows).toBe(next); // data preserved
    expect(result.skipped).toEqual([{ row: noId, reason: "missingRowId" }]);
    expect(result.addCount).toBe(0);
  });

  it("duplicate ids in nextRows: first wins, later skipped, data preserved", () => {
    const previous: RowData[] = [];
    const first = { id: "a", v: 1 };
    const second = { id: "a", v: 2 };
    const next = [first, second];
    const result = diffImmutableRows(previous, next, resolveRowId);

    expect(result.rows).toBe(next);
    expect(result.added).toEqual([first]);
    expect(result.skipped).toEqual([
      { id: "a", row: second, reason: "duplicateId" },
    ]);
  });

  it("previous rows without ids are not reported as removed", () => {
    const previous = [{ v: 1 }, { id: "a" }];
    const next: RowData[] = [];
    const result = diffImmutableRows(previous, next, resolveRowId);
    expect(result.removed).toEqual([previous[1]]);
  });

  it("does not mutate previousRows or nextRows", () => {
    const previous = [{ id: "a", v: 1 }];
    const next = [{ id: "a", v: 2 }, { id: "b" }];
    const previousCopy = previous.map((r) => ({ ...r }));
    const nextCopy = next.map((r) => ({ ...r }));

    diffImmutableRows(previous, next, resolveRowId);

    expect(previous).toEqual(previousCopy);
    expect(next).toEqual(nextCopy);
  });
});
