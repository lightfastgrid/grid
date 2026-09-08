import { describe, expect, it } from "vitest";

import { SelectionStore } from "../SelectionStore";

describe("SelectionStore", () => {
  it("toggle in explicit mode adds and removes id", () => {
    const s = new SelectionStore("multiple");
    const a = s.toggle("a", 10);
    expect(a?.kind).toBe("toggle");
    expect(s.isSelected("a")).toBe(true);
    const b = s.toggle("a", 10);
    expect(b?.kind).toBe("toggle");
    expect(s.isSelected("a")).toBe(false);
  });

  it("selectAll switches to all model with empty exclusions", () => {
    const s = new SelectionStore("multiple");
    const ch = s.selectAll(100);
    expect(ch?.kind).toBe("selectAll");
    expect(ch?.changedIds).toEqual([]);
    expect(s.isAllRowsModel()).toBe(true);
    expect(s.isAllSelected(100)).toBe(true);
    expect(s.getSelectedCount(100)).toBe(100);
  });

  it("toggle in all model maintains exclusions", () => {
    const s = new SelectionStore("multiple");
    s.selectAll(3);
    s.toggle("b", 3);
    expect(s.isSelected("b")).toBe(false);
    expect(s.getSelectedCount(3)).toBe(2);
    expect(s.isPartiallySelected(3)).toBe(true);
    s.toggle("b", 3);
    expect(s.isSelected("b")).toBe(true);
    expect(s.isAllSelected(3)).toBe(true);
  });

  it("clear returns explicit empty", () => {
    const s = new SelectionStore("multiple");
    s.selectAll(5);
    const ch = s.clear(5);
    expect(ch?.kind).toBe("clear");
    expect(ch?.changedIds).toEqual([]);
    expect(s.getSelectedCount(5)).toBe(0);
  });

  it("getSelectedCount matches all minus exclusions", () => {
    const s = new SelectionStore("multiple");
    s.selectAll(10);
    s.toggle("x", 10);
    s.toggle("y", 10);
    expect(s.getSelectedCount(10)).toBe(8);
  });

  it("selectAll returns null in single mode", () => {
    const s = new SelectionStore("single");
    expect(s.selectAll(5)).toBeNull();
  });

  it("singleModeBodyClick deselects when row is selected", () => {
    const s = new SelectionStore("single");
    s.selectOnly("x", 5);
    const ch = s.singleModeBodyClick("x", 5);
    expect(ch?.kind).toBe("clear");
    expect(s.getSelectedCount(5)).toBe(0);
  });

  it("replaceSelectionWithRangeIds replaces explicit subset", () => {
    const s = new SelectionStore("multiple");
    s.toggle("a", 5);
    s.toggle("e", 5);
    const ch = s.replaceSelectionWithRangeIds(["b", "c"], 5);
    expect(ch).not.toBeNull();
    expect(s.isSelected("b")).toBe(true);
    expect(s.isSelected("c")).toBe(true);
    expect(s.isSelected("a")).toBe(false);
  });

  it("addRangeToSelection unions into explicit", () => {
    const s = new SelectionStore("multiple");
    s.replaceSelectionWithSingleId("a", 4);
    const ch = s.addRangeToSelection(["b", "c"], 4);
    expect(ch).not.toBeNull();
    expect(s.getSelectedCount(4)).toBe(3);
  });

  it("addRangeToSelection on all model clears exclusions in range only", () => {
    const s = new SelectionStore("multiple");
    s.selectAll(5);
    s.toggle("b", 5);
    s.toggle("d", 5);
    const ch = s.addRangeToSelection(["b", "c", "d"], 5);
    expect(ch).not.toBeNull();
    expect(s.isSelected("b")).toBe(true);
    expect(s.isSelected("d")).toBe(true);
    expect(s.getSelectedCount(5)).toBe(5);
  });

  it("captures explicit and all-minus-excluded membership without later mutation leaks", () => {
    const explicit = new SelectionStore("multiple");
    explicit.replaceWithIds(["a", "c"], 4);
    const explicitSnapshot = explicit.captureReadSnapshot(4);

    expect(explicitSnapshot).toMatchObject({
      model: "explicit",
      universeRowCount: 4,
      definitelyEmpty: false,
    });
    explicit.toggle("a", 4);
    explicit.toggle("b", 4);
    expect(explicitSnapshot.has("a")).toBe(true);
    expect(explicitSnapshot.has("b")).toBe(false);
    expect(explicitSnapshot.has("c")).toBe(true);
    expect(explicitSnapshot.definitelyEmpty).toBe(false);

    const all = new SelectionStore("multiple");
    all.selectAll(5);
    all.toggle("b", 5);
    const allSnapshot = all.captureReadSnapshot(5);

    expect(allSnapshot).toMatchObject({
      model: "allMinusExcluded",
      universeRowCount: 5,
      definitelyEmpty: false,
    });
    all.toggle("b", 5);
    all.toggle("d", 5);
    expect(allSnapshot.has("a")).toBe(true);
    expect(allSnapshot.has("b")).toBe(false);
    expect(allSnapshot.has("d")).toBe(true);
    expect(allSnapshot.definitelyEmpty).toBe(false);
  });

  it("keeps captures stable across every row-selection mutation family", () => {
    const assertExplicitCaptureSurvives = (
      mutate: (store: SelectionStore) => void,
    ): void => {
      const store = new SelectionStore("multiple");
      store.replaceWithIds(["a", "b"], 6);
      const captured = store.captureReadSnapshot(6);
      mutate(store);
      expect(captured.definitelyEmpty).toBe(false);
      expect(captured.has("a")).toBe(true);
      expect(captured.has("b")).toBe(true);
      expect(captured.has("c")).toBe(false);
    };

    const mutations: Array<(store: SelectionStore) => void> = [
      (store) => void store.toggle("a", 6),
      (store) => void store.replaceSelectionWithSingleId("c", 6),
      (store) => void store.replaceSelectionWithRangeIds(["c", "d"], 6),
      (store) => void store.addRangeToSelection(["c", "d"], 6),
      (store) => void store.selectAll(6),
      (store) => void store.selectIds(["c", "d"], 6),
      (store) => void store.deselectIds(["a"], 6),
      (store) => void store.replaceWithIds(["e"], 6),
      (store) => void store.clear(6),
      (store) => void store.setMode("single", 6),
    ];

    for (const mutate of mutations) assertExplicitCaptureSurvives(mutate);

    const all = new SelectionStore("multiple");
    all.selectAll(6);
    all.deselectIds(["b", "d"], 6);
    const capturedAll = all.captureReadSnapshot(6);
    all.selectIds(["b"], 6);
    all.deselectIds(["a"], 6);
    all.addRangeToSelection(["d"], 6);
    all.foldAllToExplicit("c", 6);

    expect(capturedAll.definitelyEmpty).toBe(false);
    expect(capturedAll.has("a")).toBe(true);
    expect(capturedAll.has("b")).toBe(false);
    expect(capturedAll.has("d")).toBe(false);
  });
});
