// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ColumnMenuController } from "../../features/column-menu/ColumnMenuController";
import type { ColumnMenuContext } from "../../features/column-menu/types";
import { visibilityMenuContribution } from "../../features/column-menu/visibilityMenuContribution";
import { columnPinningMenuContribution } from "../../features/column-pinning/columnPinningMenuContribution";
import { filterMenuContribution } from "../../features/filters/filterMenuContribution";
import { sortColumnMenuContribution } from "../../features/sort/sortColumnMenuContribution";
import type { ColumnFilterModel, ColumnMenuOptions } from "../../types";

function makeCtx(
  overrides: Partial<ColumnMenuContext> = {},
): ColumnMenuContext {
  return {
    field: "a",
    column: { field: "a" },
    columns: [{ field: "a" }, { field: "b" }],
    sortModel: [],
    selectedColumnIds: [],
    close: vi.fn(),
    ...overrides,
  };
}

describe("sortColumnMenuContribution", () => {
  it("returns sort section for sortable column", () => {
    const setColumnSort = vi.fn();
    const contrib = sortColumnMenuContribution({ setColumnSort });
    const sections = contrib.getSections(makeCtx());

    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe("sort");
    expect(sections[0]!.items).toHaveLength(3);
    expect(sections[0]!.items[0]!.id).toBe("sort-asc");
    expect(sections[0]!.items[1]!.id).toBe("sort-desc");
    expect(sections[0]!.items[2]!.id).toBe("sort-clear");
  });

  it("returns empty when sortable is false", () => {
    const contrib = sortColumnMenuContribution({ setColumnSort: vi.fn() });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", sortable: false } }),
    );

    expect(sections).toHaveLength(0);
  });

  it("disables sort-asc when already ascending", () => {
    const contrib = sortColumnMenuContribution({ setColumnSort: vi.fn() });
    const sections = contrib.getSections(
      makeCtx({ sortModel: [{ field: "a", sort: "asc" }] }),
    );

    expect(sections[0]!.items[0]!.disabled).toBe(true);
    expect(sections[0]!.items[1]!.disabled).toBeFalsy();
  });

  it("hides sort-clear when column not sorted", () => {
    const contrib = sortColumnMenuContribution({ setColumnSort: vi.fn() });
    const sections = contrib.getSections(makeCtx());

    expect(sections[0]!.items[2]!.hidden).toBe(true);
  });

  it("calls setColumnSort with ui source on action", () => {
    const setColumnSort = vi.fn();
    const close = vi.fn();
    const contrib = sortColumnMenuContribution({ setColumnSort });
    const sections = contrib.getSections(makeCtx({ close }));

    sections[0]!.items[0]!.action!();
    expect(close).toHaveBeenCalled();
    expect(setColumnSort).toHaveBeenCalledWith("a", "asc", "ui", { multi: true });
  });

  it("clear sort passes multi: true", () => {
    const setColumnSort = vi.fn();
    const close = vi.fn();
    const contrib = sortColumnMenuContribution({ setColumnSort });
    const sections = contrib.getSections(
      makeCtx({ close, sortModel: [{ field: "a", sort: "asc" }] }),
    );

    sections[0]!.items[2]!.action!();
    expect(setColumnSort).toHaveBeenCalledWith("a", null, "ui", { multi: true });
  });

  it("hides sort section when columnMenu is provided but sort is omitted", () => {
    const contrib = sortColumnMenuContribution({
      setColumnSort: vi.fn(),
      getOptions: () => ({ pinning: true }),
    });
    const sections = contrib.getSections(makeCtx());
    expect(sections).toHaveLength(0);
  });

  it("sort object acts as explicit allow-list", () => {
    const contrib = sortColumnMenuContribution({
      setColumnSort: vi.fn(),
      getOptions: () => ({ sort: { asc: true } }),
    });
    const sections = contrib.getSections(makeCtx());
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items.map((i) => i.id)).toEqual(["sort-asc"]);
  });
});

