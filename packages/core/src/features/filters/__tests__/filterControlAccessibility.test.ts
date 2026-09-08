// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ColumnFilterType } from "../../../types";
import type { FilterMenuFormResult } from "../filterMenuForm";
import { createFilterMenuForm } from "../filterMenuForm";
import type { FilterSelectionValueResult } from "../filterSelectionValues";
import type { NormalizedColumnFilterConfig } from "../types";

const activeForms: FilterMenuFormResult[] = [];

function createConfig(type: ColumnFilterType): NormalizedColumnFilterConfig {
  return {
    type,
    defaultOperator: type === "text" ? "contains" : "equals",
    caseSensitive: false,
    trimInput: true,
  };
}

function createForm(
  type: ColumnFilterType,
  overrides: Partial<Parameters<typeof createFilterMenuForm>[0]> = {},
): FilterMenuFormResult {
  const result = createFilterMenuForm({
    field: "account_status",
    headerName: "Account status",
    config: createConfig(type),
    currentModel: null,
    setColumnFilterModel: vi.fn(),
    clearColumnFilter: vi.fn(),
    close: vi.fn(),
    showSelectionList: false,
    ...overrides,
  });
  activeForms.push(result);
  document.body.appendChild(result.element);
  return result;
}

afterEach(() => {
  for (const form of activeForms.splice(0)) {
    form.cleanup();
    form.element.remove();
  }
});

describe("filter form accessible names", () => {
  it.each<ColumnFilterType>(["text", "number", "date", "boolean"])(
    "names both %s condition rows without using placeholders as labels",
    (type) => {
      const { element } = createForm(type);
      const operators = element.querySelectorAll<HTMLSelectElement>(
        ".lfg-filter-form-operator",
      );
      const values = element.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        ".lfg-filter-form-value",
      );
      const endingValues = element.querySelectorAll<HTMLInputElement>(
        ".lfg-filter-form-value-to",
      );

      expect(Array.from(operators, (control) => control.getAttribute("aria-label"))).toEqual([
        "Account status filter condition 1 operator",
        "Account status filter condition 2 operator",
      ]);
      expect(Array.from(values, (control) => control.getAttribute("aria-label"))).toEqual([
        "Account status filter condition 1 value",
        "Account status filter condition 2 value",
      ]);
      expect(
        Array.from(endingValues, (control) => control.getAttribute("aria-label")),
      ).toEqual([
        "Account status filter condition 1 ending value",
        "Account status filter condition 2 ending value",
      ]);
      const controls = element.querySelectorAll("input, select");
      for (let i = 0; i < controls.length; i++) {
        expect(controls[i]!.getAttribute("aria-label")?.trim()).not.toBe("");
      }
    },
  );

  it("falls back from a blank header name to the field", () => {
    const { element } = createForm("text", { headerName: "  " });

    expect(
      element.querySelector(".lfg-filter-form-operator")?.getAttribute("aria-label"),
    ).toBe("account_status filter condition 1 operator");
  });

  it("uses form-local radio names and canonical ids across simultaneous forms", () => {
    const first = createForm("text", {
      field: "first field",
      headerName: "First / Account",
    }).element;
    const second = createForm("text", {
      field: "second field",
      headerName: "Second / Account",
    }).element;
    const firstRadios = first.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const secondRadios = second.querySelectorAll<HTMLInputElement>('input[type="radio"]');

    expect(firstRadios[0]!.name).not.toBe(secondRadios[0]!.name);
    expect(firstRadios[0]!.id).toMatch(/^lfg-filter-join-[1-9]\d*-and$/);
    expect(firstRadios[1]!.id).toMatch(/^lfg-filter-join-[1-9]\d*-or$/);
    expect(firstRadios[0]!.id).not.toContain("first");
    expect(secondRadios[0]!.id).not.toContain("second");
    expect(firstRadios[0]!.getAttribute("aria-label")).toBe(
      "AND, combine First / Account filter conditions",
    );
    expect(firstRadios[1]!.getAttribute("aria-label")).toBe(
      "OR, combine First / Account filter conditions",
    );

    firstRadios[1]!.click();

    expect(firstRadios[1]!.checked).toBe(true);
    expect(secondRadios[0]!.checked).toBe(true);
  });

  it("names selection search and values from their formatted visible labels", () => {
    const selectionValues: FilterSelectionValueResult = {
      values: [
        {
          key: "active",
          value: "active",
          label: "Active account",
          count: 2,
          sampleRowIndex: 0,
        },
        {
          key: "blank",
          value: "",
          label: "   ",
          count: 1,
          sampleRowIndex: 1,
        },
      ],
      totalDistinct: 2,
      scannedRowCount: 3,
      truncated: false,
    };
    const { element } = createForm("text", {
      getSelectionValues: () => selectionValues,
      showSelectionList: true,
    });
    const checkboxes = element.querySelectorAll<HTMLInputElement>(
      ".lfg-filter-selection-item input[type=checkbox]",
    );

    expect(
      element
        .querySelector(".lfg-filter-selection-search")
        ?.getAttribute("aria-label"),
    ).toBe("Search Account status filter values");
    expect(checkboxes[0]!.getAttribute("aria-label")).toBe(
      "Active account, filter Account status",
    );
    expect(checkboxes[1]!.getAttribute("aria-label")).toBe(
      "Blank value, filter Account status",
    );
  });
});
