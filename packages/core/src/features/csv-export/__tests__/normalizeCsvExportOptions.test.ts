import { describe, expect, it } from "vitest";

import { CsvExportInvalidOptionsError } from "../csvExportErrors";
import type { CsvExportDefaults } from "../csvExportTypes";
import {
  CSV_EXPORT_DEFAULT_MAX_BLOB_BYTES,
  CSV_EXPORT_DEFAULT_MAX_STREAM_BYTES,
  CSV_EXPORT_DEFAULT_MAX_TEXT_BYTES,
  normalizeCsvExportOptions,
  resolveMaxOutputBytes,
} from "../normalizeCsvExportOptions";

describe("normalizeCsvExportOptions - frozen defaults (Section 8)", () => {
  it("produces every documented default when input is undefined", () => {
    const n = normalizeCsvExportOptions(undefined);
    expect(n).toStrictEqual({
      enabled: true,
      fileName: "export.csv",
      rows: { mode: "filteredAndSorted" },
      columns: { mode: "visible" },
      includeColumnHeaders: true,
      includeColumnGroupHeaders: undefined,
      includePinnedTopRows: true,
      includePinnedBottomRows: true,
      includeInternalColumns: false,
      includeUtilityColumns: false,
      includeRowNumbers: { enabled: false },
      useValueFormatter: true,
      delimiter: ",",
      quoteMode: "minimal",
      lineEnding: "\r\n",
      utf8Bom: false,
      formulaProtection: "escape",
      maxOutputBytes: undefined,
    });
  });

  it("treats `true` identically to defaults", () => {
    expect(normalizeCsvExportOptions(true)).toStrictEqual(
      normalizeCsvExportOptions(undefined),
    );
  });
});

describe("normalizeCsvExportOptions - enabled semantics", () => {
  it("`false` normalizes to disabled", () => {
    expect(normalizeCsvExportOptions(false).enabled).toBe(false);
  });

  it("`{ enabled: false }` normalizes to disabled", () => {
    expect(normalizeCsvExportOptions({ enabled: false }).enabled).toBe(false);
  });

  it("`{ enabled: true }` and `{}` are enabled", () => {
    expect(normalizeCsvExportOptions({ enabled: true }).enabled).toBe(true);
    expect(normalizeCsvExportOptions({}).enabled).toBe(true);
  });
});

describe("normalizeCsvExportOptions - group-header tri-state", () => {
  it("preserves omitted (undefined)", () => {
    expect(normalizeCsvExportOptions({}).includeColumnGroupHeaders).toBeUndefined();
  });

  it("preserves explicit true", () => {
    expect(
      normalizeCsvExportOptions({ includeColumnGroupHeaders: true })
        .includeColumnGroupHeaders,
    ).toBe(true);
  });

  it("preserves explicit false", () => {
    expect(
      normalizeCsvExportOptions({ includeColumnGroupHeaders: false })
        .includeColumnGroupHeaders,
    ).toBe(false);
  });
});

describe("normalizeCsvExportOptions - input immutability", () => {
  it("does not mutate the input object or nested scopes", () => {
    const input: CsvExportDefaults = {
      rows: { mode: "ids", ids: ["a", "b"] },
      columns: { mode: "fields", fields: ["x"] },
      includeRowNumbers: { headerName: "#", startAt: 1 },
    };
    const snapshot = structuredClone(input);
    const n = normalizeCsvExportOptions(input);
    expect(input).toStrictEqual(snapshot);

    // Returned scopes must not alias the caller's nested objects/arrays.
    if (n.rows.mode === "ids" && input.rows?.mode === "ids") {
      expect(n.rows.ids).not.toBe(input.rows.ids);
    }
    if (n.columns.mode === "fields" && input.columns?.mode === "fields") {
      expect(n.columns.fields).not.toBe(input.columns.fields);
    }
  });

});