describe("columnPinningMenuContribution", () => {
  it("returns pin section for pinnable column", () => {
    const pinColumn = vi.fn();
    const contrib = columnPinningMenuContribution({ pinColumn });
    const sections = contrib.getSections(makeCtx());

    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe("pin");
    expect(sections[0]!.items[0]!.id).toBe("pin-left");
    expect(sections[0]!.items[1]!.id).toBe("pin-right");
    expect(sections[0]!.items[2]!.id).toBe("unpin");
  });

  it("returns empty when pinnable is false", () => {
    const contrib = columnPinningMenuContribution({ pinColumn: vi.fn() });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", pinnable: false } }),
    );

    expect(sections).toHaveLength(0);
  });

  it("disables pin-left when already pinned left", () => {
    const contrib = columnPinningMenuContribution({ pinColumn: vi.fn() });
    const sections = contrib.getSections(
      makeCtx({
        column: { field: "a", pinned: "left" },
        columns: [{ field: "a", pinned: "left" }, { field: "b" }],
      }),
    );

    expect(sections[0]!.items[0]!.disabled).toBe(true);
    expect(sections[0]!.items[1]!.disabled).toBeFalsy();
  });

  it("hides unpin when not pinned", () => {
    const contrib = columnPinningMenuContribution({ pinColumn: vi.fn() });
    const sections = contrib.getSections(makeCtx());

    expect(sections[0]!.items[2]!.hidden).toBe(true);
  });

  it("calls pinColumn on action", () => {
    const pinColumn = vi.fn();
    const close = vi.fn();
    const contrib = columnPinningMenuContribution({ pinColumn });
    const sections = contrib.getSections(makeCtx({ close }));

    sections[0]!.items[0]!.action!();
    expect(close).toHaveBeenCalled();
    expect(pinColumn).toHaveBeenCalledWith("a", "left");
  });

  it("hides pinning section when columnMenu is provided but pinning is omitted", () => {
    const contrib = columnPinningMenuContribution({
      pinColumn: vi.fn(),
      getOptions: () => ({ sort: true }),
    });
    const sections = contrib.getSections(makeCtx());
    expect(sections).toHaveLength(0);
  });

  it("pinning object acts as explicit allow-list", () => {
    const contrib = columnPinningMenuContribution({
      pinColumn: vi.fn(),
      getOptions: () => ({ pinning: { pinLeft: true } }),
    });
    const sections = contrib.getSections(makeCtx());
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items.map((i) => i.id)).toEqual(["pin-left"]);
  });

  it("multi-select pin-left calls setColumnPinState with all selected targets and preserves existing pins", () => {
    const pinColumn = vi.fn();
    const setColumnPinState = vi.fn();
    const close = vi.fn();
    const contrib = columnPinningMenuContribution({ pinColumn, setColumnPinState });

    const columns = [
      { field: "a", pinned: "left" as const },
      { field: "b" },
      { field: "c" },
      { field: "d" },
    ];

    const sections = contrib.getSections(
      makeCtx({
        field: "c",
        column: columns[2]!,
        columns,
        selectedColumnIds: ["c", "d"],
        close,
      }),
    );

    // Action: pin selected left
    sections[0]!.items[0]!.action!();
    expect(close).toHaveBeenCalled();
    expect(pinColumn).not.toHaveBeenCalled();
    expect(setColumnPinState).toHaveBeenCalledWith([
      { field: "a", pinned: "left" },
      { field: "c", pinned: "left" },
      { field: "d", pinned: "left" },
    ]);
  });

  it("clicked column not selected: pin-left only targets clicked column", () => {
    const pinColumn = vi.fn();
    const setColumnPinState = vi.fn();
    const close = vi.fn();
    const contrib = columnPinningMenuContribution({ pinColumn, setColumnPinState });

    const sections = contrib.getSections(
      makeCtx({
        field: "a",
        column: { field: "a" },
        columns: [{ field: "a" }, { field: "b" }],
        selectedColumnIds: ["b"],
        close,
      }),
    );

    sections[0]!.items[0]!.action!();
    // Single target uses pinColumn, not setColumnPinState
    expect(pinColumn).toHaveBeenCalledWith("a", "left");
    expect(setColumnPinState).not.toHaveBeenCalled();
  });

  it("pinnable:false selected column is excluded from targets", () => {
    const pinColumn = vi.fn();
    const setColumnPinState = vi.fn();
    const close = vi.fn();
    const contrib = columnPinningMenuContribution({ pinColumn, setColumnPinState });

    const columns = [
      { field: "a" },
      { field: "b", pinnable: false },
      { field: "c" },
    ];

    const sections = contrib.getSections(
      makeCtx({
        field: "a",
        column: columns[0]!,
        columns,
        selectedColumnIds: ["a", "b", "c"],
        close,
      }),
    );

    sections[0]!.items[0]!.action!();
    expect(setColumnPinState).toHaveBeenCalledWith([
      { field: "a", pinned: "left" },
      { field: "c", pinned: "left" },
    ]);
  });

  it("labels change to 'Pin selected ...' for multi-target", () => {
    const contrib = columnPinningMenuContribution({ pinColumn: vi.fn() });

    const columns = [{ field: "a" }, { field: "b" }];
    const sections = contrib.getSections(
      makeCtx({
        field: "a",
        column: columns[0]!,
        columns,
        selectedColumnIds: ["a", "b"],
      }),
    );

    expect(sections[0]!.items[0]!.label).toBe("Pin selected left");
    expect(sections[0]!.items[1]!.label).toBe("Pin selected right");
    expect(sections[0]!.items[2]!.label).toBe("Unpin selected");
  });

  it("unpin selected preserves non-target pinned columns", () => {
    const setColumnPinState = vi.fn();
    const close = vi.fn();
    const contrib = columnPinningMenuContribution({
      pinColumn: vi.fn(),
      setColumnPinState,
    });

    const columns = [
      { field: "a", pinned: "left" as const },
      { field: "b", pinned: "right" as const },
      { field: "c", pinned: "left" as const },
    ];

    const sections = contrib.getSections(
      makeCtx({
        field: "b",
        column: columns[1]!,
        columns,
        selectedColumnIds: ["b", "c"],
        close,
      }),
    );

    // Find unpin item
    const unpinItem = sections[0]!.items.find((i) => i.id === "unpin")!;
    expect(unpinItem.hidden).toBeFalsy();
    unpinItem.action!();

    // Should preserve a's left pin, unpin b and c
    expect(setColumnPinState).toHaveBeenCalledWith([
      { field: "a", pinned: "left" },
    ]);
  });

  it("pin-left disabled only when all targets already pinned left", () => {
    const contrib = columnPinningMenuContribution({ pinColumn: vi.fn() });

    const columns = [
      { field: "a", pinned: "left" as const },
      { field: "b", pinned: "left" as const },
    ];

    const sections = contrib.getSections(
      makeCtx({
        field: "a",
        column: columns[0]!,
        columns,
        selectedColumnIds: ["a", "b"],
      }),
    );

    expect(sections[0]!.items[0]!.disabled).toBe(true); // pin-left disabled
    expect(sections[0]!.items[1]!.disabled).toBeFalsy(); // pin-right not disabled
  });

  it("unpin hidden when no target columns are pinned", () => {
    const contrib = columnPinningMenuContribution({ pinColumn: vi.fn() });

    const columns = [{ field: "a" }, { field: "b" }];

    const sections = contrib.getSections(
      makeCtx({
        field: "a",
        column: columns[0]!,
        columns,
        selectedColumnIds: ["a", "b"],
      }),
    );

    const unpinItem = sections[0]!.items.find((i) => i.id === "unpin")!;
    expect(unpinItem.hidden).toBe(true);
  });
});

describe("visibilityMenuContribution", () => {
  it("returns single hide item for unselected column", () => {
    const hideColumns = vi.fn();
    const contrib = visibilityMenuContribution({ hideColumns });
    const sections = contrib.getSections(makeCtx());

    expect(sections).toHaveLength(1);
    expect(sections[0]!.items[0]!.label).toBe("Hide column");
  });

  it("returns multi-hide item when column is in multi-selection", () => {
    const hideColumns = vi.fn();
    const contrib = visibilityMenuContribution({ hideColumns });
    const sections = contrib.getSections(
      makeCtx({ selectedColumnIds: ["a", "b"] }),
    );

    expect(sections[0]!.items[0]!.label).toBe("Hide selected columns");
  });

  it("single-hide calls hideColumns with array", () => {
    const hideColumns = vi.fn();
    const close = vi.fn();
    const contrib = visibilityMenuContribution({ hideColumns });
    const sections = contrib.getSections(makeCtx({ close }));

    sections[0]!.items[0]!.action!();
    expect(close).toHaveBeenCalled();
    expect(hideColumns).toHaveBeenCalledWith(["a"]);
  });

  it("multi-hide calls hideColumns with selected visible fields", () => {
    const hideColumns = vi.fn();
    const close = vi.fn();
    const contrib = visibilityMenuContribution({ hideColumns });
    const sections = contrib.getSections(
      makeCtx({ close, selectedColumnIds: ["a", "b"] }),
    );

    sections[0]!.items[0]!.action!();
    expect(hideColumns).toHaveBeenCalledWith(["a", "b"]);
  });

  it("hides visibility section when columnMenu is provided but visibility is omitted", () => {
    const hideColumns = vi.fn();
    const contrib = visibilityMenuContribution({
      hideColumns,
      getOptions: () => ({ sort: true }),
    });
    const sections = contrib.getSections(makeCtx());
    expect(sections).toHaveLength(0);
  });

  it("visibility object acts as explicit allow-list", () => {
    const hideColumns = vi.fn();
    const contrib = visibilityMenuContribution({
      hideColumns,
      getOptions: () => ({ visibility: { hideColumn: true } }),
    });
    const sections = contrib.getSections(makeCtx({ selectedColumnIds: ["a", "b"] }));
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items[0]!.label).toBe("Hide column");
  });
});

