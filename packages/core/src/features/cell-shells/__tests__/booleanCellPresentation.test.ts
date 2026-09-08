// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { PooledCell } from "../../../internal/poolTypes";
import type { CellShellBindParams } from "../CellShellManager";
import { bindCellShell, clearCellShell } from "../CellShellManager";
import type { CellShellConfig } from "../cellShellTypes";

function makeCell(): PooledCell {
  return { element: document.createElement("div"), value: "" };
}

function params(
  value: unknown,
  overrides: Partial<CellShellBindParams> = {},
): CellShellBindParams {
  return {
    row: { bought: value },
    rowId: "r1",
    rowIndex: 0,
    column: { field: "bought", headerName: "Bought", editable: true },
    field: "bought",
    value,
    formattedValue: value === true ? "Purchased" : "Not purchased",
    ...overrides,
  };
}

function input(cell: PooledCell): HTMLInputElement {
  const result = cell.element.querySelector<HTMLInputElement>(
    "input.lfg-cell-shell-checkbox-input",
  );
  if (result === null) throw new Error("Expected pooled checkbox input");
  return result;
}

const CHECKBOX: CellShellConfig = { kind: "checkbox" };

describe("boolean cell presentation (Stage 3)", () => {
  it.each([
    [true, true],
    [false, false],
    [null, false],
    [undefined, false],
  ])("renders valid value %s without coercion", (value, checked) => {
    const cell = makeCell();
    bindCellShell(cell, params(value), CHECKBOX);

    expect(input(cell).checked).toBe(checked);
    expect(input(cell).disabled).toBe(false);
    expect(input(cell).indeterminate).toBe(false);
  });

  it.each(["false", "true", 0, 1, {}, [], Number.NaN])(
    "renders invalid value %s unchecked and disabled",
    (value) => {
      const cell = makeCell();
      bindCellShell(cell, params(value), CHECKBOX);

      expect(input(cell).checked).toBe(false);
      expect(input(cell).disabled).toBe(true);
      expect(input(cell).indeterminate).toBe(false);
    },
  );

  it("uses native semantics, stays out of the Tab sequence, and is programmatically focusable", () => {
    const cell = makeCell();
    document.body.appendChild(cell.element);
    bindCellShell(cell, params(true), CHECKBOX);

    const control = input(cell);
    expect(control.type).toBe("checkbox");
    expect(control.tabIndex).toBe(-1);
    expect(control.hasAttribute("aria-checked")).toBe(false);
    control.focus();
    expect(document.activeElement).toBe(control);
  });

  it("uses the shared editability rules and invokes a conditional callback once", () => {
    const editable = vi.fn(() => false);
    const cell = makeCell();
    bindCellShell(
      cell,
      params(true, { column: { field: "bought", editable } }),
      CHECKBOX,
    );

    expect(input(cell).disabled).toBe(true);
    expect(editable).toHaveBeenCalledTimes(1);
  });

  it("disables safely when the editable callback throws", () => {
    const cell = makeCell();
    bindCellShell(
      cell,
      params(true, {
        column: {
          field: "bought",
          editable: () => {
            throw new Error("nope");
          },
        },
      }),
      CHECKBOX,
    );
    expect(input(cell).disabled).toBe(true);
  });

  it("composes the default name from visible header text and the existing formatted value", () => {
    const valueFormatter = vi.fn(() => "must not run");
    const getCellAriaLabel = vi.fn(() => "must not run");
    const cell = makeCell();
    bindCellShell(
      cell,
      params(true, {
        column: {
          field: "bought",
          headerName: "Bought",
          editable: true,
          valueFormatter,
        },
        formattedValue: "Purchased",
      }),
      CHECKBOX,
    );

    expect(input(cell).getAttribute("aria-label")).toBe("Bought, Purchased");
    expect(valueFormatter).not.toHaveBeenCalled();
    expect(getCellAriaLabel).not.toHaveBeenCalled();
  });

  it("resolves an aria-label override and falls back when it is empty", () => {
    const cell = makeCell();
    const config: CellShellConfig = {
      kind: "checkbox",
      checkbox: {
        ariaLabel: {
          from: "value",
          map: { true: "Approve purchase" },
          fallback: "",
        },
      },
    };
    bindCellShell(cell, params(true), config);
    expect(input(cell).getAttribute("aria-label")).toBe("Approve purchase");

    bindCellShell(cell, params(false), config);
    expect(input(cell).getAttribute("aria-label")).toBe(
      "Bought, Not purchased",
    );
  });

  it("adds a visible associated label only when configured", () => {
    const cell = makeCell();
    const labelled: CellShellConfig = {
      kind: "checkbox",
      checkbox: { label: "formattedValue" },
    };
    bindCellShell(cell, params(true), labelled);
    const firstInput = input(cell);
    const label = cell.element.querySelector("label.lfg-cell-shell-checkbox-label");
    expect(label?.contains(firstInput)).toBe(true);
    expect(label?.textContent).toBe("Purchased");

    bindCellShell(cell, params(false), CHECKBOX);
    expect(input(cell)).toBe(firstInput);
    expect(cell.element.querySelector("label")).toBeNull();
  });

  it("keeps a configured visible label in the accessible name", () => {
    const cell = makeCell();
    bindCellShell(cell, params(true), {
      kind: "checkbox",
      checkbox: {
        label: { literal: "Enabled" },
        ariaLabel: { literal: "Account setting" },
      },
    });

    expect(input(cell).getAttribute("aria-label")).toBe(
      "Enabled Account setting",
    );
  });

  it("does not duplicate a visible label already present in the name", () => {
    const cell = makeCell();
    bindCellShell(cell, params(false), {
      kind: "checkbox",
      checkbox: {
        label: { literal: "Not purchased" },
        ariaLabel: { literal: "Not purchased for this order" },
      },
    });

    expect(input(cell).getAttribute("aria-label")).toBe(
      "Not purchased for this order",
    );
  });

  it("reuses the pooled control and resets checked, disabled, and name", () => {
    const cell = makeCell();
    bindCellShell(cell, params(true), CHECKBOX);
    const control = input(cell);

    bindCellShell(
      cell,
      params("false", {
        column: { field: "active", headerName: "Active", editable: true },
        field: "active",
        formattedValue: "Unknown",
      }),
      CHECKBOX,
    );

    expect(input(cell)).toBe(control);
    expect(control.checked).toBe(false);
    expect(control.disabled).toBe(true);
    expect(control.getAttribute("aria-label")).toBe("Active, Unknown");
  });

  it("does not repeat checkbox ARIA writes when semantics are unchanged", () => {
    const cell = makeCell();
    bindCellShell(cell, params(true), CHECKBOX);
    const control = input(cell);
    const setAttribute = vi.spyOn(control, "setAttribute");
    const removeAttribute = vi.spyOn(control, "removeAttribute");

    bindCellShell(cell, params(true), CHECKBOX);

    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("clears pooled widget ownership without retaining interactive state", () => {
    const cell = makeCell();
    bindCellShell(cell, params(true), CHECKBOX);
    const control = input(cell);
    clearCellShell(cell);

    expect(control.isConnected).toBe(false);
    expect(control.tabIndex).toBe(-1);
  });

  it("attaches no per-cell event listener", () => {
    const add = vi.spyOn(EventTarget.prototype, "addEventListener");
    try {
      const cell = makeCell();
      bindCellShell(cell, params(true), CHECKBOX);
      expect(add).not.toHaveBeenCalled();
    } finally {
      add.mockRestore();
    }
  });
});