describe("normalizeCsvExportOptions - row-number normalization (Section 7)", () => {
  it("omitted resolves to disabled", () => {
    expect(normalizeCsvExportOptions({}).includeRowNumbers).toStrictEqual({
      enabled: false,
    });
  });

  it("false resolves to disabled", () => {
    expect(
      normalizeCsvExportOptions({ includeRowNumbers: false }).includeRowNumbers,
    ).toStrictEqual({ enabled: false });
  });

  it("true resolves to Row / 1", () => {
    expect(
      normalizeCsvExportOptions({ includeRowNumbers: true }).includeRowNumbers,
    ).toStrictEqual({ enabled: true, headerName: "Row", startAt: 1 });
  });

  it("empty object resolves to Row / 1", () => {
    expect(
      normalizeCsvExportOptions({ includeRowNumbers: {} }).includeRowNumbers,
    ).toStrictEqual({ enabled: true, headerName: "Row", startAt: 1 });
  });

  it("object with only headerName defaults startAt to 1", () => {
    expect(
      normalizeCsvExportOptions({ includeRowNumbers: { headerName: "No." } })
        .includeRowNumbers,
    ).toStrictEqual({ enabled: true, headerName: "No.", startAt: 1 });
  });

  it("object with only startAt defaults headerName to Row", () => {
    expect(
      normalizeCsvExportOptions({ includeRowNumbers: { startAt: 100 } })
        .includeRowNumbers,
    ).toStrictEqual({ enabled: true, headerName: "Row", startAt: 100 });
  });

  it("custom header and start are preserved", () => {
    expect(
      normalizeCsvExportOptions({
        includeRowNumbers: { headerName: "Line", startAt: 5 },
      }).includeRowNumbers,
    ).toStrictEqual({ enabled: true, headerName: "Line", startAt: 5 });
  });

  it("explicit empty header is preserved", () => {
    expect(
      normalizeCsvExportOptions({ includeRowNumbers: { headerName: "" } })
        .includeRowNumbers,
    ).toStrictEqual({ enabled: true, headerName: "", startAt: 1 });
  });

  it("explicit zero startAt is accepted", () => {
    expect(
      normalizeCsvExportOptions({ includeRowNumbers: { startAt: 0 } })
        .includeRowNumbers,
    ).toStrictEqual({ enabled: true, headerName: "Row", startAt: 0 });
  });

  it.each([1, 2, 42, Number.MAX_SAFE_INTEGER])(
    "accepts non-negative safe integer startAt %j",
    (startAt) => {
      const n = normalizeCsvExportOptions({ includeRowNumbers: { startAt } });
      expect(n.includeRowNumbers).toStrictEqual({
        enabled: true,
        headerName: "Row",
        startAt,
      });
    },
  );

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["beyond MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s startAt", (_label, startAt) => {
    expect(() =>
      normalizeCsvExportOptions({ includeRowNumbers: { startAt } }),
    ).toThrow(CsvExportInvalidOptionsError);
  });

  it("does not mutate the input row-number object", () => {
    const input = { includeRowNumbers: { headerName: "No." } };
    const snapshot = structuredClone(input);
    normalizeCsvExportOptions(input);
    expect(input).toStrictEqual(snapshot);
  });

  it("enabled branch exposes required headerName and startAt fields", () => {
    const n = normalizeCsvExportOptions({ includeRowNumbers: true });
    // Narrowing on the discriminant must yield non-optional fields.
    if (n.includeRowNumbers.enabled) {
      const headerName: string = n.includeRowNumbers.headerName;
      const startAt: number = n.includeRowNumbers.startAt;
      expect(typeof headerName).toBe("string");
      expect(typeof startAt).toBe("number");
    } else {
      throw new Error("expected enabled row numbers");
    }
  });
});

describe("normalizeCsvExportOptions - delimiter validation (Section 13.2)", () => {
  it.each([",", ";", "|", "\t", "🚀"])(
    "accepts single code point %j",
    (delimiter) => {
      expect(normalizeCsvExportOptions({ delimiter }).delimiter).toBe(delimiter);
    },
  );

  it.each(["", ",,", "ab", '"', "\r", "\n"])(
    "rejects invalid delimiter %j",
    (delimiter) => {
      expect(() => normalizeCsvExportOptions({ delimiter })).toThrow(
        CsvExportInvalidOptionsError,
      );
    },
  );
});

describe("normalizeCsvExportOptions - byte-limit validation (JSON-safe)", () => {
  it.each([1, 1024, 512 * 1024 * 1024, Number.MAX_SAFE_INTEGER])(
    "accepts positive finite limit %j",
    (value) => {
      expect(normalizeCsvExportOptions({ maxOutputBytes: value }).maxOutputBytes)
        .toBe(value);
    },
  );

  it.each([
    ["zero", 0],
    ["negative finite", -1],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
  ])("rejects %s limit", (_label, value) => {
    expect(() => normalizeCsvExportOptions({ maxOutputBytes: value })).toThrow(
      CsvExportInvalidOptionsError,
    );
  });
});

describe("resolveMaxOutputBytes - output-specific ceilings (Section 8)", () => {
  it("text defaults to 64 MiB", () => {
    expect(resolveMaxOutputBytes(undefined, "text")).toBe(
      CSV_EXPORT_DEFAULT_MAX_TEXT_BYTES,
    );
    expect(CSV_EXPORT_DEFAULT_MAX_TEXT_BYTES).toBe(64 * 1024 * 1024);
  });

  it("blob and download default to 512 MiB", () => {
    expect(resolveMaxOutputBytes(undefined, "blob")).toBe(
      CSV_EXPORT_DEFAULT_MAX_BLOB_BYTES,
    );
    expect(resolveMaxOutputBytes(undefined, "download")).toBe(
      CSV_EXPORT_DEFAULT_MAX_BLOB_BYTES,
    );
    expect(CSV_EXPORT_DEFAULT_MAX_BLOB_BYTES).toBe(512 * 1024 * 1024);
  });

  it("stream defaults to unlimited", () => {
    expect(resolveMaxOutputBytes(undefined, "stream")).toBe(
      CSV_EXPORT_DEFAULT_MAX_STREAM_BYTES,
    );
    expect(CSV_EXPORT_DEFAULT_MAX_STREAM_BYTES).toBe(Number.POSITIVE_INFINITY);
  });

  it("a configured limit overrides every target, including stream", () => {
    expect(resolveMaxOutputBytes(2048, "text")).toBe(2048);
    expect(resolveMaxOutputBytes(2048, "blob")).toBe(2048);
    expect(resolveMaxOutputBytes(2048, "download")).toBe(2048);
    expect(resolveMaxOutputBytes(2048, "stream")).toBe(2048);
  });
});