describe("filterMenuContribution", () => {
  function makeFilterContrib(
    overrides: Partial<Parameters<typeof filterMenuContribution>[0]> = {},
  ) {
    return filterMenuContribution({
      getColumnFilterModel: () => null,
      setColumnFilterModel: vi.fn(),
      clearColumnFilter: vi.fn(),
      ...overrides,
    });
  }

  const textConfig = {
    type: "text" as const,
    defaultOperator: "contains" as const,
    caseSensitive: false,
    trimInput: true,
  };

  const numberConfig = {
    type: "number" as const,
    defaultOperator: "equals" as const,
    caseSensitive: false,
    trimInput: true,
  };

  const activeTextModel = {
    type: "text" as const,
    operator: "and" as const,
    conditions: [{ operator: "contains" as const, value: "a" }],
  };

  it("returns filter section for filterable column", () => {
    const contrib = makeFilterContrib({ getFilterConfig: () => textConfig });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe("filter");
    expect(sections[0]!.items.map((i) => i.id)).toContain("filter-clear");
    expect(sections[0]!.render).toBeTypeOf("function");
  });

  it("returns empty for unfilterable column", () => {
    const contrib = makeFilterContrib();
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: false } }),
    );

    expect(sections).toHaveLength(0);
  });

  it("returns empty when filterable is undefined", () => {
    const contrib = makeFilterContrib();
    const sections = contrib.getSections(makeCtx());

    expect(sections).toHaveLength(0);
  });

  it("text filter form renders operator select and value input", () => {
    const contrib = makeFilterContrib({ getFilterConfig: () => textConfig });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const form = host.querySelector(".lfg-filter-form")!;
    expect(form).not.toBeNull();
    const select = form.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(8); // text has 8 operators
    const valueInput = form.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    expect(valueInput).not.toBeNull();
    expect(valueInput.type).toBe("text");
  });

  it("number filter form renders for number columns", () => {
    const contrib = makeFilterContrib({ getFilterConfig: () => numberConfig });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const select = host.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(9); // number has 9 operators
    const valueInput = host.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    expect(valueInput.type).toBe("number");
  });

  it("date filter form renders date inputs", () => {
    const dateConfig = {
      type: "date" as const,
      defaultOperator: "equals" as const,
      caseSensitive: false,
      trimInput: true,
    };
    const contrib = makeFilterContrib({ getFilterConfig: () => dateConfig });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const opSelect = host.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    expect(opSelect).not.toBeNull();
    expect(opSelect.options.length).toBe(7);

    const valueInput = host.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    expect(valueInput).not.toBeNull();
    expect(valueInput.type).toBe("date");

    const valueToInput = host.querySelector("input.lfg-filter-form-value-to") as HTMLInputElement;
    expect(valueToInput).not.toBeNull();
    expect(valueToInput.type).toBe("date");
  });

  it("date apply sends string value", () => {
    const dateConfig = {
      type: "date" as const,
      defaultOperator: "equals" as const,
      caseSensitive: false,
      trimInput: true,
    };
    const setColumnFilterModel = vi.fn();
    const close = vi.fn();
    const contrib = makeFilterContrib({
      setColumnFilterModel,
      getFilterConfig: () => dateConfig,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "joined", column: { field: "joined", filterable: true }, close }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const valueInput = host.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    valueInput.value = "2024-06-01";

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "joined",
      expect.objectContaining({
        type: "date",
        conditions: [{ operator: "equals", value: "2024-06-01" }],
      }),
      "ui",
    );
  });

  it("date between sends value and valueTo", () => {
    const dateConfig = {
      type: "date" as const,
      defaultOperator: "equals" as const,
      caseSensitive: false,
      trimInput: true,
    };
    const setColumnFilterModel = vi.fn();
    const close = vi.fn();
    const contrib = makeFilterContrib({
      setColumnFilterModel,
      getFilterConfig: () => dateConfig,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "joined", column: { field: "joined", filterable: true }, close }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const opSelect = host.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    opSelect.value = "between";
    opSelect.dispatchEvent(new Event("change"));

    const valueInput = host.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    valueInput.value = "2024-01-01";
    const valueToInput = host.querySelector("input.lfg-filter-form-value-to") as HTMLInputElement;
    valueToInput.value = "2024-12-31";

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "joined",
      expect.objectContaining({
        type: "date",
        conditions: [{ operator: "between", value: "2024-01-01", valueTo: "2024-12-31" }],
      }),
      "ui",
    );
  });

  it("boolean filter form renders true/false select", () => {
    const boolConfig = {
      type: "boolean" as const,
      defaultOperator: "equals" as const,
      caseSensitive: false,
      trimInput: true,
    };
    const contrib = makeFilterContrib({ getFilterConfig: () => boolConfig });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const opSelect = host.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    expect(opSelect).not.toBeNull();
    expect(opSelect.options.length).toBe(4);

    const valueSelect = host.querySelector("select.lfg-filter-form-value") as HTMLSelectElement;
    expect(valueSelect).not.toBeNull();
    expect(valueSelect.options.length).toBe(2);
    expect(valueSelect.options[0]!.value).toBe("true");
    expect(valueSelect.options[1]!.value).toBe("false");

    expect(host.querySelector("input.lfg-filter-form-value")).toBeNull();
  });

  it("boolean apply sends boolean value true", () => {
    const boolConfig = {
      type: "boolean" as const,
      defaultOperator: "equals" as const,
      caseSensitive: false,
      trimInput: true,
    };
    const setColumnFilterModel = vi.fn();
    const close = vi.fn();
    const contrib = makeFilterContrib({
      setColumnFilterModel,
      getFilterConfig: () => boolConfig,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "bought", column: { field: "bought", filterable: true }, close }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const valueSelect = host.querySelector("select.lfg-filter-form-value") as HTMLSelectElement;
    valueSelect.value = "true";

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "bought",
      expect.objectContaining({
        type: "boolean",
        conditions: [{ operator: "equals", value: true }],
      }),
      "ui",
    );
  });

  it("boolean apply sends boolean value false", () => {
    const boolConfig = {
      type: "boolean" as const,
      defaultOperator: "equals" as const,
      caseSensitive: false,
      trimInput: true,
    };
    const setColumnFilterModel = vi.fn();
    const close = vi.fn();
    const contrib = makeFilterContrib({
      setColumnFilterModel,
      getFilterConfig: () => boolConfig,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "bought", column: { field: "bought", filterable: true }, close }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const valueSelect = host.querySelector("select.lfg-filter-form-value") as HTMLSelectElement;
    valueSelect.value = "false";

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "bought",
      expect.objectContaining({
        type: "boolean",
        conditions: [{ operator: "equals", value: false }],
      }),
      "ui",
    );
  });

  it("apply calls setColumnFilterModel with ui source", () => {
    const setColumnFilterModel = vi.fn();
    const close = vi.fn();
    const contrib = makeFilterContrib({
      setColumnFilterModel,
      getFilterConfig: () => textConfig,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "name", column: { field: "name", filterable: true }, close }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const valueInput = host.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    valueInput.value = "test";

    const applyBtn = host.querySelector("button.lfg-filter-form-apply") as HTMLButtonElement;
    applyBtn.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        type: "text",
        operator: "and",
        conditions: [{ operator: "contains", value: "test" }],
      }),
      "ui",
    );
    expect(close).toHaveBeenCalled();
  });

  it("clear calls clearColumnFilter with ui source", () => {
    const clearColumnFilter = vi.fn();
    const close = vi.fn();
    const contrib = makeFilterContrib({
      getColumnFilterModel: () => activeTextModel,
      clearColumnFilter,
      getFilterConfig: () => textConfig,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "name", column: { field: "name", filterable: true }, close }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const clearFormBtn = host.querySelector("button.lfg-filter-form-clear") as HTMLButtonElement;
    clearFormBtn.click();

    expect(clearColumnFilter).toHaveBeenCalledWith("name", "ui");
    expect(close).toHaveBeenCalled();
  });

  it("clear menu item calls clearColumnFilter with ui source", () => {
    const clearColumnFilter = vi.fn();
    const close = vi.fn();
    const contrib = makeFilterContrib({
      getColumnFilterModel: () => activeTextModel,
      clearColumnFilter,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "name", column: { field: "name", filterable: true }, close }),
    );

    const clearItem = sections[0]!.items.find((i) => i.id === "filter-clear")!;
    expect(clearItem.hidden).toBeFalsy();
    clearItem.action!();
    expect(close).toHaveBeenCalled();
    expect(clearColumnFilter).toHaveBeenCalledWith("name", "ui");
  });

  it("hides clear menu item when column has no active filter", () => {
    const contrib = makeFilterContrib();
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    const clearItem = sections[0]!.items.find((i) => i.id === "filter-clear")!;
    expect(clearItem.hidden).toBe(true);
  });

  it("no-value operators hide value input", () => {
    const contrib = makeFilterContrib({ getFilterConfig: () => textConfig });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const select = host.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    const valueInput = host.querySelector("input.lfg-filter-form-value") as HTMLInputElement;

    // Select "isEmpty" (no-value operator)
    select.value = "isEmpty";
    select.dispatchEvent(new Event("change"));

    expect(valueInput.hidden).toBe(true);
  });

  it("between operator shows valueTo input", () => {
    const contrib = makeFilterContrib({ getFilterConfig: () => numberConfig });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const select = host.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    const valueToInput = host.querySelector("input.lfg-filter-form-value-to") as HTMLInputElement;

    // Initially hidden (default operator is "equals")
    expect(valueToInput.hidden).toBe(true);

    // Select "between"
    select.value = "between";
    select.dispatchEvent(new Event("change"));

    expect(valueToInput.hidden).toBe(false);
  });

  it("filter form does not render for unfilterable columns", () => {
    const contrib = makeFilterContrib();
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: false } }),
    );

    expect(sections).toHaveLength(0);
  });

  it("hides filter section when columnMenu is provided but filter is omitted", () => {
    const contrib = makeFilterContrib({
      getOptions: () => ({ sort: true }),
    });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );
    expect(sections).toHaveLength(0);
  });

  it("filter object acts as explicit allow-list", () => {
    const contrib = makeFilterContrib({
      getOptions: () => ({ filter: { clear: true } }),
    });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items.map((i) => i.id)).toEqual(["filter-clear"]);
  });

  it("render-only section (all items hidden) is treated as visible content", () => {
    const contrib = makeFilterContrib({ getFilterConfig: () => textConfig });
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    expect(sections).toHaveLength(1);
    const section = sections[0]!;
    const allItemsHidden = section.items.every((i) => i.hidden);
    expect(allItemsHidden).toBe(true);
    expect(typeof section.render).toBe("function");
  });

  it("section has no render when getFilterConfig is not provided", () => {
    const contrib = makeFilterContrib();
    const sections = contrib.getSections(
      makeCtx({ column: { field: "a", filterable: true } }),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0]!.render).toBeUndefined();
  });

  it("between apply sends both values for number", () => {
    const setColumnFilterModel = vi.fn();
    const close = vi.fn();
    const contrib = makeFilterContrib({
      setColumnFilterModel,
      getFilterConfig: () => numberConfig,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "age", column: { field: "age", filterable: true }, close }),
    );

    const host = document.createElement("div");
    sections[0]!.render!(host);

    const select = host.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    select.value = "between";
    select.dispatchEvent(new Event("change"));

    const valueInput = host.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    const valueToInput = host.querySelector("input.lfg-filter-form-value-to") as HTMLInputElement;
    valueInput.value = "10";
    valueToInput.value = "20";

    const applyBtn = host.querySelector("button.lfg-filter-form-apply") as HTMLButtonElement;
    applyBtn.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "age",
      expect.objectContaining({
        type: "number",
        conditions: [{ operator: "between", value: 10, valueTo: 20 }],
      }),
      "ui",
    );
  });
});

