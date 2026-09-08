import { describe, expect, it } from "vitest";

import type { RowSelectionCheckboxColumnConfig } from "../../../types";
import {
  normalizeRowSelection,
  rowSelectionConfigsEqual,
} from "../../../utils/rowSelectionConfig";

const DEFAULT_CB_COL: RowSelectionCheckboxColumnConfig = {
  width: 44,
  pinned: false,
};

describe("normalizeRowSelection", () => {
  it('maps undefined and "none" to none with defaults', () => {
    expect(normalizeRowSelection(undefined)).toEqual({
      mode: "none",
      checkboxes: false,
      headerCheckbox: false,
      enableRowClickSelection: true,
      selectAllScope: "page",
      checkboxColumn: DEFAULT_CB_COL,
    });
    expect(normalizeRowSelection("none")).toEqual({
      mode: "none",
      checkboxes: false,
      headerCheckbox: false,
      enableRowClickSelection: true,
      selectAllScope: "page",
      checkboxColumn: DEFAULT_CB_COL,
    });
  });

  it('maps "single" / "multiple" / "multi" string modes', () => {
    expect(normalizeRowSelection("single").mode).toBe("single");
    expect(normalizeRowSelection("multiple").mode).toBe("multiple");
    expect(normalizeRowSelection("multi").mode).toBe("multiple");
    for (const v of ["single", "multiple", "multi"] as const) {
      const c = normalizeRowSelection(v);
      expect(c.checkboxes).toBe(false);
      expect(c.headerCheckbox).toBe(false);
      expect(c.enableRowClickSelection).toBe(true);
    }
  });

  it("object: missing mode => none; checkboxes/header rules", () => {
    expect(normalizeRowSelection({})).toEqual({
      mode: "none",
      checkboxes: false,
      headerCheckbox: false,
      enableRowClickSelection: true,
      selectAllScope: "page",
      checkboxColumn: DEFAULT_CB_COL,
    });

    expect(
      normalizeRowSelection({
        mode: "single",
        checkboxes: true,
      }),
    ).toEqual({
      mode: "single",
      checkboxes: true,
      headerCheckbox: false,
      enableRowClickSelection: false,
      selectAllScope: "page",
      checkboxColumn: DEFAULT_CB_COL,
    });

    expect(
      normalizeRowSelection({
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      }),
    ).toEqual({
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
      enableRowClickSelection: false,
      selectAllScope: "page",
      checkboxColumn: DEFAULT_CB_COL,
    });

    expect(
      normalizeRowSelection({
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        enableRowClickSelection: true,
      }).enableRowClickSelection,
    ).toBe(true);
  });

  it("checkboxes forced false when mode is none", () => {
    expect(
      normalizeRowSelection({
        mode: "none",
        checkboxes: true,
        headerCheckbox: true,
      }),
    ).toEqual({
      mode: "none",
      checkboxes: false,
      headerCheckbox: false,
      enableRowClickSelection: true,
      selectAllScope: "page",
      checkboxColumn: DEFAULT_CB_COL,
    });
  });

  it("headerCheckbox requires multiple + checkboxes", () => {
    expect(
      normalizeRowSelection({
        mode: "single",
        checkboxes: true,
        headerCheckbox: true,
      }).headerCheckbox,
    ).toBe(false);

    expect(
      normalizeRowSelection({
        mode: "multiple",
        checkboxes: false,
        headerCheckbox: true,
      }).headerCheckbox,
    ).toBe(false);
  });
});

/* ── enableRowClickSelection default contract ────────────── */

describe("enableRowClickSelection defaults", () => {
  it("defaults to true when checkboxes are disabled (string mode)", () => {
    expect(normalizeRowSelection("multiple").enableRowClickSelection).toBe(true);
    expect(normalizeRowSelection("single").enableRowClickSelection).toBe(true);
  });

  it("defaults to false when checkboxes are enabled", () => {
    const cfg = normalizeRowSelection({
      mode: "multiple",
      checkboxes: true,
    });
    expect(cfg.enableRowClickSelection).toBe(false);
  });

  it("explicit true overrides checkbox default", () => {
    const cfg = normalizeRowSelection({
      mode: "multiple",
      checkboxes: true,
      enableRowClickSelection: true,
    });
    expect(cfg.enableRowClickSelection).toBe(true);
  });

  it("explicit false disables even without checkboxes", () => {
    const cfg = normalizeRowSelection({
      mode: "multiple",
      enableRowClickSelection: false,
    });
    expect(cfg.enableRowClickSelection).toBe(false);
  });

  it("mode none always defaults to true (inert; no selection happens)", () => {
    const cfg = normalizeRowSelection({
      mode: "none",
      checkboxes: true,
    });
    // mode none forces checkboxes off, so enableRowClickSelection is true
    // but irrelevant since mode is none.
    expect(cfg.enableRowClickSelection).toBe(true);
  });
});

describe("rowSelectionConfigsEqual", () => {
  it("compares all fields", () => {
    const a = normalizeRowSelection("multiple");
    const b = { ...a };
    expect(rowSelectionConfigsEqual(a, b)).toBe(true);
    expect(
      rowSelectionConfigsEqual(a, { ...b, checkboxes: true }),
    ).toBe(false);
  });
});
