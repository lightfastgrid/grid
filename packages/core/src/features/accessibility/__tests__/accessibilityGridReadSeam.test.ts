import { describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import { normalizeRowSelection } from "../../../utils/rowSelectionConfig";
import { createAccessibilityGridReadSeam } from "../accessibilityGridReadSeam";

describe("accessibility grid read seam", () => {
  it("derives aria-busy from the effective overlay priority", () => {
    const grid = new Grid({ rows: [{ id: "a" }], columns: [{ field: "id" }] });
    const seam = createAccessibilityGridReadSeam({
      getRowSelectionConfig: () => normalizeRowSelection(undefined),
      getGridInstance: () => grid,
    });

    expect(seam.isGridBusy()).toBe(false);
    grid.setLoading(true);
    expect(seam.isGridBusy()).toBe(true);

    grid.showNoRowsOverlay();
    expect(seam.isGridBusy()).toBe(false);
    grid.hideOverlay();
    expect(seam.isGridBusy()).toBe(true);

    grid.showLoadingOverlay();
    grid.setLoading(false);
    expect(seam.isGridBusy()).toBe(true);
    grid.hideOverlay();
    expect(seam.isGridBusy()).toBe(false);

    grid.destroy();
  });
});
