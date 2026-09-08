import { describe, expect, it } from "vitest";

import type { RowData } from "../../../types";
import type { ResolveTransactionRowId } from "../../transactions/types";
import { RowStore } from "../RowStore";

const resolveId: ResolveTransactionRowId = (row) => {
  const id = (row as Record<string, unknown>).id;
  if (id === null || id === undefined || id === "") return null;
  return String(id);
};

function makeRows(ids: string[]): RowData[] {
  return ids.map((id, i) => ({ id, v: i }));
}

describe("RowStore", () => {
  // ── replaceAll ────────────────────────────────────────────────────

  describe("replaceAll", () => {
    it("builds correct id index", () => {
      const store = new RowStore();
      const rows = makeRows(["a", "b", "c"]);
      store.replaceAll(rows, resolveId);

      expect(store.sourceRows).toBe(rows);
      expect(store.rowCount).toBe(3);
      expect(store.rowIdToSourceIndex.get("a")).toBe(0);
      expect(store.rowIdToSourceIndex.get("b")).toBe(1);
      expect(store.rowIdToSourceIndex.get("c")).toBe(2);
      expect(store.rowIdToSourceIndex.size).toBe(3);
    });

    it("skips rows without resolvable ids", () => {
      const store = new RowStore();
      const rows: RowData[] = [{ id: "a" }, { noId: true }, { id: "c" }];
      store.replaceAll(rows, resolveId);

      expect(store.rowIdToSourceIndex.size).toBe(2);
      expect(store.rowIdToSourceIndex.get("a")).toBe(0);
      expect(store.rowIdToSourceIndex.get("c")).toBe(2);
    });

    it("resets to borrowed state after transaction", () => {
      const store = new RowStore();
      const original = makeRows(["a", "b"]);
      store.replaceAll(original, resolveId);

      // Apply an update-only transaction (triggers COW clone).
      store.applyTransaction(
        { update: [{ id: "a", v: 99 }] },
        resolveId,
      );
      expect(store.sourceRows).not.toBe(original);

      // replaceAll resets to borrowed.
      const next = makeRows(["x", "y"]);
      store.replaceAll(next, resolveId);
      expect(store.sourceRows).toBe(next);
    });
  });

  // ── Update-only transactions ──────────────────────────────────────

  describe("update-only transaction", () => {
    it("does not mutate the original user rows array", () => {
      const store = new RowStore();
      const original = makeRows(["a", "b", "c"]);
      const originalRef = original;
      const originalCopy = original.map((r) => ({ ...r }));
      store.replaceAll(original, resolveId);

      store.applyTransaction(
        { update: [{ id: "b", v: 99 }] },
        resolveId,
      );

      // Original array reference is untouched.
      expect(originalRef[0]).toEqual(originalCopy[0]);
      expect(originalRef[1]).toEqual(originalCopy[1]);
      expect(originalRef[2]).toEqual(originalCopy[2]);
      expect(originalRef.length).toBe(3);
    });

    it("returns changed: true, structural: false", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);

      const outcome = store.applyTransaction(
        { update: [{ id: "a", v: 99 }] },
        resolveId,
      );

      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(false);
      expect(outcome.result.updateCount).toBe(1);
      expect(outcome.result.addCount).toBe(0);
      expect(outcome.result.removeCount).toBe(0);
    });

    it("updates the row in the store's source array", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);

      store.applyTransaction(
        { update: [{ id: "a", v: 42 }] },
        resolveId,
      );

      expect(store.sourceRows[0]).toEqual({ id: "a", v: 42 });
      expect(store.sourceRows[1]).toEqual({ id: "b", v: 1 });
    });

    it("preserves the id index after update", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);

      store.applyTransaction(
        { update: [{ id: "b", v: 77 }] },
        resolveId,
      );

      expect(store.rowIdToSourceIndex.get("a")).toBe(0);
      expect(store.rowIdToSourceIndex.get("b")).toBe(1);
      expect(store.rowIdToSourceIndex.get("c")).toBe(2);
    });

    it("populates dirty metadata with changed fields", () => {
      const store = new RowStore();
      store.replaceAll(
        [{ id: "a", v: 1, name: "alice" }],
        resolveId,
      );

      const outcome = store.applyTransaction(
        { update: [{ id: "a", v: 99, name: "alice" }] },
        resolveId,
      );

      expect(outcome.dirty.updatedRowIds.has("a")).toBe(true);
      const fields = outcome.dirty.dirtyFieldsByRowId.get("a");
      expect(fields).toBeDefined();
      expect(fields!.has("v")).toBe(true);
      expect(fields!.has("name")).toBe(false);
    });

    it("second update reuses owned array (no re-clone)", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);

      store.applyTransaction(
        { update: [{ id: "a", v: 10 }] },
        resolveId,
      );
      const afterFirst = store.sourceRows;

      store.applyTransaction(
        { update: [{ id: "b", v: 20 }] },
        resolveId,
      );
      const afterSecond = store.sourceRows;

      // Same array reference — no re-clone.
      expect(afterSecond).toBe(afterFirst);
      expect(afterSecond[0]).toEqual({ id: "a", v: 10 });
      expect(afterSecond[1]).toEqual({ id: "b", v: 20 });
    });
  });

  // ── All-skipped transaction ───────────────────────────────────────

  describe("all-skipped transaction", () => {
    it("returns changed: false for empty transaction", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      const outcome = store.applyTransaction({}, resolveId);
      expect(outcome.changed).toBe(false);
      expect(outcome.structural).toBe(false);
    });

    it("returns changed: false when all updates are skipped (notFound)", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      const outcome = store.applyTransaction(
        { update: [{ id: "z", v: 1 }] },
        resolveId,
      );

      expect(outcome.changed).toBe(false);
      expect(outcome.result.skippedCount).toBe(1);
      expect(outcome.result.skipped[0]!.reason).toBe("notFound");
    });

    it("returns changed: false when all updates have missing ids", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      const outcome = store.applyTransaction(
        { update: [{ noId: true, v: 1 }] },
        resolveId,
      );

      expect(outcome.changed).toBe(false);
      expect(outcome.result.skippedCount).toBe(1);
      expect(outcome.result.skipped[0]!.reason).toBe("missingRowId");
    });

    it("returns changed: false for null/undefined update entries", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      const outcome = store.applyTransaction(
        { update: [null, undefined] },
        resolveId,
      );

      expect(outcome.changed).toBe(false);
      expect(outcome.result.skippedCount).toBe(2);
    });
  });

  // ── Structural transactions (add/remove) ──────────────────────────

  describe("add transaction", () => {
    it("marks structural: true", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      const outcome = store.applyTransaction(
        { add: [{ id: "b", v: 1 }] },
        resolveId,
      );

      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(true);
      expect(outcome.result.addCount).toBe(1);
    });

    it("updates the id index after add", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      store.applyTransaction(
        { add: [{ id: "b", v: 1 }] },
        resolveId,
      );

      expect(store.rowIdToSourceIndex.get("a")).toBe(0);
      expect(store.rowIdToSourceIndex.get("b")).toBe(1);
      expect(store.rowCount).toBe(2);
    });

    it("skips duplicate id adds", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      const outcome = store.applyTransaction(
        { add: [{ id: "a", v: 99 }] },
        resolveId,
      );

      expect(outcome.changed).toBe(false);
      expect(outcome.result.skippedCount).toBe(1);
      expect(outcome.result.skipped[0]!.reason).toBe("duplicateId");
    });
  });

  describe("remove transaction", () => {
    it("marks structural: true", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);

      const outcome = store.applyTransaction(
        { removeIds: ["b"] },
        resolveId,
      );

      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(true);
      expect(outcome.result.removeCount).toBe(1);
    });

    it("updates the id index after remove", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);

      store.applyTransaction({ removeIds: ["b"] }, resolveId);

      expect(store.rowIdToSourceIndex.get("a")).toBe(0);
      expect(store.rowIdToSourceIndex.has("b")).toBe(false);
      expect(store.rowIdToSourceIndex.get("c")).toBe(1);
      expect(store.rowCount).toBe(2);
    });

    it("skips notFound remove ids", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      const outcome = store.applyTransaction(
        { removeIds: ["z"] },
        resolveId,
      );

      expect(outcome.changed).toBe(false);
      expect(outcome.result.skippedCount).toBe(1);
      expect(outcome.result.skipped[0]!.reason).toBe("notFound");
    });
  });

  describe("mixed add+update+remove", () => {
    it("applies all operations correctly", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);

      const outcome = store.applyTransaction(
        {
          add: [{ id: "d", v: 3 }],
          update: [{ id: "b", v: 99 }],
          removeIds: ["a"],
        },
        resolveId,
      );

      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(true);
      expect(outcome.result.addCount).toBe(1);
      expect(outcome.result.updateCount).toBe(1);
      expect(outcome.result.removeCount).toBe(1);

      expect(store.rowIdToSourceIndex.has("a")).toBe(false);
      expect(store.rowIdToSourceIndex.has("b")).toBe(true);
      expect(store.rowIdToSourceIndex.has("c")).toBe(true);
      expect(store.rowIdToSourceIndex.has("d")).toBe(true);
    });
  });

  // ── Batch ─────────────────────────────────────────────────────────

  describe("applyTransactionBatch", () => {
    it("does not copy the complete row array for a one-transaction batch", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);

      const outcome = store.applyTransactionBatch(
        [{ update: [{ id: "a", v: 10 }] }],
        resolveId,
      );

      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0]!.rows).toBe(store.sourceRows);
      expect(outcome.results[0]!.updateCount).toBe(1);
    });

    it("applies multiple transactions and merges dirty metadata", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);

      const outcome = store.applyTransactionBatch(
        [
          { update: [{ id: "a", v: 10 }] },
          { update: [{ id: "b", v: 20 }] },
        ],
        resolveId,
      );

      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(false);
      expect(outcome.results).toHaveLength(2);
      expect(outcome.dirty.updatedRowIds.has("a")).toBe(true);
      expect(outcome.dirty.updatedRowIds.has("b")).toBe(true);
    });

    it("returns per-transaction results for callbacks", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);

      const outcome = store.applyTransactionBatch(
        [
          { update: [{ id: "a", v: 10 }] },
          { add: [{ id: "c", v: 2 }] },
        ],
        resolveId,
      );

      expect(outcome.results[0]!.updateCount).toBe(1);
      expect(outcome.results[1]!.addCount).toBe(1);
      expect(outcome.structural).toBe(true);
    });
  });

  // ── Result.rows contract ──────────────────────────────────────────

  describe("result.rows", () => {
    it("update-only result.rows is the store's owned array, not the user's original", () => {
      const store = new RowStore();
      const userRows = makeRows(["a", "b"]);
      store.replaceAll(userRows, resolveId);

      const outcome = store.applyTransaction(
        { update: [{ id: "a", v: 10 }] },
        resolveId,
      );

      // result.rows is the internal owned array.
      expect(outcome.result.rows).toBe(store.sourceRows);
      // It is NOT the user's original array.
      expect(outcome.result.rows).not.toBe(userRows);
    });

    it("structural result.rows is the new array from applyRowDataTransaction", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);

      const outcome = store.applyTransaction(
        { add: [{ id: "c", v: 2 }] },
        resolveId,
      );

      expect(outcome.result.rows).toBe(store.sourceRows);
      expect(outcome.result.rows.length).toBe(3);
    });
  });

  // ── Dirty metadata hardening (Phase 2) ────────────────────────────

  describe("dirty metadata", () => {
    it("duplicate update entries in one transaction union dirty fields", () => {
      const store = new RowStore();
      store.replaceAll(
        [{ id: "a", v: 1, name: "alice", age: 30 }],
        resolveId,
      );

      const outcome = store.applyTransaction(
        {
          update: [
            { id: "a", v: 99, name: "alice", age: 30 },
            { id: "a", v: 99, name: "bob", age: 30 },
          ],
        },
        resolveId,
      );

      expect(outcome.result.updateCount).toBe(2);
      expect(outcome.dirty.updatedRowIds.has("a")).toBe(true);
      const fields = outcome.dirty.dirtyFieldsByRowId.get("a")!;
      expect(fields).toBeDefined();
      expect(fields.has("v")).toBe(true);
      expect(fields.has("name")).toBe(true);
      expect(fields.has("age")).toBe(false);
    });

    it("no-op update (same values) counts as update but has empty dirty fields", () => {
      const store = new RowStore();
      store.replaceAll([{ id: "a", v: 1 }], resolveId);

      const outcome = store.applyTransaction(
        { update: [{ id: "a", v: 1 }] },
        resolveId,
      );

      expect(outcome.changed).toBe(true);
      expect(outcome.result.updateCount).toBe(1);
      expect(outcome.dirty.updatedRowIds.has("a")).toBe(true);
      expect(outcome.dirty.dirtyFieldsByRowId.has("a")).toBe(false);
    });

    it("structural transaction with update includes dirty fields", () => {
      const store = new RowStore();
      store.replaceAll(
        [{ id: "a", v: 1, name: "alice" }, { id: "b", v: 2, name: "bob" }],
        resolveId,
      );

      const outcome = store.applyTransaction(
        {
          update: [{ id: "a", v: 99, name: "alice" }],
          add: [{ id: "c", v: 3 }],
        },
        resolveId,
      );

      expect(outcome.structural).toBe(true);
      expect(outcome.dirty.updatedRowIds.has("a")).toBe(true);
      const fields = outcome.dirty.dirtyFieldsByRowId.get("a")!;
      expect(fields).toBeDefined();
      expect(fields.has("v")).toBe(true);
      expect(fields.has("name")).toBe(false);
    });

    it("repeated updates across batch union dirty fields per row", () => {
      const store = new RowStore();
      store.replaceAll(
        [{ id: "a", v: 1, name: "alice", age: 30 }],
        resolveId,
      );

      const outcome = store.applyTransactionBatch(
        [
          { update: [{ id: "a", v: 99, name: "alice", age: 30 }] },
          { update: [{ id: "a", v: 99, name: "bob", age: 30 }] },
        ],
        resolveId,
      );

      expect(outcome.dirty.updatedRowIds.has("a")).toBe(true);
      const fields = outcome.dirty.dirtyFieldsByRowId.get("a")!;
      expect(fields).toBeDefined();
      expect(fields.has("v")).toBe(true);
      expect(fields.has("name")).toBe(true);
      expect(fields.has("age")).toBe(false);
    });

    it("skipped entries do not add dirty metadata", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      const outcome = store.applyTransaction(
        {
          update: [
            { id: "missing", v: 1 },
            null,
            { noId: true },
          ],
        },
        resolveId,
      );

      expect(outcome.changed).toBe(false);
      expect(outcome.dirty.updatedRowIds.size).toBe(0);
      expect(outcome.dirty.dirtyFieldsByRowId.size).toBe(0);
    });

    it("structural no-change (all skipped add/remove) has no dirty metadata", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      const outcome = store.applyTransaction(
        {
          add: [{ id: "a", v: 99 }],
          removeIds: ["missing"],
        },
        resolveId,
      );

      expect(outcome.changed).toBe(false);
      expect(outcome.dirty.updatedRowIds.size).toBe(0);
      expect(outcome.dirty.dirtyFieldsByRowId.size).toBe(0);
    });
  });

  // ── replaceRowAtSourceIndex ──────────────────────────────────────

  describe("replaceRowAtSourceIndex", () => {
    it("replaces a row by source index and reports dirty fields", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);

      const outcome = store.replaceRowAtSourceIndex(1, { id: "b", v: 99 }, resolveId);

      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(false);
      expect(outcome.result.updateCount).toBe(1);
      expect(store.sourceRows[1]).toEqual({ id: "b", v: 99 });
      expect(outcome.dirty.updatedRowIds).toEqual(new Set(["b"]));
      expect(outcome.dirty.dirtyFieldsByRowId.get("b")).toEqual(new Set(["v"]));
    });

    it("returns noop for out-of-range index", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);

      expect(store.replaceRowAtSourceIndex(-1, { id: "x" }, resolveId).changed).toBe(false);
      expect(store.replaceRowAtSourceIndex(5, { id: "x" }, resolveId).changed).toBe(false);
    });

    it("returns noop when same object reference is passed", () => {
      const store = new RowStore();
      const rows = makeRows(["a"]);
      store.replaceAll(rows, resolveId);

      expect(store.replaceRowAtSourceIndex(0, rows[0]!, resolveId).changed).toBe(false);
    });

    it("updates id index when row id changes", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);

      store.replaceRowAtSourceIndex(0, { id: "z", v: 0 }, resolveId);

      expect(store.rowIdToSourceIndex.has("a")).toBe(false);
      expect(store.rowIdToSourceIndex.get("z")).toBe(0);
      expect(store.rowIdToSourceIndex.get("b")).toBe(1);
    });

    it("removes old id from index when new row has no id", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);

      store.replaceRowAtSourceIndex(0, { v: 0 }, resolveId);

      expect(store.rowIdToSourceIndex.has("a")).toBe(false);
      expect(store.rowIdToSourceIndex.get("b")).toBe(1);
      expect(store.rowIdToSourceIndex.size).toBe(1);
    });

    it("adds new id to index when old row had no id", () => {
      const store = new RowStore();
      const rows: RowData[] = [{ v: 0 }, { id: "b", v: 1 }];
      store.replaceAll(rows, resolveId);

      store.replaceRowAtSourceIndex(0, { id: "x", v: 0 }, resolveId);

      expect(store.rowIdToSourceIndex.get("x")).toBe(0);
      expect(store.rowIdToSourceIndex.get("b")).toBe(1);
    });

    it("preserves id index when id does not change", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);

      store.replaceRowAtSourceIndex(1, { id: "b", v: 42 }, resolveId);

      expect(store.rowIdToSourceIndex.get("a")).toBe(0);
      expect(store.rowIdToSourceIndex.get("b")).toBe(1);
      expect(store.rowIdToSourceIndex.size).toBe(2);
    });

    it("uses COW — does not mutate borrowed array", () => {
      const store = new RowStore();
      const original = makeRows(["a", "b"]);
      store.replaceAll(original, resolveId);

      store.replaceRowAtSourceIndex(0, { id: "a", v: 99 }, resolveId);

      expect(store.sourceRows).not.toBe(original);
      expect(original[0]).toEqual({ id: "a", v: 0 });
    });
  });

  // ── sourceLayoutRevision ──────────────────────────────────────────

  describe("sourceLayoutRevision", () => {
    it("starts at zero", () => {
      const store = new RowStore();
      expect(store.sourceLayoutRevision).toBe(0);
    });

    it("advances on replaceAll", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      expect(store.sourceLayoutRevision).toBe(1);
    });

    it("advances monotonically on consecutive replaceAll calls", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const r1 = store.sourceLayoutRevision;
      store.replaceAll(makeRows(["b"]), resolveId);
      const r2 = store.sourceLayoutRevision;
      store.replaceAll(makeRows(["c"]), resolveId);
      const r3 = store.sourceLayoutRevision;
      expect(r2).toBeGreaterThan(r1);
      expect(r3).toBeGreaterThan(r2);
    });

    it("does not advance on replaceRowAtSourceIndex", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const rev = store.sourceLayoutRevision;
      store.replaceRowAtSourceIndex(0, { id: "a", v: 99 }, resolveId);
      expect(store.sourceLayoutRevision).toBe(rev);
    });

    it("does not advance on the first COW edit (update-only transaction)", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const rev = store.sourceLayoutRevision;
      store.applyTransaction({ update: [{ id: "a", v: 10 }] }, resolveId);
      expect(store.sourceLayoutRevision).toBe(rev);
    });

    it("does not advance on a second same-reference edit", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      store.applyTransaction({ update: [{ id: "a", v: 10 }] }, resolveId);
      const rev = store.sourceLayoutRevision;
      store.applyTransaction({ update: [{ id: "b", v: 20 }] }, resolveId);
      expect(store.sourceLayoutRevision).toBe(rev);
    });

    it("advances on structural add", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const rev = store.sourceLayoutRevision;
      store.applyTransaction({ add: [{ id: "b", v: 1 }] }, resolveId);
      expect(store.sourceLayoutRevision).toBeGreaterThan(rev);
    });

    it("advances on structural remove", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const rev = store.sourceLayoutRevision;
      store.applyTransaction({ removeIds: ["a"] }, resolveId);
      expect(store.sourceLayoutRevision).toBeGreaterThan(rev);
    });

    it("does not advance on no-op structural transaction", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const rev = store.sourceLayoutRevision;
      store.applyTransaction({ add: [{ id: "a", v: 99 }] }, resolveId);
      expect(store.sourceLayoutRevision).toBe(rev);
    });

    it("does not advance on no-op update", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const rev = store.sourceLayoutRevision;
      store.applyTransaction({ update: [{ id: "z", v: 1 }] }, resolveId);
      expect(store.sourceLayoutRevision).toBe(rev);
    });
  });

  // ── updatedSourceIndexes ──────────────────────────────────────────

  describe("updatedSourceIndexes", () => {
    it("replaceRowAtSourceIndex reports the source index", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);
      const outcome = store.replaceRowAtSourceIndex(1, { id: "b", v: 99 }, resolveId);
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([1]));
    });

    it("update-only transaction reports all changed source indexes", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);
      const outcome = store.applyTransaction(
        { update: [{ id: "a", v: 10 }, { id: "c", v: 20 }] },
        resolveId,
      );
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([0, 2]));
    });

    it("deduplicates indexes for the same row updated twice", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const outcome = store.applyTransaction(
        { update: [{ id: "a", v: 10 }, { id: "a", v: 20 }] },
        resolveId,
      );
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([0]));
    });

    it("works without getRowId (synthetic __idx_ ids)", () => {
      const store = new RowStore();
      const noIdResolver: ResolveTransactionRowId = () => null;
      const rows: RowData[] = [{ v: 0 }, { v: 1 }, { v: 2 }];
      store.replaceAll(rows, noIdResolver);
      const outcome = store.replaceRowAtSourceIndex(1, { v: 99 }, noIdResolver);
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([1]));
    });

    it("no-op update reports empty set", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const outcome = store.applyTransaction(
        { update: [{ id: "z", v: 1 }] },
        resolveId,
      );
      expect(outcome.dirty.updatedSourceIndexes.size).toBe(0);
    });

    it("structural add returns empty updatedSourceIndexes", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const outcome = store.applyTransaction(
        { add: [{ id: "b", v: 1 }] },
        resolveId,
      );
      expect(outcome.dirty.updatedSourceIndexes.size).toBe(0);
    });

    it("structural remove returns empty updatedSourceIndexes", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const outcome = store.applyTransaction(
        { removeIds: ["a"] },
        resolveId,
      );
      expect(outcome.dirty.updatedSourceIndexes.size).toBe(0);
    });

    it("mixed structural+update returns empty updatedSourceIndexes", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const outcome = store.applyTransaction(
        { add: [{ id: "c", v: 2 }], update: [{ id: "a", v: 10 }] },
        resolveId,
      );
      expect(outcome.dirty.updatedSourceIndexes.size).toBe(0);
    });

    it("batch of update-only transactions merges source indexes", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b", "c"]), resolveId);
      const outcome = store.applyTransactionBatch(
        [
          { update: [{ id: "a", v: 10 }] },
          { update: [{ id: "c", v: 20 }] },
        ],
        resolveId,
      );
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([0, 2]));
    });

    it("batch with any structural transaction returns empty updatedSourceIndexes", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const outcome = store.applyTransactionBatch(
        [
          { update: [{ id: "a", v: 10 }] },
          { add: [{ id: "c", v: 2 }] },
        ],
        resolveId,
      );
      expect(outcome.dirty.updatedSourceIndexes.size).toBe(0);
    });

    it("replaceRowAtSourceIndex noop returns empty set", () => {
      const store = new RowStore();
      const rows = makeRows(["a"]);
      store.replaceAll(rows, resolveId);
      const outcome = store.replaceRowAtSourceIndex(0, rows[0]!, resolveId);
      expect(outcome.dirty.updatedSourceIndexes.size).toBe(0);
    });

    it("skipped duplicate add + valid update is non-structural with source index", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const rev = store.sourceLayoutRevision;
      const outcome = store.applyTransaction(
        { add: [{ id: "a", v: 99 }], update: [{ id: "b", v: 42 }] },
        resolveId,
      );
      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(false);
      expect(store.sourceLayoutRevision).toBe(rev);
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([1]));
    });

    it("skipped missing remove + valid update is non-structural with source index", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const rev = store.sourceLayoutRevision;
      const outcome = store.applyTransaction(
        { removeIds: ["z"], update: [{ id: "a", v: 10 }] },
        resolveId,
      );
      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(false);
      expect(store.sourceLayoutRevision).toBe(rev);
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([0]));
    });

    it("valid add + valid update remains structural with no source indexes", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const rev = store.sourceLayoutRevision;
      const outcome = store.applyTransaction(
        { add: [{ id: "c", v: 2 }], update: [{ id: "a", v: 10 }] },
        resolveId,
      );
      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(true);
      expect(store.sourceLayoutRevision).toBeGreaterThan(rev);
      expect(outcome.dirty.updatedSourceIndexes.size).toBe(0);
    });

    it("batch with skipped structural retains update-only source indexes", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const rev = store.sourceLayoutRevision;
      const outcome = store.applyTransactionBatch(
        [
          { add: [{ id: "a", v: 99 }] },
          { update: [{ id: "b", v: 42 }] },
        ],
        resolveId,
      );
      expect(outcome.changed).toBe(true);
      expect(outcome.structural).toBe(false);
      expect(store.sourceLayoutRevision).toBe(rev);
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([1]));
    });

    it("no-op skipped-only transaction remains unchanged", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const rev = store.sourceLayoutRevision;
      const outcome = store.applyTransaction(
        { add: [{ id: "a", v: 99 }], removeIds: ["z"] },
        resolveId,
      );
      expect(outcome.changed).toBe(false);
      expect(outcome.structural).toBe(false);
      expect(store.sourceLayoutRevision).toBe(rev);
      expect(outcome.dirty.updatedSourceIndexes.size).toBe(0);
    });
  });

  // ── dirtyFieldsBySourceIndex ──────────────────────────────────────

  describe("dirtyFieldsBySourceIndex", () => {
    it("replaceRowAtSourceIndex records fields for the source index", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a", "b"]), resolveId);
      const outcome = store.replaceRowAtSourceIndex(1, { id: "b", v: 99 }, resolveId);
      expect(outcome.dirty.dirtyFieldsBySourceIndex.get(1)).toEqual(new Set(["v"]));
    });

    it("same-value replacement records an empty field set for the index", () => {
      const store = new RowStore();
      store.replaceAll([{ id: "a", v: 1 }], resolveId);
      const outcome = store.replaceRowAtSourceIndex(0, { id: "a", v: 1 }, resolveId);
      expect(outcome.changed).toBe(true);
      expect(outcome.dirty.dirtyFieldsBySourceIndex.get(0)?.size).toBe(0);
    });

    it("update-only batch merges fields by source index", () => {
      const store = new RowStore();
      store.replaceAll(
        [
          { id: "a", v: 0, name: "x" },
          { id: "b", v: 0, name: "y" },
        ],
        resolveId,
      );
      const outcome = store.applyTransactionBatch(
        [
          { update: [{ id: "a", v: 10, name: "x" }] },
          { update: [{ id: "a", v: 10, name: "A" }] },
          { update: [{ id: "b", v: 20, name: "y" }] },
        ],
        resolveId,
      );
      expect(outcome.dirty.dirtyFieldsBySourceIndex.get(0)).toEqual(new Set(["v", "name"]));
      expect(outcome.dirty.dirtyFieldsBySourceIndex.get(1)).toEqual(new Set(["v"]));
    });

    it("structural outcomes expose an empty fields-by-source-index map", () => {
      const store = new RowStore();
      store.replaceAll(makeRows(["a"]), resolveId);
      const outcome = store.applyTransaction(
        { add: [{ id: "b", v: 1 }] },
        resolveId,
      );
      expect(outcome.structural).toBe(true);
      expect(outcome.dirty.dirtyFieldsBySourceIndex.size).toBe(0);
    });

    it("skipped duplicate add + valid updates populates source-index field entries", () => {
      const store = new RowStore();
      store.replaceAll(
        [
          { id: "a", v: 0, name: "x" },
          { id: "b", v: 0, name: "y" },
        ],
        resolveId,
      );
      const outcome = store.applyTransaction(
        {
          add: [{ id: "a", v: 99 }],
          update: [
            { id: "a", v: 10, name: "x" },
            { id: "b", v: 0, name: "B" },
          ],
        },
        resolveId,
      );
      expect(outcome.structural).toBe(false);
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([0, 1]));
      expect(outcome.dirty.dirtyFieldsBySourceIndex.get(0)).toEqual(new Set(["v"]));
      expect(outcome.dirty.dirtyFieldsBySourceIndex.get(1)).toEqual(new Set(["name"]));
    });

    it("skipped missing remove + valid update populates its field entry", () => {
      const store = new RowStore();
      store.replaceAll([{ id: "a", v: 0 }], resolveId);
      const outcome = store.applyTransaction(
        {
          removeIds: ["missing"],
          update: [{ id: "a", v: 7 }],
        },
        resolveId,
      );
      expect(outcome.structural).toBe(false);
      expect(outcome.dirty.updatedSourceIndexes).toEqual(new Set([0]));
      expect(outcome.dirty.dirtyFieldsBySourceIndex.get(0)).toEqual(new Set(["v"]));
    });

    it("partially-skipped path records empty field set for same-value update", () => {
      const store = new RowStore();
      store.replaceAll([{ id: "a", v: 1 }], resolveId);
      const outcome = store.applyTransaction(
        {
          add: [{ id: "a", v: 99 }],
          update: [{ id: "a", v: 1 }],
        },
        resolveId,
      );
      expect(outcome.structural).toBe(false);
      expect(outcome.changed).toBe(true);
      expect(outcome.dirty.dirtyFieldsBySourceIndex.get(0)?.size).toBe(0);
    });
  });
});
