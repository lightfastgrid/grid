import { describe, expect, it } from "vitest";

import { EditingStore } from "../EditingStore";
import type { NormalizedCellEditorConfig } from "../editingTypes";

const cfg: NormalizedCellEditorConfig = { kind: "text", options: [] };

describe("EditingStore", () => {
  it("starts empty", () => {
    const store = new EditingStore();
    expect(store.get()).toBeNull();
  });

  it("stores active edit", () => {
    const store = new EditingStore();
    store.start({ rowId: "r1", rowIndex: 0, field: "name", sourceIndex: 0, originalValue: "Alice", editorConfig: cfg });
    expect(store.get()).toEqual({
      rowId: "r1", rowIndex: 0, field: "name", sourceIndex: 0, originalValue: "Alice", editorConfig: cfg,
    });
  });

  it("clears active edit", () => {
    const store = new EditingStore();
    store.start({ rowId: "r1", rowIndex: 0, field: "name", sourceIndex: 0, originalValue: "A", editorConfig: cfg });
    store.clear();
    expect(store.get()).toBeNull();
  });

  it("isEditing returns true for matching rowId+field", () => {
    const store = new EditingStore();
    store.start({ rowId: "r1", rowIndex: 0, field: "name", sourceIndex: 0, originalValue: "A", editorConfig: cfg });
    expect(store.isEditing("r1", "name")).toBe(true);
  });

  it("isEditing returns false for non-matching", () => {
    const store = new EditingStore();
    store.start({ rowId: "r1", rowIndex: 0, field: "name", sourceIndex: 0, originalValue: "A", editorConfig: cfg });
    expect(store.isEditing("r1", "age")).toBe(false);
    expect(store.isEditing("r2", "name")).toBe(false);
  });

  it("isEditing returns false when empty", () => {
    const store = new EditingStore();
    expect(store.isEditing("r1", "name")).toBe(false);
  });
});
