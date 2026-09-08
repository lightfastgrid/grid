import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADVANCED_EXPORT_FLYOUT_WIDTH,
  resolveAdvancedExportFixedPosition,
} from "./placeAdvancedExportFlyout.ts";

describe("resolveAdvancedExportFixedPosition", () => {
  it("keeps the flyout to the right of the export panel", () => {
    const result = resolveAdvancedExportFixedPosition({
      panelTop: 80,
      panelRight: 400,
      viewportWidth: 1400,
      viewportHeight: 900,
      flyoutHeight: 420,
    });
    assert.equal(result.left, 410);
    assert.equal(result.top, 80);
    assert.equal(result.width, ADVANCED_EXPORT_FLYOUT_WIDTH);
  });

  it("stays on the right and shrinks when the viewport is tight", () => {
    const result = resolveAdvancedExportFixedPosition({
      panelTop: 80,
      panelRight: 900,
      viewportWidth: 1100,
      viewportHeight: 900,
      flyoutHeight: 420,
    });
    assert.equal(result.left, 910);
    assert.equal(result.width, 280);
  });

  it("shifts up only when the flyout would run off the bottom", () => {
    const result = resolveAdvancedExportFixedPosition({
      panelTop: 700,
      panelRight: 400,
      viewportWidth: 1400,
      viewportHeight: 900,
      flyoutHeight: 420,
    });
    assert.equal(result.left, 410);
    assert.ok(result.top < 700);
    assert.ok(result.top + 420 <= 888);
  });
});
