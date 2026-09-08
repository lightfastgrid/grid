import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdvancedExportParams,
  DEFAULT_ADVANCED_EXPORT_OPTIONS,
  DEMO_ROW_NUMBER_FIELD,
  normalizeExportFileName,
  resolveAdvancedExportColumnFields,
} from "./advancedExportModel.ts";

const DEMO_COLUMNS = [
  { field: DEMO_ROW_NUMBER_FIELD, visible: true },
  { field: "name", visible: true },
  { field: "status", visible: false },
];

describe("advancedExportModel", () => {
  it("defaults to filtered rows and visible fields including ID", () => {
    const params = buildAdvancedExportParams(
      DEFAULT_ADVANCED_EXPORT_OPTIONS,
      DEMO_COLUMNS,
    );
    assert.deepEqual(params.rows, { mode: "filteredAndSorted" });
    assert.deepEqual(params.columns, {
      mode: "fields",
      fields: [DEMO_ROW_NUMBER_FIELD, "name"],
    });
    assert.equal(params.includeRowNumbers, false);
    assert.equal(params.delimiter, ",");
  });

  it("omits demo ID column when includeRowNumbers is off", () => {
    assert.deepEqual(
      resolveAdvancedExportColumnFields(DEMO_COLUMNS, {
        scope: "visibleColumns",
        includeRowNumbers: false,
      }),
      ["name"],
    );
  });

  it("maps allRows and allColumns presets", () => {
    assert.deepEqual(
      buildAdvancedExportParams(
        { ...DEFAULT_ADVANCED_EXPORT_OPTIONS, scope: "allRows" },
        DEMO_COLUMNS,
      ).rows,
      { mode: "all" },
    );
    assert.deepEqual(
      buildAdvancedExportParams(
        { ...DEFAULT_ADVANCED_EXPORT_OPTIONS, scope: "allColumns" },
        DEMO_COLUMNS,
      ).columns,
      {
        mode: "fields",
        fields: [DEMO_ROW_NUMBER_FIELD, "name", "status"],
      },
    );
  });

  it("normalizes file names", () => {
    assert.equal(normalizeExportFileName("  report  "), "report.csv");
    assert.equal(normalizeExportFileName("data.CSV"), "data.CSV");
    assert.equal(
      normalizeExportFileName("   "),
      DEFAULT_ADVANCED_EXPORT_OPTIONS.fileName,
    );
  });
});
