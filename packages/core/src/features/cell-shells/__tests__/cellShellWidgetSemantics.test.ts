// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { PooledCell } from "../../../internal/poolTypes";
import {
  bindCellShell,
  type CellShellBindParams,
} from "../CellShellManager";
import type { CellShellConfig } from "../cellShellTypes";

function makeCell(): PooledCell {
  return {
    element: document.createElement("div"),
    value: "",
  };
}

function params(
  formattedValue: string,
  overrides: Partial<CellShellBindParams> = {},
): CellShellBindParams {
  return {
    row: { id: "r1", value: formattedValue },
    rowId: "r1",
    rowIndex: 0,
    column: { field: "value", headerName: "Value" },
    field: "value",
    value: formattedValue,
    formattedValue,
    ...overrides,
  };
}

describe("cell-shell owner-local widget semantics", () => {
  it("keeps checkbox controls native, named, and outside the Tab sequence", () => {
    const cell = makeCell();
    bindCellShell(cell, params("Enabled", { value: true }), {
      kind: "checkbox",
    });

    const input = cell.shellRoot?.querySelector("input");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input?.type).toBe("checkbox");
    expect(input?.tabIndex).toBe(-1);
    expect(input?.getAttribute("aria-label")).toBe("Value, Enabled");
  });

  it("uses native named buttons for top-level and grouped command shells", () => {
    const cases: CellShellConfig[] = [
      { kind: "button", text: { literal: "Edit" } },
      {
        kind: "iconButton",
        icon: "x",
        text: { literal: "Delete" },
      },
    ];

    for (const config of cases) {
      const cell = makeCell();
      bindCellShell(cell, params("ignored"), config);
      const button = cell.shellRoot as HTMLButtonElement;
      expect(button).toBeInstanceOf(HTMLButtonElement);
      expect(button.type).toBe("button");
      expect(button.tabIndex).toBe(-1);
      expect(button.getAttribute("role")).toBeNull();
      expect(button.getAttribute("aria-label")).toBe(
        config.kind === "button" ? "Edit" : "Delete",
      );
    }

    const grouped = makeCell();
    bindCellShell(grouped, params("ignored"), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "View" }, actionKey: "view" },
        { kind: "link", text: { literal: "Open" }, actionKey: "open" },
      ],
    });
    const children = Array.from(
      grouped.shellRoot?.children ?? [],
    ) as HTMLButtonElement[];
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.tagName)).toEqual([
      "BUTTON",
      "BUTTON",
    ]);
    expect(children.map((child) => child.tabIndex)).toEqual([-1, -1]);
    expect(children.map((child) => child.getAttribute("aria-label"))).toEqual([
      "View",
      "Open",
    ]);
    expect(children.map((child) => child.getAttribute("role"))).toEqual([
      null,
      null,
    ]);
  });

  it("publishes link semantics only for an interactive top-level link", () => {
    const cell = makeCell();
    const passive: CellShellConfig = { kind: "link" };
    bindCellShell(cell, params("Profile"), passive);

    const root = cell.shellRoot!;
    expect(root.tagName).toBe("SPAN");
    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("tabindex")).toBeNull();
    expect(root.getAttribute("aria-label")).toBeNull();
    expect(root.textContent).toBe("Profile");

    bindCellShell(cell, params("Open profile"), {
      kind: "link",
      actionKey: "open",
    });
    expect(cell.shellRoot).toBe(root);
    expect(root.getAttribute("role")).toBe("link");
    expect(root.tabIndex).toBe(-1);
    expect(root.getAttribute("aria-label")).toBe("Open profile");
    expect(root.textContent).toBe("Open profile");

    bindCellShell(cell, params("Profile"), passive);
    expect(cell.shellRoot).toBe(root);
    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("tabindex")).toBeNull();
    expect(root.getAttribute("aria-label")).toBeNull();
  });

  it("diffs owner-local names and does not re-enter the value pipeline", () => {
    const valueFormatter = vi.fn(() => "must not run");
    const getCellAriaLabel = vi.fn(() => "must not run");
    const cell = makeCell();
    const config: CellShellConfig = {
      kind: "button",
      actionKey: "open",
    };
    const binding = params("Open", {
      column: {
        field: "value",
        valueFormatter,
        getCellAriaLabel,
      },
    });

    bindCellShell(cell, binding, config);
    const root = cell.shellRoot!;
    const setAttribute = vi.spyOn(root, "setAttribute");
    const removeAttribute = vi.spyOn(root, "removeAttribute");

    bindCellShell(cell, binding, config);

    expect(
      setAttribute.mock.calls.filter(([name]) =>
        name === "aria-label" || name === "role" || name === "tabindex"
      ),
    ).toEqual([]);
    expect(
      removeAttribute.mock.calls.filter(([name]) =>
        name === "aria-label" || name === "role" || name === "tabindex"
      ),
    ).toEqual([]);
    expect(valueFormatter).not.toHaveBeenCalled();
    expect(getCellAriaLabel).not.toHaveBeenCalled();

    bindCellShell(cell, { ...binding, formattedValue: "Inspect" }, config);
    expect(root.getAttribute("aria-label")).toBe("Inspect");
    expect(
      setAttribute.mock.calls.filter(([name]) => name === "aria-label"),
    ).toEqual([["aria-label", "Inspect"]]);
  });

  it("fails safe to non-empty names when resolved action text is blank", () => {
    const button = makeCell();
    bindCellShell(button, params("", {
      column: { field: "account", headerName: "Account" },
    }), {
      kind: "button",
      actionKey: "edit",
    });
    expect(button.shellRoot?.getAttribute("aria-label")).toBe("Account edit");

    const grouped = makeCell();
    bindCellShell(grouped, params("", {
      column: { field: "account", headerName: "Account" },
    }), {
      kind: "buttonGroup",
      parts: [{ kind: "iconButton", icon: "x" }],
    });
    expect(
      grouped.shellRoot?.children[0]?.getAttribute("aria-label"),
    ).toBe("Account");

    const link = makeCell();
    bindCellShell(link, params("", {
      column: { field: "", headerName: "" },
    }), {
      kind: "link",
      overlay: { key: "details" },
    });
    expect(link.shellRoot?.getAttribute("aria-label")).toBe("Cell action");
  });
});
