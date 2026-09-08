import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  selectedColumnsExportHint,
  selectedRowsExportHint,
} from "./exportPanelModel.ts";

describe("exportPanelModel", () => {
  it("hints when nothing is selected", () => {
    assert.equal(selectedRowsExportHint(0), "No rows selected");
    assert.equal(selectedColumnsExportHint(0), "No columns selected");
  });

  it("hints with selection counts", () => {
    assert.equal(selectedRowsExportHint(3), "3 rows selected");
    assert.equal(selectedColumnsExportHint(1), "1 column selected");
  });
});
