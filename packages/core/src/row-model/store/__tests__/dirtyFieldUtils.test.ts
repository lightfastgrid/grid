import { describe, expect, it } from "vitest";

import { didAnyDirtyFieldTouch } from "../dirtyFieldUtils";
import type { RowStoreDirtyMetadata } from "../RowStore.types";

function makeDirty(
  opts: Partial<RowStoreDirtyMetadata> = {},
): RowStoreDirtyMetadata {
  return {
    updatedRowIds: opts.updatedRowIds ?? new Set(),
    dirtyFieldsByRowId: opts.dirtyFieldsByRowId ?? new Map(),
    structural: opts.structural ?? false,
    updatedSourceIndexes: opts.updatedSourceIndexes ?? new Set(),
    dirtyFieldsBySourceIndex: opts.dirtyFieldsBySourceIndex ?? new Map(),
  };
}

describe("didAnyDirtyFieldTouch", () => {
  it("returns false when no rows updated", () => {
    expect(didAnyDirtyFieldTouch(new Set(["v"]), makeDirty())).toBe(false);
  });

  it("returns true for structural changes regardless of fields", () => {
    expect(
      didAnyDirtyFieldTouch(new Set(["v"]), makeDirty({ structural: true })),
    ).toBe(true);
  });

  it("returns true for direct field match", () => {
    const dirty = makeDirty({
      updatedRowIds: new Set(["a"]),
      dirtyFieldsByRowId: new Map([["a", new Set(["v", "name"])]]),
    });
    expect(didAnyDirtyFieldTouch(new Set(["v"]), dirty)).toBe(true);
    expect(didAnyDirtyFieldTouch(new Set(["name"]), dirty)).toBe(true);
  });

  it("returns false when dirty fields do not match query", () => {
    const dirty = makeDirty({
      updatedRowIds: new Set(["a"]),
      dirtyFieldsByRowId: new Map([["a", new Set(["name"])]]),
    });
    expect(didAnyDirtyFieldTouch(new Set(["v"]), dirty)).toBe(false);
  });

  it("dot-path query matches prefix dirty field", () => {
    const dirty = makeDirty({
      updatedRowIds: new Set(["a"]),
      dirtyFieldsByRowId: new Map([["a", new Set(["user"])]]),
    });
    expect(didAnyDirtyFieldTouch(new Set(["user.name"]), dirty)).toBe(true);
  });

  it("dot-path query does not match unrelated dirty field", () => {
    const dirty = makeDirty({
      updatedRowIds: new Set(["a"]),
      dirtyFieldsByRowId: new Map([["a", new Set(["address"])]]),
    });
    expect(didAnyDirtyFieldTouch(new Set(["user.name"]), dirty)).toBe(false);
  });

  it("conservative: returns true when rows updated but no field info", () => {
    const dirty = makeDirty({
      updatedRowIds: new Set(["a"]),
      dirtyFieldsByRowId: new Map(),
    });
    expect(didAnyDirtyFieldTouch(new Set(["anything"]), dirty)).toBe(true);
  });

  it("unions dirty fields across multiple rows", () => {
    const dirty = makeDirty({
      updatedRowIds: new Set(["a", "b"]),
      dirtyFieldsByRowId: new Map([
        ["a", new Set(["name"])],
        ["b", new Set(["score"])],
      ]),
    });
    expect(didAnyDirtyFieldTouch(new Set(["name"]), dirty)).toBe(true);
    expect(didAnyDirtyFieldTouch(new Set(["score"]), dirty)).toBe(true);
    expect(didAnyDirtyFieldTouch(new Set(["other"]), dirty)).toBe(false);
  });
});