describe("filterMenuContribution two-condition UI", () => {
  function makeFilterContrib(
    overrides: Partial<Parameters<typeof filterMenuContribution>[0]> = {},
  ) {
    return filterMenuContribution({
      getColumnFilterModel: () => null,
      setColumnFilterModel: vi.fn(),
      clearColumnFilter: vi.fn(),
      ...overrides,
    });
  }

  const textConfig = {
    type: "text" as const,
    defaultOperator: "contains" as const,
    caseSensitive: false,
    trimInput: true,
  };

  const numberConfig = {
    type: "number" as const,
    defaultOperator: "equals" as const,
    caseSensitive: false,
    trimInput: true,
  };

  const boolConfig = {
    type: "boolean" as const,
    defaultOperator: "equals" as const,
    caseSensitive: false,
    trimInput: true,
  };

  function renderForm(opts: {
    config?: typeof textConfig | typeof numberConfig | typeof boolConfig;
    currentModel?: Parameters<typeof filterMenuContribution>[0]["getColumnFilterModel"] extends (f: string) => infer R ? R : never;
    setColumnFilterModel?: ReturnType<typeof vi.fn>;
    clearColumnFilter?: ReturnType<typeof vi.fn>;
  } = {}) {
    const setColumnFilterModel = opts.setColumnFilterModel ?? vi.fn();
    const clearColumnFilter = opts.clearColumnFilter ?? vi.fn();
    const close = vi.fn();
    const config = opts.config ?? textConfig;
    const contrib = makeFilterContrib({
      getFilterConfig: () => config,
      getColumnFilterModel: () => opts.currentModel ?? null,
      setColumnFilterModel,
      clearColumnFilter,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "name", column: { field: "name", filterable: true }, close }),
    );
    const host = document.createElement("div");
    sections[0]!.render!(host);
    return { host, setColumnFilterModel, clearColumnFilter, close };
  }

  it("renders two condition rows and AND/OR join selector", () => {
    const { host } = renderForm();

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");
    expect(condRows).toHaveLength(2);

    const joinRow = host.querySelector(".lfg-filter-join-row");
    expect(joinRow).not.toBeNull();

    const radios = joinRow!.querySelectorAll("input[type=radio]");
    expect(radios).toHaveLength(2);
    expect((radios[0] as HTMLInputElement).value).toBe("and");
    expect((radios[1] as HTMLInputElement).value).toBe("or");
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
  });

  it("applies two text conditions with AND", () => {
    const { host, setColumnFilterModel, close } = renderForm();

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");

    // Condition 1: contains "hello"
    const val1 = condRows[0]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val1.value = "hello";

    // Condition 2: startsWith "world"
    const op2 = condRows[1]!.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    op2.value = "startsWith";
    op2.dispatchEvent(new Event("change"));

    const val2 = condRows[1]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val2.value = "world";
    val2.dispatchEvent(new Event("input", { bubbles: true }));

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        type: "text",
        operator: "and",
        conditions: [
          { operator: "contains", value: "hello" },
          { operator: "startsWith", value: "world" },
        ],
      }),
      "ui",
    );
    expect(close).toHaveBeenCalled();
  });

  it("applies two text conditions with OR", () => {
    const { host, setColumnFilterModel } = renderForm();

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");

    const val1 = condRows[0]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val1.value = "foo";

    const op2 = condRows[1]!.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    op2.value = "contains";
    op2.dispatchEvent(new Event("change"));

    const val2 = condRows[1]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val2.value = "bar";
    val2.dispatchEvent(new Event("input", { bubbles: true }));

    const orRadio = host.querySelector("input[type=radio][value=or]") as HTMLInputElement;
    orRadio.checked = true;

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        operator: "or",
        conditions: [
          { operator: "contains", value: "foo" },
          { operator: "contains", value: "bar" },
        ],
      }),
      "ui",
    );
  });

  it("existing two-condition model hydrates both conditions and join selector", () => {
    const currentModel = {
      type: "text" as const,
      operator: "or" as const,
      conditions: [
        { operator: "contains" as const, value: "alpha" },
        { operator: "endsWith" as const, value: "beta" },
      ],
    };
    const { host } = renderForm({ currentModel });

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");

    const op1 = condRows[0]!.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    expect(op1.value).toBe("contains");
    const val1 = condRows[0]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    expect(val1.value).toBe("alpha");

    const op2 = condRows[1]!.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    expect(op2.value).toBe("endsWith");
    const val2 = condRows[1]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    expect(val2.value).toBe("beta");

    const orRadio = host.querySelector("input[type=radio][value=or]") as HTMLInputElement;
    expect(orRadio.checked).toBe(true);
  });

  it("blank second condition is not applied", () => {
    const { host, setColumnFilterModel } = renderForm();

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");
    const val1 = condRows[0]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val1.value = "test";

    // second condition left blank, not touched
    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        operator: "and",
        conditions: [{ operator: "contains", value: "test" }],
      }),
      "ui",
    );
  });

  it("between operator in second condition still works", () => {
    const { host, setColumnFilterModel } = renderForm({ config: numberConfig });

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");

    const val1 = condRows[0]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val1.value = "5";

    const op2 = condRows[1]!.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    op2.value = "between";
    op2.dispatchEvent(new Event("change"));

    const val2 = condRows[1]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val2.value = "10";
    val2.dispatchEvent(new Event("input", { bubbles: true }));

    const valTo2 = condRows[1]!.querySelector("input.lfg-filter-form-value-to") as HTMLInputElement;
    valTo2.value = "20";
    valTo2.dispatchEvent(new Event("input", { bubbles: true }));

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        conditions: [
          { operator: "equals", value: 5 },
          { operator: "between", value: 10, valueTo: 20 },
        ],
      }),
      "ui",
    );
  });

  it("no-value operator in second condition applies when touched", () => {
    const { host, setColumnFilterModel } = renderForm();

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");

    const val1 = condRows[0]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val1.value = "hello";

    const op2 = condRows[1]!.querySelector("select.lfg-filter-form-operator") as HTMLSelectElement;
    op2.value = "isEmpty";
    op2.dispatchEvent(new Event("change", { bubbles: true }));

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        conditions: [
          { operator: "contains", value: "hello" },
          { operator: "isEmpty" },
        ],
      }),
      "ui",
    );
  });

  it("boolean second condition does not accidentally apply by default", () => {
    const { host, setColumnFilterModel } = renderForm({ config: boolConfig });

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");

    // First condition: user selects "true"
    const val1 = condRows[0]!.querySelector("select.lfg-filter-form-value") as HTMLSelectElement;
    val1.value = "true";

    // Second condition NOT touched
    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        conditions: [{ operator: "equals", value: true }],
      }),
      "ui",
    );
    // Only one condition — second boolean was not touched
    const call = setColumnFilterModel.mock.calls[0]!;
    expect(call[1].conditions).toHaveLength(1);
  });
});

