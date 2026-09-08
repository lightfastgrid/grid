import { describe, expect, it, vi } from "vitest";

import {
  captureAllMinusExcludedRowSelection,
  captureExplicitRowSelection,
  captureIdMembership,
  captureKeyedMembership,
} from "../readSnapshots";

describe("feature-neutral read snapshots", () => {
  it("captures Set membership without invoking iteration APIs", () => {
    const ids = new Set(["a", "b"]);
    const iterator = vi
      .spyOn(ids, Symbol.iterator)
      .mockImplementation(() => {
        throw new Error("iteration is forbidden");
      });
    const values = vi.spyOn(ids, "values").mockImplementation(() => {
      throw new Error("values iteration is forbidden");
    });
    const entries = vi.spyOn(ids, "entries").mockImplementation(() => {
      throw new Error("entries iteration is forbidden");
    });
    const forEach = vi.spyOn(ids, "forEach").mockImplementation(() => {
      throw new Error("forEach is forbidden");
    });

    const membership = captureIdMembership(ids);
    const explicit = captureExplicitRowSelection(ids, 5);
    const all = captureAllMinusExcludedRowSelection(ids, 5);

    expect(membership.size).toBe(2);
    expect(membership.has("a")).toBe(true);
    expect(explicit).toMatchObject({
      model: "explicit",
      definitelyEmpty: false,
    });
    expect(all).toMatchObject({
      model: "allMinusExcluded",
      definitelyEmpty: false,
    });
    expect(all.has("a")).toBe(false);
    expect(all.has("c")).toBe(true);
    expect("size" in explicit).toBe(false);
    expect("size" in all).toBe(false);
    expect(iterator).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
    expect(entries).not.toHaveBeenCalled();
    expect(forEach).not.toHaveBeenCalled();
  });

  it("proves emptiness only when the captured model can know it in O(1)", () => {
    expect(captureExplicitRowSelection(new Set(), 5).definitelyEmpty).toBe(
      true,
    );
    expect(
      captureAllMinusExcludedRowSelection(new Set(["outside"]), 0)
        .definitelyEmpty,
    ).toBe(true);
    expect(
      captureAllMinusExcludedRowSelection(
        new Set(["old-a", "old-b"]),
        1,
      ).definitelyEmpty,
    ).toBe(false);
  });

  it("captures Map membership without invoking iteration APIs", () => {
    const pins = new Map([
      ["a", "top"],
      ["b", "bottom"],
    ]);
    const iterator = vi
      .spyOn(pins, Symbol.iterator)
      .mockImplementation(() => {
        throw new Error("iteration is forbidden");
      });
    const entries = vi.spyOn(pins, "entries").mockImplementation(() => {
      throw new Error("entries iteration is forbidden");
    });
    const forEach = vi.spyOn(pins, "forEach").mockImplementation(() => {
      throw new Error("forEach is forbidden");
    });

    const membership = captureKeyedMembership(pins);

    expect(membership.size).toBe(2);
    expect(membership.get("a")).toBe("top");
    expect(membership.get("missing")).toBeUndefined();
    expect(iterator).not.toHaveBeenCalled();
    expect(entries).not.toHaveBeenCalled();
    expect(forEach).not.toHaveBeenCalled();
  });
});
