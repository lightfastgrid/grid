import { describe, expect, it } from "vitest";

import type { ColumnSelectionConfig } from "../../../types";
import { ColumnSelectionController } from "../ColumnSelectionController";

function createController(config: ColumnSelectionConfig): ColumnSelectionController {
  return new ColumnSelectionController({
    getConfig: () => config,
    getHeaderRowEl: () => null,
    getSelectableColumnIds: () => ["a", "b", "c", "d"],
  });
}

describe("ColumnSelectionController read snapshots", () => {
  it("keeps membership stable across replacement, pruning, clear, and disable", () => {
    const config: ColumnSelectionConfig = {
      enabled: true,
      mode: "multiple",
      enableHeaderClickSelection: true,
      clearOnOutsideClick: false,
    };
    const controller = createController(config);
    controller.setSelectedColumnIds(["a", "b"]);
    const replaced = controller.captureColumnSelectionSnapshot();
    controller.setSelectedColumnIds(["c"]);
    expect(replaced.size).toBe(2);
    expect(replaced.has("a")).toBe(true);
    expect(replaced.has("c")).toBe(false);

    const pruned = controller.captureColumnSelectionSnapshot();
    controller.setSelectedColumnIds(["a", "b", "c"]);
    const beforePrune = controller.captureColumnSelectionSnapshot();
    controller.clear();
    expect(pruned.has("c")).toBe(true);
    expect(beforePrune.size).toBe(3);
    expect(beforePrune.has("b")).toBe(true);

    controller.setSelectedColumnIds(["a", "d"]);
    const disabled = controller.captureColumnSelectionSnapshot();
    config.enabled = false;
    controller.syncDisabledFromConfig();
    expect(disabled.size).toBe(2);
    expect(disabled.has("d")).toBe(true);
  });

  it("keeps a captured Set stable when selectable-column pruning mutates live state", () => {
    const selectable = ["a", "b", "c"];
    const controller = new ColumnSelectionController({
      getConfig: () => ({
        enabled: true,
        mode: "multiple",
        enableHeaderClickSelection: true,
        clearOnOutsideClick: false,
      }),
      getHeaderRowEl: () => null,
      getSelectableColumnIds: () => selectable,
    });
    controller.setSelectedColumnIds(["a", "b", "c"]);
    const captured = controller.captureColumnSelectionSnapshot();
    selectable.splice(1, 1);
    controller.pruneToSelectableColumnsSilent();

    expect(controller.getSelectedColumnIds()).toEqual(["a", "c"]);
    expect(captured.size).toBe(3);
    expect(captured.has("b")).toBe(true);
  });
});