describe("filterMenuContribution selection UI", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function makeFilterContrib(
    overrides: Partial<Parameters<typeof filterMenuContribution>[0]> = {},
  ) {
    return filterMenuContribution({
      getColumnFilterModel: () => null,
      setColumnFilterModel: vi.fn(),
      clearColumnFilter: vi.fn(),
      ...overrides,
    });
  }

  const textConfig = {
    type: "text" as const,
    defaultOperator: "contains" as const,
    caseSensitive: false,
    trimInput: true,
  };

  function renderForm(
    contribOptions: Partial<Parameters<typeof filterMenuContribution>[0]>,
    ctxOverrides: Partial<ColumnMenuContext> = {},
  ) {
    const setColumnFilterModel = vi.fn(contribOptions.setColumnFilterModel ?? (() => {}));
    const clearColumnFilter = vi.fn(contribOptions.clearColumnFilter ?? (() => {}));
    const close = vi.fn();
    const contrib = makeFilterContrib({
      ...contribOptions,
      setColumnFilterModel,
      clearColumnFilter,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "name", column: { field: "name", filterable: true }, close, ...ctxOverrides }),
    );
    const host = document.createElement("div");
    sections[0]!.render!(host);
    return { host, setColumnFilterModel, clearColumnFilter, close };
  }

  function makeSelectionValues() {
    const rows = Array.from({ length: 300 }, (_, i) => ({ name: `val_${String(i).padStart(3, "0")}` }));
    return (args: { field: string; searchText?: string; maxValues?: number }) => {
      let values = rows.map((r, rowIndex) => {
        const v = r.name;
        return { key: v.toLowerCase(), value: v, label: v, count: 1, sampleRowIndex: rowIndex };
      });
      if (args.searchText) {
        const needle = args.searchText.toLowerCase();
        values = values.filter((sv) => sv.label.toLowerCase().includes(needle));
      }
      const totalDistinct = values.length;
      const limit = args.maxValues && args.maxValues > 0 ? args.maxValues : undefined;
      const truncated = limit !== undefined && totalDistinct > limit;
      if (limit && truncated) values = values.slice(0, limit);
      return { values, totalDistinct, scannedRowCount: rows.length, truncated };
    };
  }

  it("only one Apply and one Clear button in the form", () => {
    const getSelectionValues = makeSelectionValues();
    const { host } = renderForm({
      getFilterConfig: () => textConfig,
      getSelectionValues,
    });

    const applyBtns = host.querySelectorAll("button.lfg-filter-form-apply");
    const clearBtns = host.querySelectorAll("button.lfg-filter-form-clear");
    expect(applyBtns).toHaveLength(1);
    expect(clearBtns).toHaveLength(1);
  });

  it("searched value outside capped page is applied correctly", () => {
    const getSelectionValues = makeSelectionValues();
    const { host, setColumnFilterModel, close } = renderForm({
      getFilterConfig: () => textConfig,
      getSelectionValues,
    });

    const list = host.querySelector(".lfg-filter-selection-list")!;
    expect(list.children.length).toBe(200);

    const searchInput = host.querySelector("input.lfg-filter-selection-search") as HTMLInputElement;
    searchInput.value = "val_250";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(200);

    const checkboxes = list.querySelectorAll("input[type=checkbox]") as NodeListOf<HTMLInputElement>;
    expect(checkboxes.length).toBe(1);
    checkboxes[0]!.checked = true;
    checkboxes[0]!.dispatchEvent(new Event("change", { bubbles: true }));

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        type: "text",
        operator: "and",
        conditions: [],
        selection: { operator: "in", values: ["val_250"] },
      }),
      "ui",
    );
    expect(close).toHaveBeenCalled();
  });

  it("active selection values are pre-checked and re-applied", () => {
    const getSelectionValues = makeSelectionValues();
    const activeModel = {
      type: "text" as const,
      operator: "and" as const,
      conditions: [] as [],
      selection: { operator: "in" as const, values: ["val_001", "val_003"] },
    };
    const { host, setColumnFilterModel, close } = renderForm({
      getFilterConfig: () => textConfig,
      getSelectionValues,
      getColumnFilterModel: () => activeModel,
    });

    const list = host.querySelector(".lfg-filter-selection-list")!;
    const items = list.querySelectorAll("[data-sel-key]");
    const cb001 = items[1]!.querySelector("input[type=checkbox]") as HTMLInputElement;
    const cb003 = items[3]!.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(cb001.checked).toBe(true);
    expect(cb003.checked).toBe(true);

    const cb000 = items[0]!.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(cb000.checked).toBe(false);

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        conditions: [],
        selection: { operator: "in", values: ["val_001", "val_003"] },
      }),
      "ui",
    );
    expect(close).toHaveBeenCalled();
  });

  it("clear clears column filter and closes", () => {
    const getSelectionValues = makeSelectionValues();
    const { host, clearColumnFilter, close } = renderForm({
      getFilterConfig: () => textConfig,
      getSelectionValues,
    });

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-clear")!.click();

    expect(clearColumnFilter).toHaveBeenCalledWith("name", "ui");
    expect(close).toHaveBeenCalled();
  });

  it("apply with no checked values and no typed conditions clears column filter", () => {
    const getSelectionValues = makeSelectionValues();
    const { host, clearColumnFilter, close } = renderForm({
      getFilterConfig: () => textConfig,
      getSelectionValues,
    });

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(clearColumnFilter).toHaveBeenCalledWith("name", "ui");
    expect(close).toHaveBeenCalled();
  });

  it("selection section not rendered when getSelectionValues is not provided", () => {
    const { host } = renderForm({
      getFilterConfig: () => textConfig,
    });

    expect(host.querySelector(".lfg-filter-selection-list")).toBeNull();
  });

  it("checkbox toggle does not call getSelectionValues again", () => {
    const inner = makeSelectionValues();
    let callCount = 0;
    const getSelectionValues = (args: Parameters<typeof inner>[0]) => {
      callCount++;
      return inner(args);
    };
    const { host } = renderForm({
      getFilterConfig: () => textConfig,
      getSelectionValues,
    });

    const countAfterRender = callCount;
    expect(countAfterRender).toBe(1);

    const list = host.querySelector(".lfg-filter-selection-list")!;
    const cb = list.querySelector("input[type=checkbox]") as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));

    expect(callCount).toBe(countAfterRender);
  });

  it("typed condition and selection compose together", () => {
    const getSelectionValues = makeSelectionValues();
    const { host, setColumnFilterModel } = renderForm({
      getFilterConfig: () => textConfig,
      getSelectionValues,
    });

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");
    const val1 = condRows[0]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val1.value = "typed value";

    const list = host.querySelector(".lfg-filter-selection-list")!;
    const cb = list.querySelector("input[type=checkbox]") as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        conditions: [{ operator: "contains", value: "typed value" }],
        selection: { operator: "in", values: expect.any(Array) },
      }),
      "ui",
    );
  });

  it("typed condition applied when no selection checked", () => {
    const getSelectionValues = makeSelectionValues();
    const { host, setColumnFilterModel } = renderForm({
      getFilterConfig: () => textConfig,
      getSelectionValues,
    });

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");
    const val1 = condRows[0]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val1.value = "hello";

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        conditions: [{ operator: "contains", value: "hello" }],
      }),
      "ui",
    );
  });

  it("clear resets selection draft checkboxes", () => {
    const getSelectionValues = makeSelectionValues();
    const { host } = renderForm({
      getFilterConfig: () => textConfig,
      getSelectionValues,
    });

    const list = host.querySelector(".lfg-filter-selection-list")!;
    const cb = list.querySelector("input[type=checkbox]") as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));

    expect(cb.checked).toBe(true);

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-clear")!.click();

    const cbs = list.querySelectorAll("input[type=checkbox]") as NodeListOf<HTMLInputElement>;
    for (let i = 0; i < cbs.length; i++) {
      expect(cbs[i]!.checked).toBe(false);
    }
  });
});

