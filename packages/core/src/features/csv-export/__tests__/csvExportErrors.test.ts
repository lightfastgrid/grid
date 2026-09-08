import { describe, expect, it } from "vitest";

import {
  CsvExportCancelledError,
  CsvExportDisabledError,
  CsvExportDuplicateColumnError,
  CsvExportDuplicateRowError,
  CsvExportError,
  CsvExportInvalidOptionsError,
  CsvExportSinkError,
  CsvExportSizeLimitError,
  CsvExportUnknownColumnError,
  CsvExportUnknownRowError,
  CsvExportWorkerError,
} from "../csvExportErrors";

describe("CSV export errors - names and stable codes", () => {
  it("each error has the documented name and code", () => {
    const cases: Array<[CsvExportError, string, string]> = [
      [new CsvExportDisabledError(), "CsvExportDisabledError", "csv-export/disabled"],
      [
        new CsvExportInvalidOptionsError("bad"),
        "CsvExportInvalidOptionsError",
        "csv-export/invalid-options",
      ],
      [
        new CsvExportUnknownRowError("r1"),
        "CsvExportUnknownRowError",
        "csv-export/unknown-row",
      ],
      [
        new CsvExportUnknownColumnError("f1"),
        "CsvExportUnknownColumnError",
        "csv-export/unknown-column",
      ],
      [
        new CsvExportDuplicateRowError("r1"),
        "CsvExportDuplicateRowError",
        "csv-export/duplicate-row",
      ],
      [
        new CsvExportDuplicateColumnError("f1"),
        "CsvExportDuplicateColumnError",
        "csv-export/duplicate-column",
      ],
      [
        new CsvExportSizeLimitError(10, 5),
        "CsvExportSizeLimitError",
        "csv-export/size-limit",
      ],
      [new CsvExportCancelledError(), "CsvExportCancelledError", "csv-export/cancelled"],
      [new CsvExportWorkerError(), "CsvExportWorkerError", "csv-export/worker"],
      [new CsvExportSinkError(), "CsvExportSinkError", "csv-export/sink"],
    ];

    for (const [error, name, code] of cases) {
      expect(error).toBeInstanceOf(CsvExportError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(name);
      expect(error.code).toBe(code);
      expect(typeof error.message).toBe("string");
    }
  });
});

describe("CSV export errors - structured details", () => {
  it("row/column errors carry the offending id/field", () => {
    expect(new CsvExportUnknownRowError("r7").rowId).toBe("r7");
    expect(new CsvExportDuplicateRowError("r7").rowId).toBe("r7");
    expect(new CsvExportUnknownColumnError("price").field).toBe("price");
    expect(new CsvExportDuplicateColumnError("price").field).toBe("price");
  });

  it("size-limit error carries emitted and max bytes", () => {
    const error = new CsvExportSizeLimitError(600, 512);
    expect(error.emittedBytes).toBe(600);
    expect(error.maxOutputBytes).toBe(512);
  });
});

describe("CSV export errors - cause preservation", () => {
  it("wrapped worker/sink errors preserve the original cause", () => {
    const cause = new Error("underlying");
    expect(new CsvExportWorkerError("worker failed", { cause }).cause).toBe(cause);
    expect(new CsvExportSinkError("sink failed", { cause }).cause).toBe(cause);
    expect(
      new CsvExportInvalidOptionsError("bad", { cause }).cause,
    ).toBe(cause);
  });
});
