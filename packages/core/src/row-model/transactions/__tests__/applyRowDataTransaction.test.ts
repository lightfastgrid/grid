import { describe, expect, it } from "vitest";

import type { RowData } from "../../../types";
import { applyRowDataTransaction } from "../applyRowDataTransaction";

const resolveRowId = (row: RowData): string | null => {
  const raw = row.id;
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
};

function makeRows(ids: string[]): RowData[] {
  return ids.map((id) => ({ id, v: `v-${id}` }));
}

function ids(rows: RowData[]): string[] {
  return rows.map((r) => String(r.id));
}

describe("applyRowDataTransaction", () => {
  it("empty transaction returns zero counts and the same rows reference", () => {
    const rows = makeRows(["a", "b"]);
    const result = applyRowDataTransaction(rows, {}, resolveRowId);
    expect(result.rows).toBe(rows);
    expect(result.addCount).toBe(0);
    expect(result.updateCount).toBe(0);
    expect(result.removeCount).toBe(0);
    expect(result.skippedCount).toBe(0);
  });

  it("add appends at the end by default", () => {
    const rows = makeRows(["a", "b"]);
    const added = [{ id: "c" }, { id: "d" }];
    const result = applyRowDataTransaction(rows, { add: added }, resolveRowId);
    expect(ids(result.rows)).toEqual(["a", "b", "c", "d"]);
    expect(result.added).toEqual(added);
    expect(result.addCount).toBe(2);
  });

  it("add with addIndex inserts at the index, clamped", () => {
    const rows = makeRows(["a", "b", "c"]);

    const middle = applyRowDataTransaction(
      rows,
      { add: [{ id: "x" }], addIndex: 1 },
      resolveRowId,
    );
    expect(ids(middle.rows)).toEqual(["a", "x", "b", "c"]);

    const front = applyRowDataTransaction(
      rows,
      { add: [{ id: "x" }], addIndex: -5 },
      resolveRowId,
    );
    expect(ids(front.rows)).toEqual(["x", "a", "b", "c"]);

    const end = applyRowDataTransaction(
      rows,
      { add: [{ id: "x" }], addIndex: 99 },
      resolveRowId,
    );
    expect(ids(end.rows)).toEqual(["a", "b", "c", "x"]);
  });

  it("update replaces rows in place by id", () => {
    const rows = makeRows(["a", "b", "c"]);
    const replacement = { id: "b", v: "updated" };
    const result = applyRowDataTransaction(
      rows,
      { update: [replacement] },
      resolveRowId,
    );
    expect(ids(result.rows)).toEqual(["a", "b", "c"]);
    expect(result.rows[1]).toBe(replacement);
    expect(result.updated).toEqual([replacement]);
    expect(result.updateCount).toBe(1);
  });

  it("remove by row object removes the matching current row", () => {
    const rows = makeRows(["a", "b", "c"]);
    const result = applyRowDataTransaction(
      rows,
      { remove: [{ id: "b" }] },
      resolveRowId,
    );
    expect(ids(result.rows)).toEqual(["a", "c"]);
    // removed reports the row object from currentRows, not the matcher.
    expect(result.removed).toEqual([rows[1]]);
    expect(result.removeCount).toBe(1);
  });

  it("remove by removeIds", () => {
    const rows = makeRows(["a", "b", "c", "d"]);
    const result = applyRowDataTransaction(
      rows,
      { removeIds: ["a", "d"] },
      resolveRowId,
    );
    expect(ids(result.rows)).toEqual(["b", "c"]);
    expect(result.removed).toEqual([rows[0], rows[3]]);
  });

  it("combined add/update/remove preserves order semantics", () => {
    const rows = makeRows(["a", "b", "c", "d"]);
    const result = applyRowDataTransaction(
      rows,
      {
        add: [{ id: "e" }],
        addIndex: 1,
        update: [{ id: "c", v: "updated" }],
        removeIds: ["a"],
      },
      resolveRowId,
    );
    // remove "a", update "c" in place, insert "e" at index 1 of the
    // post-removal array [b, c, d].
    expect(ids(result.rows)).toEqual(["b", "e", "c", "d"]);
    expect(result.rows[2]).toEqual({ id: "c", v: "updated" });
    expect(result.addCount).toBe(1);
    expect(result.updateCount).toBe(1);
    expect(result.removeCount).toBe(1);
  });

  it("duplicate add ids are skipped (existing and within the batch)", () => {
    const rows = makeRows(["a"]);
    const result = applyRowDataTransaction(
      rows,
      { add: [{ id: "a" }, { id: "b" }, { id: "b" }] },
      resolveRowId,
    );
    expect(ids(result.rows)).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([
      { id: "a", row: { id: "a" }, reason: "duplicateId" },
      { id: "b", row: { id: "b" }, reason: "duplicateId" },
    ]);
    expect(result.skippedCount).toBe(2);
  });

  it("add rows without ids always add (no duplicate detection)", () => {
    const rows = makeRows(["a"]);
    const result = applyRowDataTransaction(
      rows,
      { add: [{ v: 1 }, { v: 2 }] },
      resolveRowId,
    );
    expect(result.addCount).toBe(2);
    expect(result.rows.length).toBe(3);
  });

  it("update/remove entries without ids are skipped as missingRowId", () => {
    const rows = makeRows(["a"]);
    const result = applyRowDataTransaction(
      rows,
      { update: [{ v: 1 }], remove: [{ v: 2 }], removeIds: [""] },
      resolveRowId,
    );
    expect(result.rows).toBe(rows);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "missingRowId",
      "missingRowId",
      "missingRowId",
    ]);
  });

  it("not-found update/remove ids are skipped as notFound", () => {
    const rows = makeRows(["a"]);
    const result = applyRowDataTransaction(
      rows,
      { update: [{ id: "x" }], remove: [{ id: "y" }], removeIds: ["z"] },
      resolveRowId,
    );
    expect(result.rows).toBe(rows);
    expect(result.skipped.map((s) => ({ id: s.id, reason: s.reason }))).toEqual([
      { id: "x", reason: "notFound" },
      { id: "y", reason: "notFound" },
      { id: "z", reason: "notFound" },
    ]);
  });

  it("null/undefined entries are skipped as invalidRow", () => {
    const rows = makeRows(["a"]);
    const result = applyRowDataTransaction(
      rows,
      {
        add: [null as unknown as RowData],
        update: [undefined as unknown as RowData],
      },
      resolveRowId,
    );
    expect(result.skipped.map((s) => s.reason)).toEqual([
      "invalidRow",
      "invalidRow",
    ]);
  });

  it("removing the same row via remove and removeIds removes once", () => {
    const rows = makeRows(["a", "b"]);
    const result = applyRowDataTransaction(
      rows,
      { remove: [{ id: "b" }], removeIds: ["b"] },
      resolveRowId,
    );
    expect(ids(result.rows)).toEqual(["a"]);
    expect(result.removeCount).toBe(1);
  });

  it("does not mutate input arrays or row objects", () => {
    const rows = makeRows(["a", "b"]);
    const rowsCopy = rows.map((r) => ({ ...r }));
    const add = [{ id: "c" }];
    const update = [{ id: "a", v: "updated" }];
    const removeIds = ["b"];
    const transaction = { add, update, removeIds };

    applyRowDataTransaction(rows, transaction, resolveRowId);

    expect(rows).toEqual(rowsCopy);
    expect(add).toEqual([{ id: "c" }]);
    expect(update).toEqual([{ id: "a", v: "updated" }]);
    expect(removeIds).toEqual(["b"]);
    expect(transaction).toEqual({ add, update, removeIds });
  });

  // ── addBeforeId / addAfterId ─────────────────────────────────────

  describe("addBeforeId", () => {
    it("inserts before the anchor row", () => {
      const rows = makeRows(["a", "b", "c"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }, { id: "y" }], addBeforeId: "b" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "x", "y", "b", "c"]);
      expect(result.addCount).toBe(2);
    });

    it("inserts before the first row", () => {
      const rows = makeRows(["a", "b", "c"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addBeforeId: "a" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["x", "a", "b", "c"]);
    });

    it("inserts before the last row", () => {
      const rows = makeRows(["a", "b", "c"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addBeforeId: "c" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "b", "x", "c"]);
    });
  });

  describe("addAfterId", () => {
    it("inserts after the anchor row", () => {
      const rows = makeRows(["a", "b", "c"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }, { id: "y" }], addAfterId: "b" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "b", "x", "y", "c"]);
      expect(result.addCount).toBe(2);
    });

    it("inserts after the last row", () => {
      const rows = makeRows(["a", "b", "c"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addAfterId: "c" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "b", "c", "x"]);
    });

    it("inserts after the first row", () => {
      const rows = makeRows(["a", "b", "c"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addAfterId: "a" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "x", "b", "c"]);
    });
  });

  describe("anchor resolution against post-removal rows", () => {
    it("addBeforeId resolves against kept rows after removal", () => {
      const rows = makeRows(["a", "b", "c", "d"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addBeforeId: "c", removeIds: ["b"] },
        resolveRowId,
      );
      // post-removal: [a, c, d] → insert x before c → [a, x, c, d]
      expect(ids(result.rows)).toEqual(["a", "x", "c", "d"]);
    });

    it("addAfterId resolves against kept rows after removal", () => {
      const rows = makeRows(["a", "b", "c", "d"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addAfterId: "a", removeIds: ["b"] },
        resolveRowId,
      );
      // post-removal: [a, c, d] → insert x after a → [a, x, c, d]
      expect(ids(result.rows)).toEqual(["a", "x", "c", "d"]);
    });
  });

  describe("anchor not found", () => {
    it("skips adds with anchorNotFound when anchor id does not exist", () => {
      const rows = makeRows(["a", "b"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }, { id: "y" }], addBeforeId: "z" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "b"]);
      expect(result.addCount).toBe(0);
      expect(result.skipped).toEqual([
        { id: "x", row: { id: "x" }, reason: "anchorNotFound" },
        { id: "y", row: { id: "y" }, reason: "anchorNotFound" },
      ]);
    });

    it("skips adds when anchor id was removed in the same transaction", () => {
      const rows = makeRows(["a", "b", "c"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addAfterId: "b", removeIds: ["b"] },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "c"]);
      expect(result.addCount).toBe(0);
      expect(result.removeCount).toBe(1);
      expect(result.skipped.map((s) => s.reason)).toEqual(["anchorNotFound"]);
    });

    it("anchorNotFound still applies updates and removals", () => {
      const rows = makeRows(["a", "b", "c"]);
      const result = applyRowDataTransaction(
        rows,
        {
          add: [{ id: "x" }],
          addBeforeId: "missing",
          update: [{ id: "a", v: "updated" }],
          removeIds: ["c"],
        },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "b"]);
      expect(result.rows[0]).toEqual({ id: "a", v: "updated" });
      expect(result.updateCount).toBe(1);
      expect(result.removeCount).toBe(1);
      expect(result.addCount).toBe(0);
    });
  });

  // ── Mutual exclusivity of positioning options ────────────────────

  describe("invalid add position (multiple positioning options)", () => {
    it("skips all adds with invalidAddPosition when addIndex + addBeforeId both set", () => {
      const rows = makeRows(["a", "b"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addIndex: 0, addBeforeId: "b" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "b"]);
      expect(result.addCount).toBe(0);
      expect(result.skipped).toEqual([
        { id: "x", row: { id: "x" }, reason: "invalidAddPosition" },
      ]);
    });

    it("skips all adds with invalidAddPosition when addIndex + addAfterId both set", () => {
      const rows = makeRows(["a", "b"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addIndex: 0, addAfterId: "a" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "b"]);
      expect(result.addCount).toBe(0);
      expect(result.skipped).toEqual([
        { id: "x", row: { id: "x" }, reason: "invalidAddPosition" },
      ]);
    });

    it("skips all adds when all three positioning options are set", () => {
      const rows = makeRows(["a", "b"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "x" }], addIndex: 0, addBeforeId: "b", addAfterId: "a" },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "b"]);
      expect(result.addCount).toBe(0);
      expect(result.skipped.map((s) => s.reason)).toEqual(["invalidAddPosition"]);
    });

    it("invalidAddPosition still applies updates and removals", () => {
      const rows = makeRows(["a", "b", "c"]);
      const result = applyRowDataTransaction(
        rows,
        {
          add: [{ id: "x" }],
          addIndex: 0,
          addBeforeId: "b",
          update: [{ id: "a", v: "updated" }],
          removeIds: ["c"],
        },
        resolveRowId,
      );
      expect(ids(result.rows)).toEqual(["a", "b"]);
      expect(result.rows[0]).toEqual({ id: "a", v: "updated" });
      expect(result.updateCount).toBe(1);
      expect(result.removeCount).toBe(1);
      expect(result.addCount).toBe(0);
    });
  });

  // ── Remove + add same id ─────────────────────────────────────────

  describe("remove + add same id in one transaction", () => {
    it("allows adding a row whose id was removed in the same transaction", () => {
      const rows = makeRows(["a", "b", "c"]);
      const replacement = { id: "b", v: "replaced" };
      const result = applyRowDataTransaction(
        rows,
        { add: [replacement], removeIds: ["b"] },
        resolveRowId,
      );
      expect(result.addCount).toBe(1);
      expect(result.removeCount).toBe(1);
      expect(result.skippedCount).toBe(0);
      // b is removed then re-added at the end (default append)
      expect(ids(result.rows)).toEqual(["a", "c", "b"]);
      expect(result.rows[2]).toBe(replacement);
    });

    it("still rejects duplicate add if id is NOT removed", () => {
      const rows = makeRows(["a", "b"]);
      const result = applyRowDataTransaction(
        rows,
        { add: [{ id: "b", v: "dup" }] },
        resolveRowId,
      );
      expect(result.addCount).toBe(0);
      expect(result.skipped).toEqual([
        { id: "b", row: { id: "b", v: "dup" }, reason: "duplicateId" },
      ]);
    });

    it("remove + add same id with addBeforeId positions correctly", () => {
      const rows = makeRows(["a", "b", "c"]);
      const replacement = { id: "b", v: "replaced" };
      const result = applyRowDataTransaction(
        rows,
        { add: [replacement], removeIds: ["b"], addBeforeId: "c" },
        resolveRowId,
      );
      // post-removal: [a, c] → insert before c → [a, b, c]
      expect(ids(result.rows)).toEqual(["a", "b", "c"]);
      expect(result.rows[1]).toBe(replacement);
    });
  });
});