describe("ColumnMenuFilterOptions.selectionList toggle", () => {
  const textConfig = {
    type: "text" as const,
    defaultOperator: "contains" as const,
    caseSensitive: false,
    trimInput: true,
  };

  function makeSelectionValues() {
    return vi.fn((_args: { field: string; searchText?: string; maxValues?: number }) => ({
      values: [
        { key: "alice", value: "Alice", label: "Alice", count: 1, sampleRowIndex: 0 },
        { key: "bob", value: "Bob", label: "Bob", count: 1, sampleRowIndex: 1 },
      ],
      totalDistinct: 2,
      scannedRowCount: 2,
      truncated: false,
    }));
  }

  function renderContribWithOptions(
    menuOptions: Record<string, unknown> | undefined,
    getSelectionValues?: ReturnType<typeof makeSelectionValues>,
  ) {
    const selValues = getSelectionValues ?? makeSelectionValues();
    const contrib = filterMenuContribution({
      getColumnFilterModel: () => null,
      setColumnFilterModel: vi.fn(),
      clearColumnFilter: vi.fn(),
      getFilterConfig: () => textConfig,
      getOptions: () => menuOptions as never,
      getSelectionValues: selValues,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "name", column: { field: "name", filterable: true } }),
    );
    const host = document.createElement("div");
    sections[0]!.render!(host);
    return { host, selValues };
  }

  it("main menu: renders selection list when filter.selectionList.enabled: true", () => {
    const { host } = renderContribWithOptions({
      filter: { enabled: true, placement: "mainMenu", selectionList: { enabled: true } },
    });
    expect(host.querySelector(".lfg-filter-selection-list")).not.toBeNull();
    expect(host.querySelector(".lfg-filter-condition-row")).not.toBeNull();
  });

  it("main menu: hides selection list when selectionList.enabled: false", () => {
    const { host } = renderContribWithOptions({
      filter: { enabled: true, placement: "mainMenu", selectionList: { enabled: false } },
    });
    expect(host.querySelector(".lfg-filter-selection-list")).toBeNull();
    expect(host.querySelector(".lfg-filter-selection-separator")).toBeNull();
    expect(host.querySelector(".lfg-filter-condition-row")).not.toBeNull();
    expect(host.querySelector("button.lfg-filter-form-apply")).not.toBeNull();
  });

  it("main menu: hides selection list when selectionList: false (shorthand)", () => {
    const { host } = renderContribWithOptions({ filter: { selectionList: false } });
    expect(host.querySelector(".lfg-filter-selection-list")).toBeNull();
    expect(host.querySelector(".lfg-filter-condition-row")).not.toBeNull();
  });

  it("main menu: renders selection list when filter: true (default)", () => {
    const { host } = renderContribWithOptions({ filter: true });
    expect(host.querySelector(".lfg-filter-selection-list")).not.toBeNull();
  });

  it("main menu: hides selection list when selectionList placement is dedicatedMenu only", () => {
    const { host, selValues } = renderContribWithOptions({
      filter: { enabled: true, placement: "both", selectionList: { enabled: true, placement: "dedicatedMenu" } },
    });
    expect(host.querySelector(".lfg-filter-selection-list")).toBeNull();
    expect(selValues).not.toHaveBeenCalled();
  });

  it("dedicated menu: hides selection list when selectionList.enabled: false", async () => {
    const { DedicatedFilterController } = await import("../../features/filters/DedicatedFilterController");
    const selValues = makeSelectionValues();
    const menuOptions = {
      filter: { enabled: true, placement: "both", selectionList: { enabled: false } },
    };
    const gridRoot = document.createElement("div");
    const viewport = document.createElement("div");
    const ctrl = new DedicatedFilterController({
      gridRoot,
      viewport,
      getColumns: () => [{ field: "name", filterable: true }],
      getColumnFilterModel: () => null,
      setColumnFilterModel: vi.fn(),
      clearColumnFilter: vi.fn(),
      getFilterConfig: () => textConfig,
      getColumnMenuOptions: () => menuOptions as ColumnMenuOptions,
      getSelectionValues: selValues,
    });
    ctrl.attach(gridRoot);

    const trigger = document.createElement("button");
    trigger.className = "lfg-column-filter-trigger";
    trigger.setAttribute("data-col-id", "name");
    gridRoot.appendChild(trigger);
    trigger.click();

    expect(selValues).not.toHaveBeenCalled();
    ctrl.detach();
  });

  it("dedicated menu: shows selection list when selectionList is default", async () => {
    const { DedicatedFilterController } = await import("../../features/filters/DedicatedFilterController");
    const selValues = makeSelectionValues();
    const menuOptions = {
      filter: { enabled: true, placement: "both" },
    };
    const gridRoot = document.createElement("div");
    const viewport = document.createElement("div");
    const ctrl = new DedicatedFilterController({
      gridRoot,
      viewport,
      getColumns: () => [{ field: "name", filterable: true }],
      getColumnFilterModel: () => null,
      setColumnFilterModel: vi.fn(),
      clearColumnFilter: vi.fn(),
      getFilterConfig: () => textConfig,
      getColumnMenuOptions: () => menuOptions as ColumnMenuOptions,
      getSelectionValues: selValues,
    });
    ctrl.attach(gridRoot);

    const trigger = document.createElement("button");
    trigger.className = "lfg-column-filter-trigger";
    trigger.setAttribute("data-col-id", "name");
    gridRoot.appendChild(trigger);
    trigger.click();

    expect(selValues).toHaveBeenCalled();
    ctrl.detach();
  });

  it("dedicated menu: hides selection list when selectionList placement is mainMenu only", async () => {
    const { DedicatedFilterController } = await import("../../features/filters/DedicatedFilterController");
    const selValues = makeSelectionValues();
    const menuOptions = {
      filter: { enabled: true, placement: "both", selectionList: { enabled: true, placement: "mainMenu" } },
    };
    const gridRoot = document.createElement("div");
    const viewport = document.createElement("div");
    const ctrl = new DedicatedFilterController({
      gridRoot,
      viewport,
      getColumns: () => [{ field: "name", filterable: true }],
      getColumnFilterModel: () => null,
      setColumnFilterModel: vi.fn(),
      clearColumnFilter: vi.fn(),
      getFilterConfig: () => textConfig,
      getColumnMenuOptions: () => menuOptions as ColumnMenuOptions,
      getSelectionValues: selValues,
    });
    ctrl.attach(gridRoot);

    const trigger = document.createElement("button");
    trigger.className = "lfg-column-filter-trigger";
    trigger.setAttribute("data-col-id", "name");
    gridRoot.appendChild(trigger);
    trigger.click();

    expect(selValues).not.toHaveBeenCalled();
    ctrl.detach();
  });
});

describe("split placement: condition and selectionList in different menus", () => {
  const textConfig = {
    type: "text" as const,
    defaultOperator: "contains" as const,
    caseSensitive: false,
    trimInput: true,
  };

  function makeSelectionValues() {
    return vi.fn((_args: { field: string; searchText?: string; maxValues?: number }) => ({
      values: [
        { key: "alice", value: "Alice", label: "Alice", count: 1, sampleRowIndex: 0 },
        { key: "bob", value: "Bob", label: "Bob", count: 1, sampleRowIndex: 1 },
      ],
      totalDistinct: 2,
      scannedRowCount: 2,
      truncated: false,
    }));
  }

  function renderContribWithOptions(
    menuOptions: Record<string, unknown>,
  ) {
    const selValues = makeSelectionValues();
    const setColumnFilterModel = vi.fn();
    const clearColumnFilter = vi.fn();
    const close = vi.fn();
    const contrib = filterMenuContribution({
      getColumnFilterModel: () => null,
      setColumnFilterModel,
      clearColumnFilter,
      getFilterConfig: () => textConfig,
      getOptions: () => menuOptions as never,
      getSelectionValues: selValues,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "name", column: { field: "name", filterable: true }, close }),
    );
    if (sections.length === 0) return { host: null, selValues, setColumnFilterModel, clearColumnFilter, close };
    const host = document.createElement("div");
    sections[0]!.render!(host);
    return { host, selValues, setColumnFilterModel, clearColumnFilter, close };
  }

  async function clickDedicatedTrigger(
    menuOptions: Record<string, unknown>,
    opts?: { currentModel?: unknown },
  ) {
    const { DedicatedFilterController } = await import("../../features/filters/DedicatedFilterController");
    const selValues = makeSelectionValues();
    const setColumnFilterModel = vi.fn();
    const clearColumnFilter = vi.fn();
    const gridRoot = document.createElement("div");
    const viewport = document.createElement("div");
    const ctrl = new DedicatedFilterController({
      gridRoot,
      viewport,
      getColumns: () => [{ field: "name", filterable: true }],
      getColumnFilterModel: () => (opts?.currentModel ?? null) as ColumnFilterModel | null,
      setColumnFilterModel,
      clearColumnFilter,
      getFilterConfig: () => textConfig,
      getColumnMenuOptions: () => menuOptions as ColumnMenuOptions,
      getSelectionValues: selValues,
    });
    ctrl.attach(gridRoot);

    const trigger = document.createElement("button");
    trigger.className = "lfg-column-filter-trigger";
    trigger.setAttribute("data-col-id", "name");
    gridRoot.appendChild(trigger);
    trigger.click();

    const panel = gridRoot.querySelector(".lfg-column-filter-panel");
    return { ctrl, panel, selValues, setColumnFilterModel, clearColumnFilter, gridRoot };
  }

  describe("filter.placement: dedicatedMenu + selectionList.placement: mainMenu", () => {
    const menuOptions = {
      filter: {
        enabled: true,
        placement: "dedicatedMenu",
        selectionList: { enabled: true, placement: "mainMenu" },
      },
    };

    it("main menu renders selection list only, no condition rows", () => {
      const { host, selValues } = renderContribWithOptions(menuOptions);
      expect(host).not.toBeNull();
      expect(host!.querySelector(".lfg-filter-condition-row")).toBeNull();
      expect(host!.querySelector(".lfg-filter-join-row")).toBeNull();
      expect(host!.querySelector(".lfg-filter-selection-list")).not.toBeNull();
      expect(selValues).toHaveBeenCalled();
    });

    it("dedicated menu renders condition rows only, no selection list", async () => {
      const { panel, selValues, ctrl } = await clickDedicatedTrigger(menuOptions);
      expect(panel).not.toBeNull();
      expect(panel!.querySelector(".lfg-filter-condition-row")).not.toBeNull();
      expect(panel!.querySelector(".lfg-filter-selection-list")).toBeNull();
      expect(selValues).not.toHaveBeenCalled();
      ctrl.detach();
    });
  });

  describe("filter.placement: mainMenu + selectionList.placement: dedicatedMenu", () => {
    const menuOptions = {
      filter: {
        enabled: true,
        placement: "mainMenu",
        selectionList: { enabled: true, placement: "dedicatedMenu" },
      },
    };

    it("main menu renders condition rows only", () => {
      const { host, selValues } = renderContribWithOptions(menuOptions);
      expect(host).not.toBeNull();
      expect(host!.querySelector(".lfg-filter-condition-row")).not.toBeNull();
      expect(host!.querySelector(".lfg-filter-selection-list")).toBeNull();
      expect(selValues).not.toHaveBeenCalled();
    });

    it("dedicated menu renders selection list only", async () => {
      const { panel, selValues, ctrl } = await clickDedicatedTrigger(menuOptions);
      expect(panel).not.toBeNull();
      expect(panel!.querySelector(".lfg-filter-condition-row")).toBeNull();
      expect(panel!.querySelector(".lfg-filter-selection-list")).not.toBeNull();
      expect(selValues).toHaveBeenCalled();
      ctrl.detach();
    });
  });

  it("selection-only apply preserves existing typed conditions", () => {
    const existingModel = {
      type: "text" as const,
      operator: "and" as const,
      conditions: [{ operator: "contains" as const, value: "existing" }],
      selection: { operator: "in" as const, values: ["old"] },
    };
    const selValues = makeSelectionValues();
    const setColumnFilterModel = vi.fn();
    const close = vi.fn();
    const contrib = filterMenuContribution({
      getColumnFilterModel: () => existingModel,
      setColumnFilterModel,
      clearColumnFilter: vi.fn(),
      getFilterConfig: () => textConfig,
      getOptions: () => ({
        filter: {
          enabled: true,
          placement: "dedicatedMenu",
          selectionList: { enabled: true, placement: "mainMenu" },
        },
      }),
      getSelectionValues: selValues,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "name", column: { field: "name", filterable: true }, close }),
    );
    const host = document.createElement("div");
    sections[0]!.render!(host);

    const list = host.querySelector(".lfg-filter-selection-list")!;
    const cb = list.querySelector("input[type=checkbox]") as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        conditions: [{ operator: "contains", value: "existing" }],
        selection: { operator: "in", values: expect.any(Array) },
      }),
      "ui",
    );
  });

  it("condition-only apply preserves existing selection", () => {
    const existingModel = {
      type: "text" as const,
      operator: "and" as const,
      conditions: [{ operator: "contains" as const, value: "old" }],
      selection: { operator: "in" as const, values: ["Alice"] },
    };
    const selValues = makeSelectionValues();
    const setColumnFilterModel = vi.fn();
    const close = vi.fn();
    const contrib = filterMenuContribution({
      getColumnFilterModel: () => existingModel,
      setColumnFilterModel,
      clearColumnFilter: vi.fn(),
      getFilterConfig: () => textConfig,
      getOptions: () => ({
        filter: {
          enabled: true,
          placement: "mainMenu",
          selectionList: { enabled: true, placement: "dedicatedMenu" },
        },
      }),
      getSelectionValues: selValues,
    });
    const sections = contrib.getSections(
      makeCtx({ field: "name", column: { field: "name", filterable: true }, close }),
    );
    const host = document.createElement("div");
    sections[0]!.render!(host);

    const condRows = host.querySelectorAll(".lfg-filter-condition-row");
    const val1 = condRows[0]!.querySelector("input.lfg-filter-form-value") as HTMLInputElement;
    val1.value = "updated";

    host.querySelector<HTMLButtonElement>("button.lfg-filter-form-apply")!.click();

    expect(setColumnFilterModel).toHaveBeenCalledWith(
      "name",
      expect.objectContaining({
        conditions: [{ operator: "contains", value: "updated" }],
        selection: { operator: "in", values: ["Alice"] },
      }),
      "ui",
    );
  });

  it("selectionList.placement omitted inherits filter.placement", async () => {
    const menuOptions = {
      filter: { enabled: true, placement: "dedicatedMenu", selectionList: { enabled: true } },
    };
    const { host, selValues } = renderContribWithOptions(menuOptions);
    expect(host).toBeNull();
    expect(selValues).not.toHaveBeenCalled();

    const { panel, selValues: dedSelValues, ctrl } = await clickDedicatedTrigger(menuOptions);
    expect(panel).not.toBeNull();
    expect(panel!.querySelector(".lfg-filter-condition-row")).not.toBeNull();
    expect(panel!.querySelector(".lfg-filter-selection-list")).not.toBeNull();
    expect(dedSelValues).toHaveBeenCalled();
    ctrl.detach();
  });

  it("filter.enabled: false disables both condition and selection UI", () => {
    const menuOptions = {
      filter: { enabled: false, placement: "both", selectionList: { enabled: true } },
    };
    const { host } = renderContribWithOptions(menuOptions);
    expect(host).toBeNull();
  });

  it("selectionList.enabled: false disables selection UI in both placements", async () => {
    const menuOptions = {
      filter: { enabled: true, placement: "both", selectionList: { enabled: false } },
    };
    const { host, selValues: mainSelValues } = renderContribWithOptions(menuOptions);
    expect(host).not.toBeNull();
    expect(host!.querySelector(".lfg-filter-condition-row")).not.toBeNull();
    expect(host!.querySelector(".lfg-filter-selection-list")).toBeNull();
    expect(mainSelValues).not.toHaveBeenCalled();

    const { panel, selValues: dedSelValues, ctrl } = await clickDedicatedTrigger(menuOptions);
    expect(panel).not.toBeNull();
    expect(panel!.querySelector(".lfg-filter-condition-row")).not.toBeNull();
    expect(panel!.querySelector(".lfg-filter-selection-list")).toBeNull();
    expect(dedSelValues).not.toHaveBeenCalled();
    ctrl.detach();
  });
});

describe("ColumnMenuController uses contributions only", () => {
  it("does not have buildSortSection or buildPinSection methods", () => {
    const controller = new ColumnMenuController({
      gridRoot: document.createElement("div"),
      viewport: document.createElement("div"),
      getColumns: () => [],
      getSortModel: () => [],
      contributions: [],
    });

    expect((controller as unknown as Record<string, unknown>)["buildSortSection"]).toBeUndefined();
    expect((controller as unknown as Record<string, unknown>)["buildPinSection"]).toBeUndefined();
    expect((controller as unknown as Record<string, unknown>)["buildVisibilitySection"]).toBeUndefined();

    controller.detach();
  });
});

describe("filter / column-menu architecture boundary", () => {
  it("columnMenuFeature does not implement FilterIndicatorCapability", async () => {
    const { columnMenuFeature: cmf } = await import("../../features/column-menu/columnMenuFeature");
    const feature = cmf({
      getColumns: () => [],
      getSortModel: () => [],
      setColumnSort: vi.fn(),
      pinColumn: vi.fn(),
    });
    expect((feature as unknown as Record<string, unknown>)["syncFilterIndicatorState"]).toBeUndefined();
  });

  it("filterColumnMenuFeature implements FilterIndicatorCapability", async () => {
    const { filterColumnMenuFeature: fcmf } = await import("../../features/filters/filterColumnMenuFeature");
    const { createColumnMenuContributionRegistry } = await import("../../features/column-menu/columnMenuContributionRegistry");
    const registry = createColumnMenuContributionRegistry();
    const feature = fcmf({
      getColumns: () => [],
      getColumnFilterModel: () => null,
      setColumnFilterModel: vi.fn(),
      clearColumnFilter: vi.fn(),
      columnMenuContributions: registry,
    });
    expect(typeof feature.syncFilterIndicatorState).toBe("function");
    expect(feature.name).toBe("filter-column-menu");
  });

  it("filterColumnMenuFeature registers contributions via registry on attach", async () => {
    const { filterColumnMenuFeature: fcmf } = await import("../../features/filters/filterColumnMenuFeature");
    const { createColumnMenuContributionRegistry } = await import("../../features/column-menu/columnMenuContributionRegistry");
    const registry = createColumnMenuContributionRegistry();
    const feature = fcmf({
      getColumns: () => [],
      getColumnFilterModel: () => null,
      setColumnFilterModel: vi.fn(),
      clearColumnFilter: vi.fn(),
      columnMenuContributions: registry,
    });
    expect(registry.getAll()).toHaveLength(0);
    feature.attach({ root: document.createElement("div"), viewport: document.createElement("div") } as never);
    expect(registry.getAll().length).toBeGreaterThan(0);
    feature.detach();
    expect(registry.getAll()).toHaveLength(0);
  });

  it("BUILT_IN_FEATURE_FACTORIES includes filter-column-menu as a separate entry", async () => {
    const { BUILT_IN_FEATURE_FACTORIES } = await import("../../features/registry");
    const names = BUILT_IN_FEATURE_FACTORIES.map((f) => f.name);
    expect(names).toContain("filter-column-menu");
    expect(names).toContain("column-menu");
    expect(names.indexOf("filter-column-menu")).toBeLessThan(names.indexOf("column-menu"));
  });

  it("BUILT_IN_FEATURE_FACTORIES has real create functions, no null placeholders", async () => {
    const { BUILT_IN_FEATURE_FACTORIES } = await import("../../features/registry");
    for (const factory of BUILT_IN_FEATURE_FACTORIES) {
      expect(typeof factory.create).toBe("function");
      expect(factory.create.toString()).not.toContain("null!");
    }
  });
});
