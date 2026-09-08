// @vitest-environment jsdom
import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import type { DomGridFeatureContext } from "../../../internal/layoutTypes";
import { ROW_HEIGHT } from "../../../rendering/helpers/gridConstants";
import type {
  ColumnDef,
  ColumnFilterModel,
  NormalizedColumnFilterConfig,
} from "../../../types";
import type { FloatingFilterControllerOptions } from "../FloatingFilterController";
import { floatingFilterFeature } from "../FloatingFilterController";

const TEXT_FILTER: NormalizedColumnFilterConfig = {
  type: "text",
  defaultOperator: "contains",
  caseSensitive: false,
  trimInput: true,
};

const NUMBER_FILTER: NormalizedColumnFilterConfig = {
  type: "number",
  defaultOperator: "equals",
  caseSensitive: false,
  trimInput: true,
};

const BOOLEAN_FILTER: NormalizedColumnFilterConfig = {
  type: "boolean",
  defaultOperator: "equals",
  caseSensitive: false,
  trimInput: false,
};

const DATE_FILTER: NormalizedColumnFilterConfig = {
  type: "date",
  defaultOperator: "equals",
  caseSensitive: false,
  trimInput: false,
};

function makeColumns(...fields: string[]): ColumnDef[] {
  return fields.map((field) => ({ field, headerName: field }));
}

function makeDateRangeColumns(...fields: string[]): ColumnDef[] {
  return fields.map((field) => ({
    field,
    headerName: field,
    floatingFilter: { control: "dateRange", menuButton: false },
  }));
}

function makeCtx(
  root: HTMLElement,
  columns: ColumnDef[],
): DomGridFeatureContext {
  const header = document.createElement("div");
  header.className = "lfg-header";
  root.appendChild(header);
  const headerRow = document.createElement("div");
  headerRow.className = "lfg-header-row";
  header.appendChild(headerRow);

  return {
    root,
    surface: root,
    viewport: root,
    getPool: () => [],
    getColumns: () => columns,
    getDisplayRows: () => ({ rowCount: 0, getRow: () => null, getRowData: () => undefined, getSourceIndex: () => -1 }),
    getSourceRows: () => [],
    getVisibleRowStart: () => 0,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    resolveRowId: (_row, idx) => String(idx),
    getHeaderRowEl: () => headerRow,
    getPinnedHeaderRowEl: () => null,
    getPinnedRightHeaderRowEl: () => null,
    getHeaderLaneRefs: () => ({
      center: { container: header, leafRow: headerRow },
      left: null,
      right: null,
    }),
    getColumnGroupHeaders: () => undefined,
    getDataRevision: () => 1,
    getSelectedColumnIdsForColumnOrder: () => [],
    getSelectedRowCountForRowOrder: () => 0,
    isRowSelectedForRowOrder: () => false,
    getSelectedRowIdsForRowOrder: () => [],
    getSortModel: () => [],
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
  };
}

function makeOptions(
  columns: ColumnDef[],
  overrides?: Partial<FloatingFilterControllerOptions>,
): FloatingFilterControllerOptions {
  const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
  for (const col of columns) {
    filterConfigs.set(col.field, TEXT_FILTER);
  }
  const models = new Map<string, ColumnFilterModel | null>();
  return {
    getColumns: () => columns,
    getFloatingFiltersOption: () => true,
    getColumnFilterModel: (field) => models.get(field) ?? null,
    setColumnFilterModel: (field, model) => models.set(field, model),
    clearColumnFilter: (field) => models.delete(field),
    getFilterConfig: (field) => filterConfigs.get(field) ?? null,
    ...overrides,
  };
}

describe("FloatingFilterController", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  // ── Basic rendering ─────────────────────────────────────────────────

  it("renders floating filter row below header when enabled", () => {
    const columns = makeColumns("name", "age");
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const row = root.querySelector(".lfg-floating-filter-row");
    expect(row).not.toBeNull();
    const cells = row!.querySelectorAll(".lfg-floating-filter-cell");
    expect(cells.length).toBe(2);

    feature.detach();
  });

  it("does not render when globally disabled", () => {
    const columns = makeColumns("name");
    const opts = makeOptions(columns, { getFloatingFiltersOption: () => false });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    expect(root.querySelector(".lfg-floating-filter-row")).toBeNull();
    feature.detach();
  });

  // ── Text control ────────────────────────────────────────────────────

  it("renders text input for text filter type", () => {
    const columns = makeColumns("name");
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input");
    expect(input).not.toBeNull();
    expect(input!.type).toBe("text");
    expect(input!.placeholder).toBe("Search...");
    expect(input!.getAttribute("aria-label")).toBe("Filter name");

    feature.detach();
  });

  it("text input uses custom placeholder from config", () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name", floatingFilter: { placeholder: "Filter name..." } },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(input.placeholder).toBe("Filter name...");

    feature.detach();
  });

  it("applies filter on Enter key for text input", () => {
    const columns = makeColumns("name");
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.value = "hello";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "name",
      {
        type: "text",
        conditions: [{ operator: "contains", value: "hello" }],
      },
      "ui",
    );

    feature.detach();
  });

  it("clears filter when input is emptied", () => {
    const columns = makeColumns("name");
    const clearFilter = vi.fn();
    const opts = makeOptions(columns, { clearColumnFilter: clearFilter });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.value = "";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(clearFilter).toHaveBeenCalledWith("name", "ui");

    feature.detach();
  });

  it("reverts input on Escape", () => {
    const columns = makeColumns("name");
    const models = new Map<string, ColumnFilterModel | null>();
    models.set("name", {
      type: "text",
      conditions: [{ operator: "contains", value: "existing" }],
    });
    const opts = makeOptions(columns, {
      getColumnFilterModel: (field) => models.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.value = "new value";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(input.value).toBe("existing");

    feature.detach();
  });

  // ── Number range control ────────────────────────────────────────────

  it("renders Min/Max inputs for number filter type", () => {
    const columns = makeColumns("age");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const wrapper = root.querySelector(".lfg-floating-filter-range");
    expect(wrapper).not.toBeNull();
    const inputs = wrapper!.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-input");
    expect(inputs.length).toBe(2);
    expect(inputs[0]!.type).toBe("number");
    expect(inputs[0]!.placeholder).toBe("Min");
    expect(inputs[0]!.getAttribute("aria-label")).toBe("Minimum age filter");
    expect(inputs[1]!.type).toBe("number");
    expect(inputs[1]!.placeholder).toBe("Max");
    expect(inputs[1]!.getAttribute("aria-label")).toBe("Maximum age filter");

    feature.detach();
  });

  it("number range min-only applies gte operator", () => {
    const columns = makeColumns("age");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    inputs[0]!.value = "10";
    inputs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "age",
      { type: "number", conditions: [{ operator: "gte", value: 10 }] },
      "ui",
    );

    feature.detach();
  });

  it("number range max-only applies lte operator", () => {
    const columns = makeColumns("age");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    inputs[1]!.value = "50";
    inputs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "age",
      { type: "number", conditions: [{ operator: "lte", value: 50 }] },
      "ui",
    );

    feature.detach();
  });

  it("number range both values applies between operator", () => {
    const columns = makeColumns("age");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    inputs[0]!.value = "10";
    inputs[1]!.value = "50";
    inputs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "age",
      { type: "number", conditions: [{ operator: "between", value: 10, valueTo: 50 }] },
      "ui",
    );

    feature.detach();
  });

  it("number range clears filter when both empty", () => {
    const columns = makeColumns("age");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const clearFilter = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      clearColumnFilter: clearFilter,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    inputs[0]!.value = "";
    inputs[1]!.value = "";
    inputs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(clearFilter).toHaveBeenCalledWith("age", "ui");

    feature.detach();
  });

  it("number range does not apply model for non-finite value", () => {
    const columns: ColumnDef[] = [
      { field: "age", headerName: "Age", floatingFilter: { control: "text" } },
    ];
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.value = "abc";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(setModel).not.toHaveBeenCalled();

    feature.detach();
  });

  // ── Date range control ──────────────────────────────────────────────

  it("renders calendar date button when control is dateButton", () => {
    const columns: ColumnDef[] = [
      {
        field: "dob",
        headerName: "dob",
        floatingFilter: { control: "dateButton", menuButton: false },
      },
    ];
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("dob", DATE_FILTER);
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const button = root.querySelector<HTMLButtonElement>(
      ".lfg-floating-filter-date-button",
    );
    expect(button).not.toBeNull();
    expect(button!.classList.contains("lfg-column-filter-trigger")).toBe(true);
    expect(button!.getAttribute("data-col-id")).toBe("dob");
    expect(root.querySelector(".lfg-floating-filter-range")).toBeNull();

    feature.detach();
  });

  it("renders Start/End date inputs for date filter type by default", () => {
    const columns = makeColumns("dob");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("dob", DATE_FILTER);
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const wrapper = root.querySelector(".lfg-floating-filter-range");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute("data-lfg-range-kind")).toBe("date");
    expect(wrapper!.querySelector(".lfg-floating-filter-range-sep")).not.toBeNull();
    const inputs = wrapper!.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-input");
    expect(inputs.length).toBe(2);
    expect(inputs[0]!.type).toBe("date");
    expect(inputs[0]!.getAttribute("aria-label")).toBe("Start dob date filter");
    expect(inputs[1]!.type).toBe("date");
    expect(inputs[1]!.getAttribute("aria-label")).toBe("End dob date filter");

    feature.detach();
  });

  it("date range start-only applies after operator", () => {
    const columns = makeDateRangeColumns("dob");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("dob", DATE_FILTER);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    inputs[0]!.value = "2024-01-01";
    inputs[0]!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "dob",
      { type: "date", conditions: [{ operator: "after", value: "2024-01-01" }] },
      "ui",
    );

    feature.detach();
  });

  it("date range end-only applies before operator", () => {
    const columns = makeDateRangeColumns("dob");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("dob", DATE_FILTER);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    inputs[1]!.value = "2024-12-31";
    inputs[1]!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "dob",
      { type: "date", conditions: [{ operator: "before", value: "2024-12-31" }] },
      "ui",
    );

    feature.detach();
  });

  it("date range both values applies between operator", () => {
    const columns = makeDateRangeColumns("dob");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("dob", DATE_FILTER);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    inputs[0]!.value = "2024-01-01";
    inputs[1]!.value = "2024-12-31";
    inputs[0]!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "dob",
      { type: "date", conditions: [{ operator: "between", value: "2024-01-01", valueTo: "2024-12-31" }] },
      "ui",
    );

    feature.detach();
  });

  it("date range clears filter when both empty", () => {
    const columns = makeDateRangeColumns("dob");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("dob", DATE_FILTER);
    const clearFilter = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      clearColumnFilter: clearFilter,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    inputs[0]!.value = "";
    inputs[1]!.value = "";
    inputs[0]!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(clearFilter).toHaveBeenCalledWith("dob", "ui");

    feature.detach();
  });

  // ── Boolean select control ──────────────────────────────────────────

  it("renders All/Yes/No select for boolean filter type", () => {
    const columns = makeColumns("active");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("active", BOOLEAN_FILTER);
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const select = root.querySelector<HTMLSelectElement>(".lfg-floating-filter-input");
    expect(select).not.toBeNull();
    expect(select!.tagName).toBe("SELECT");
    expect(select!.options.length).toBe(3);
    expect(select!.options[0]!.textContent).toBe("All");
    expect(select!.options[0]!.value).toBe("");
    expect(select!.options[1]!.textContent).toBe("Yes");
    expect(select!.options[1]!.value).toBe("true");
    expect(select!.options[2]!.textContent).toBe("No");
    expect(select!.options[2]!.value).toBe("false");
    expect(select!.getAttribute("aria-label")).toBe("Filter active");

    feature.detach();
  });

  it("boolean select applies filter on change", () => {
    const columns = makeColumns("active");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("active", BOOLEAN_FILTER);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const select = root.querySelector<HTMLSelectElement>(".lfg-floating-filter-input")!;
    select.value = "true";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "active",
      {
        type: "boolean",
        conditions: [{ operator: "equals", value: true }],
      },
      "ui",
    );

    feature.detach();
  });

  it("boolean select All clears filter", () => {
    const columns = makeColumns("active");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("active", BOOLEAN_FILTER);
    const clearFilter = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      clearColumnFilter: clearFilter,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const select = root.querySelector<HTMLSelectElement>(".lfg-floating-filter-input")!;
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(clearFilter).toHaveBeenCalledWith("active", "ui");

    feature.detach();
  });

  // ── Select control ──────────────────────────────────────────────────

  it("select control uses explicit floatingFilter.options", () => {
    const columns: ColumnDef[] = [
      {
        field: "status",
        headerName: "Status",
        floatingFilter: { control: "select", options: ["Active", "Inactive", "Pending"] },
      },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const select = root.querySelector<HTMLSelectElement>(".lfg-floating-filter-input")!;
    expect(select.tagName).toBe("SELECT");
    expect(select.getAttribute("aria-label")).toBe("Filter Status");
    expect(select.options.length).toBe(4);
    expect(select.options[0]!.textContent).toBe("All");
    expect(select.options[1]!.textContent).toBe("Active");
    expect(select.options[2]!.textContent).toBe("Inactive");
    expect(select.options[3]!.textContent).toBe("Pending");

    feature.detach();
  });

  it("select control uses column editor select options as fallback", () => {
    const columns: ColumnDef[] = [
      {
        field: "status",
        headerName: "Status",
        floatingFilter: { control: "select" },
        editor: { type: "select", options: ["Draft", "Published"] },
      },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const select = root.querySelector<HTMLSelectElement>(".lfg-floating-filter-input")!;
    expect(select.tagName).toBe("SELECT");
    expect(select.options.length).toBe(3);
    expect(select.options[0]!.textContent).toBe("All");
    expect(select.options[1]!.textContent).toBe("Draft");
    expect(select.options[2]!.textContent).toBe("Published");

    feature.detach();
  });

  it("select control falls back to text input if no options exist", () => {
    const columns: ColumnDef[] = [
      {
        field: "status",
        headerName: "Status",
        floatingFilter: { control: "select" },
      },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(input.tagName).toBe("INPUT");
    expect(input.type).toBe("text");

    feature.detach();
  });

  it("select control applies equals filter on change", () => {
    const columns: ColumnDef[] = [
      {
        field: "status",
        headerName: "Status",
        floatingFilter: { control: "select", options: ["Active", "Inactive"] },
      },
    ];
    const setModel = vi.fn();
    const opts = makeOptions(columns, { setColumnFilterModel: setModel });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const select = root.querySelector<HTMLSelectElement>(".lfg-floating-filter-input")!;
    select.value = "Active";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "status",
      { type: "text", conditions: [{ operator: "equals", value: "Active" }] },
      "ui",
    );

    feature.detach();
  });

  it("select control with value/label objects uses value for filter", () => {
    const columns: ColumnDef[] = [
      {
        field: "status",
        headerName: "Status",
        floatingFilter: {
          control: "select",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
        },
      },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const select = root.querySelector<HTMLSelectElement>(".lfg-floating-filter-input")!;
    expect(select.options[1]!.value).toBe("active");
    expect(select.options[1]!.textContent).toBe("Active");

    feature.detach();
  });

  // ── Control "none" ──────────────────────────────────────────────────

  it('control "none" renders empty aligned cell', () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name", floatingFilter: { control: "none" } },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const cells = root.querySelectorAll(".lfg-floating-filter-cell");
    expect(cells.length).toBe(1);
    expect(cells[0]!.querySelector(".lfg-floating-filter-input")).toBeNull();
    expect(cells[0]!.querySelector(".lfg-floating-filter-range")).toBeNull();

    feature.detach();
  });

  // ── Internal selection column ───────────────────────────────────────

  it("internal selection checkbox column never renders input", () => {
    const columns: ColumnDef[] = [
      { field: "__selection__", headerName: "", internal: "selection" },
      { field: "name", headerName: "Name" },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const cells = root.querySelectorAll(".lfg-floating-filter-cell");
    expect(cells.length).toBe(2);
    const selCell = cells[0]!;
    expect(selCell.querySelector(".lfg-floating-filter-input")).toBeNull();
    expect(selCell.querySelector(".lfg-floating-filter-range")).toBeNull();
    const nameCell = cells[1]!;
    expect(nameCell.querySelector(".lfg-floating-filter-input")).not.toBeNull();

    feature.detach();
  });

  // ── Action columns ──────────────────────────────────────────────────

  it("action columns never render floating filter input", () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name" },
      {
        field: "actions",
        headerName: "",
        cellKind: "actions",
        actionsKey: "rowActions",
        columnMenu: false,
        sortable: false,
      },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const cells = root.querySelectorAll(".lfg-floating-filter-cell");
    expect(cells.length).toBe(2);
    const actionCell = cells[1]!;
    expect(actionCell.getAttribute("data-lfg-utility-column")).toBe("");
    expect(actionCell.querySelector(".lfg-floating-filter-input")).toBeNull();
    expect(actionCell.querySelector(".lfg-floating-filter-range")).toBeNull();
    expect(actionCell.querySelector(".lfg-column-filter-trigger")).toBeNull();

    feature.detach();
  });

  // ── Menu button / icon ──────────────────────────────────────────────

  it("renders menu button with correct aria-label including header name", () => {
    const columns = makeColumns("name");
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const btn = root.querySelector<HTMLButtonElement>(".lfg-column-filter-trigger");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("data-col-id")).toBe("name");
    expect(btn!.getAttribute("aria-label")).toBe("Open filter menu for name");
    expect(btn!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(btn!.getAttribute("aria-expanded")).toBe("false");
    expect(btn!.hasAttribute("aria-controls")).toBe(false);

    feature.detach();
  });

  it("renders menu button after input in DOM order", () => {
    const columns = makeColumns("name");
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const cell = root.querySelector(".lfg-floating-filter-cell")!;
    const children = Array.from(cell.children);
    const inputIdx = children.findIndex((el) =>
      el.classList.contains("lfg-floating-filter-input") || el.classList.contains("lfg-floating-filter-range"),
    );
    const btnIdx = children.findIndex((el) => el.classList.contains("lfg-column-filter-trigger"));
    expect(inputIdx).toBeLessThan(btnIdx);

    feature.detach();
  });

  it("renders menu button after range wrapper for number filter", () => {
    const columns = makeColumns("age");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const cell = root.querySelector(".lfg-floating-filter-cell")!;
    const children = Array.from(cell.children);
    const rangeIdx = children.findIndex((el) => el.classList.contains("lfg-floating-filter-range"));
    const btnIdx = children.findIndex((el) => el.classList.contains("lfg-column-filter-trigger"));
    expect(rangeIdx).toBeGreaterThanOrEqual(0);
    expect(btnIdx).toBeGreaterThan(rangeIdx);

    feature.detach();
  });

  it("does not render menu button when menuButton is false", () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name", floatingFilter: { menuButton: false } },
    ];
    const opts = makeOptions(columns, {
      getFloatingFiltersOption: () => true,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    expect(root.querySelector(".lfg-column-filter-trigger")).toBeNull();

    feature.detach();
  });

  it("menu button has correct class for filter trigger delegation", () => {
    const columns = makeColumns("name");
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const btn = root.querySelector<HTMLButtonElement>(".lfg-column-filter-trigger")!;
    expect(btn).not.toBeNull();
    expect(btn.closest(".lfg-floating-filter-cell")).not.toBeNull();
    expect(btn.getAttribute("data-col-id")).toBe("name");

    feature.detach();
  });

  // ── Empty cell for no-filter columns ────────────────────────────────

  it("skips column with no filter config — renders empty aligned cell", () => {
    const columns = makeColumns("name", "unfiltered");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("name", TEXT_FILTER);
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const cells = root.querySelectorAll(".lfg-floating-filter-cell");
    expect(cells.length).toBe(2);
    const unfilteredCell = cells[1]!;
    expect(unfilteredCell.querySelector(".lfg-floating-filter-input")).toBeNull();

    feature.detach();
  });

  // ── Pinned columns ─────────────────────────────────────────────────

  it("renders floating filter rows after pinned leaf rows inside stacks", () => {
    const columns: ColumnDef[] = [
      { field: "left1", headerName: "Left1", pinned: "left" },
      { field: "center1", headerName: "Center1" },
      { field: "right1", headerName: "Right1", pinned: "right" },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);

    const centerContainer = document.createElement("div");
    centerContainer.className = "lfg-header";
    root.appendChild(centerContainer);

    const headerRow = document.createElement("div");
    headerRow.className = "lfg-header-row";
    centerContainer.appendChild(headerRow);

    const leftStack = document.createElement("div");
    leftStack.className = "lfg-pinned-header-stack lfg-pinned-left-header-stack";
    root.appendChild(leftStack);

    const pinnedLeftHeader = document.createElement("div");
    pinnedLeftHeader.className = "lfg-pinned-header-row";
    leftStack.appendChild(pinnedLeftHeader);

    const rightStack = document.createElement("div");
    rightStack.className = "lfg-pinned-header-stack lfg-pinned-right-header-stack";
    root.appendChild(rightStack);

    const pinnedRightHeader = document.createElement("div");
    pinnedRightHeader.className = "lfg-pinned-right-header-row";
    rightStack.appendChild(pinnedRightHeader);

    const ctx: DomGridFeatureContext = {
      root,
      surface: root,
      viewport: root,
      getPool: () => [],
      getColumns: () => columns,
      getDisplayRows: () => ({ rowCount: 0, getRow: () => null, getRowData: () => undefined, getSourceIndex: () => -1 }),
      getSourceRows: () => [],
      getVisibleRowStart: () => 0,
      requestSync: () => {},
      requestColumnTransformSync: () => {},
      resolveRowId: (_row, idx) => String(idx),
      getHeaderRowEl: () => headerRow,
      getPinnedHeaderRowEl: () => pinnedLeftHeader,
      getPinnedRightHeaderRowEl: () => pinnedRightHeader,
      getHeaderLaneRefs: () => ({
        center: { container: centerContainer, leafRow: headerRow },
        left: { container: leftStack, leafRow: pinnedLeftHeader },
        right: { container: rightStack, leafRow: pinnedRightHeader },
      }),
      getColumnGroupHeaders: () => undefined,
      getDataRevision: () => 1,
      getSelectedColumnIdsForColumnOrder: () => [],
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      getSortModel: () => [],
      toggleColumnSort: () => {},
      setColumnSort: () => {},
      pinColumn: () => {},
    };

    feature.attach(ctx);

    const centerFilterRow = headerRow.nextElementSibling;
    expect(centerFilterRow?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(
      centerFilterRow
        ?.querySelector('[data-col-id="center1"] .lfg-floating-filter-input')
        ?.getAttribute("aria-label"),
    ).toBe("Filter Center1");
    expect(centerFilterRow?.parentElement).toBe(centerContainer);

    const leftFilterRow = pinnedLeftHeader.nextElementSibling;
    expect(leftFilterRow?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(leftFilterRow?.parentElement).toBe(leftStack);
    expect(pinnedLeftHeader.contains(leftFilterRow!)).toBe(false);
    expect(
      leftFilterRow
        ?.querySelector('[data-col-id="left1"] .lfg-floating-filter-input')
        ?.getAttribute("aria-label"),
    ).toBe("Filter Left1");

    const rightFilterRow = pinnedRightHeader.nextElementSibling;
    expect(rightFilterRow?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(rightFilterRow?.parentElement).toBe(rightStack);
    expect(pinnedRightHeader.contains(rightFilterRow!)).toBe(false);
    expect(
      rightFilterRow
        ?.querySelector('[data-col-id="right1"] .lfg-floating-filter-input')
        ?.getAttribute("aria-label"),
    ).toBe("Filter Right1");

    feature.detach();
  });

  // ── Lifecycle / sync ────────────────────────────────────────────────

  it("sets data-col-id on floating filter cells", () => {
    const columns = makeColumns("name", "age");
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const cells = root.querySelectorAll(".lfg-floating-filter-cell");
    expect(cells[0]!.getAttribute("data-col-id")).toBe("name");
    expect(cells[1]!.getAttribute("data-col-id")).toBe("age");

    feature.detach();
  });

  it("shows disabled 'Filtered' for complex multi-condition model", () => {
    const columns = makeColumns("name");
    const complexModel: ColumnFilterModel = {
      type: "text",
      operator: "and",
      conditions: [
        { operator: "contains", value: "a" },
        { operator: "startsWith", value: "b" },
      ],
    };
    const opts = makeOptions(columns, {
      getColumnFilterModel: () => complexModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Filtered");
    expect(input.getAttribute("aria-label")).toBe("Filter name");
    expect(input.value).toBe("");

    feature.detach();
  });

  it("removes rows on detach", () => {
    const columns = makeColumns("name");
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);
    expect(root.querySelector(".lfg-floating-filter-row")).not.toBeNull();

    feature.detach();
    expect(root.querySelector(".lfg-floating-filter-row")).toBeNull();
  });

  it("syncFloatingFilters updates input values from model", () => {
    const columns = makeColumns("name");
    const models = new Map<string, ColumnFilterModel | null>();
    const opts = makeOptions(columns, {
      getColumnFilterModel: (field) => models.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const rowEl = root.querySelector(".lfg-floating-filter-row")!;
    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    const setAttribute = vi.spyOn(input, "setAttribute");
    expect(input.value).toBe("");

    models.set("name", {
      type: "text",
      conditions: [{ operator: "contains", value: "updated" }],
    });
    feature.syncFloatingFilters();

    expect(root.querySelector(".lfg-floating-filter-row")).toBe(rowEl);
    expect(input.value).toBe("updated");
    expect(setAttribute).not.toHaveBeenCalledWith("aria-label", expect.any(String));

    feature.detach();
  });

  it("rebuilds controls when the effective column label changes", () => {
    const columns: ColumnDef[] = [{ field: "name", headerName: "Customer" }];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const original = root.querySelector<HTMLInputElement>(
      ".lfg-floating-filter-input",
    )!;
    expect(original.getAttribute("aria-label")).toBe("Filter Customer");

    columns[0] = { field: "name", headerName: "Account owner" };
    feature.syncFloatingFilters();

    const replacement = root.querySelector<HTMLInputElement>(
      ".lfg-floating-filter-input",
    )!;
    expect(replacement).not.toBe(original);
    expect(original.isConnected).toBe(false);
    expect(replacement.getAttribute("aria-label")).toBe("Filter Account owner");

    feature.detach();
  });

  it("does not confuse a header-label delimiter with select-option content", () => {
    const columns: ColumnDef[] = [{
      field: "status",
      headerName: "A:B",
      floatingFilter: { control: "select", options: ["C"] },
    }];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const original = root.querySelector<HTMLSelectElement>(
      ".lfg-floating-filter-input",
    )!;
    expect(original.getAttribute("aria-label")).toBe("Filter A:B");

    columns[0] = {
      field: "status",
      headerName: "A",
      floatingFilter: { control: "select", options: ["B:C"] },
    };
    feature.syncFloatingFilters();

    const replacement = root.querySelector<HTMLSelectElement>(
      ".lfg-floating-filter-input",
    )!;
    expect(replacement).not.toBe(original);
    expect(replacement.getAttribute("aria-label")).toBe("Filter A");
    expect(replacement.options[1]!.textContent).toBe("B:C");

    feature.detach();
  });

  it("reattaches center floating filter row when header row is replaced", () => {
    const columns = makeColumns("name", "age");
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);

    let headerRow = document.createElement("div");
    headerRow.className = "lfg-header-row";
    root.appendChild(headerRow);

    const ctx: DomGridFeatureContext = {
      ...makeCtx(root, columns),
      getHeaderRowEl: () => headerRow,
    };

    feature.attach(ctx);
    expect(root.querySelector(".lfg-floating-filter-input")).not.toBeNull();

    const detachedRow = root.querySelector(".lfg-floating-filter-row");
    const replacementHeader = document.createElement("div");
    replacementHeader.className = "lfg-header-row";
    root.innerHTML = "";
    root.appendChild(replacementHeader);
    headerRow = replacementHeader;

    expect(detachedRow?.isConnected).toBe(false);
    expect(root.querySelector(".lfg-floating-filter-input")).toBeNull();

    feature.syncFloatingFilters();

    expect(root.querySelector(".lfg-floating-filter-input")).not.toBeNull();
    expect(
      replacementHeader.nextElementSibling?.classList.contains("lfg-floating-filter-row"),
    ).toBe(true);

    feature.detach();
  });

  it("reattaches pinned floating filter rows when pinned headers are replaced", () => {
    const columns: ColumnDef[] = [
      { field: "left1", headerName: "Left1", pinned: "left" },
      { field: "center1", headerName: "Center1" },
      { field: "right1", headerName: "Right1", pinned: "right" },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);

    const centerContainer = document.createElement("div");
    centerContainer.className = "lfg-header";
    root.appendChild(centerContainer);

    const headerRow = document.createElement("div");
    headerRow.className = "lfg-header-row";
    centerContainer.appendChild(headerRow);

    let leftStack = document.createElement("div");
    leftStack.className = "lfg-pinned-header-stack lfg-pinned-left-header-stack";
    root.appendChild(leftStack);
    let pinnedLeftHeader = document.createElement("div");
    pinnedLeftHeader.className = "lfg-pinned-header-row";
    leftStack.appendChild(pinnedLeftHeader);

    let rightStack = document.createElement("div");
    rightStack.className = "lfg-pinned-header-stack lfg-pinned-right-header-stack";
    root.appendChild(rightStack);
    let pinnedRightHeader = document.createElement("div");
    pinnedRightHeader.className = "lfg-pinned-right-header-row";
    rightStack.appendChild(pinnedRightHeader);

    const ctx: DomGridFeatureContext = {
      root,
      surface: root,
      viewport: root,
      getPool: () => [],
      getColumns: () => columns,
      getDisplayRows: () => ({ rowCount: 0, getRow: () => null, getRowData: () => undefined, getSourceIndex: () => -1 }),
      getSourceRows: () => [],
      getVisibleRowStart: () => 0,
      requestSync: () => {},
      requestColumnTransformSync: () => {},
      resolveRowId: (_row, idx) => String(idx),
      getHeaderRowEl: () => headerRow,
      getPinnedHeaderRowEl: () => pinnedLeftHeader,
      getPinnedRightHeaderRowEl: () => pinnedRightHeader,
      getHeaderLaneRefs: () => ({
        center: { container: centerContainer, leafRow: headerRow },
        left: { container: leftStack, leafRow: pinnedLeftHeader },
        right: { container: rightStack, leafRow: pinnedRightHeader },
      }),
      getColumnGroupHeaders: () => undefined,
      getDataRevision: () => 1,
      getSelectedColumnIdsForColumnOrder: () => [],
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      getSortModel: () => [],
      toggleColumnSort: () => {},
      setColumnSort: () => {},
      pinColumn: () => {},
    };

    feature.attach(ctx);
    expect(pinnedLeftHeader.nextElementSibling?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(pinnedRightHeader.nextElementSibling?.classList.contains("lfg-floating-filter-row")).toBe(true);

    const replacementLeftStack = document.createElement("div");
    replacementLeftStack.className = "lfg-pinned-header-stack lfg-pinned-left-header-stack";
    const replacementLeftHeader = document.createElement("div");
    replacementLeftHeader.className = "lfg-pinned-header-row";
    replacementLeftStack.appendChild(replacementLeftHeader);

    const replacementRightStack = document.createElement("div");
    replacementRightStack.className = "lfg-pinned-header-stack lfg-pinned-right-header-stack";
    const replacementRightHeader = document.createElement("div");
    replacementRightHeader.className = "lfg-pinned-right-header-row";
    replacementRightStack.appendChild(replacementRightHeader);

    leftStack.remove();
    rightStack.remove();
    root.appendChild(replacementLeftStack);
    root.appendChild(replacementRightStack);
    leftStack = replacementLeftStack;
    rightStack = replacementRightStack;
    pinnedLeftHeader = replacementLeftHeader;
    pinnedRightHeader = replacementRightHeader;

    expect(pinnedLeftHeader.nextElementSibling).toBeNull();
    expect(pinnedRightHeader.nextElementSibling).toBeNull();

    feature.syncFloatingFilters();

    expect(pinnedLeftHeader.nextElementSibling?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(pinnedRightHeader.nextElementSibling?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(
      headerRow.nextElementSibling?.classList.contains("lfg-floating-filter-row"),
    ).toBe(true);

    feature.detach();
  });

  it("runtime enable adds floating filter row", () => {
    const columns = makeColumns("name");
    let enabled = false;
    const opts = makeOptions(columns, {
      getFloatingFiltersOption: () => enabled,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);
    expect(root.querySelector(".lfg-floating-filter-row")).toBeNull();
    expect(root.classList.contains("lfg-floating-filters-active")).toBe(false);
    expect(feature.getHeaderAddonHeight()).toBe(0);

    enabled = true;
    feature.syncFloatingFilters();
    expect(root.querySelector(".lfg-floating-filter-row")).not.toBeNull();
    expect(root.classList.contains("lfg-floating-filters-active")).toBe(true);
    expect(feature.getHeaderAddonHeight()).toBe(ROW_HEIGHT);

    feature.detach();
    expect(root.classList.contains("lfg-floating-filters-active")).toBe(false);
  });

  it("runtime disable removes floating filter row", () => {
    const columns = makeColumns("name");
    let enabled: boolean | undefined = true;
    const opts = makeOptions(columns, {
      getFloatingFiltersOption: () => enabled,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);
    expect(root.querySelector(".lfg-floating-filter-row")).not.toBeNull();
    expect(root.classList.contains("lfg-floating-filters-active")).toBe(true);

    enabled = false;
    feature.syncFloatingFilters();
    expect(root.querySelector(".lfg-floating-filter-row")).toBeNull();
    expect(root.classList.contains("lfg-floating-filters-active")).toBe(false);
    expect(feature.getHeaderAddonHeight()).toBe(0);

    feature.detach();
  });

  // ── Debounce ────────────────────────────────────────────────────────

  it("debounces input events", () => {
    vi.useFakeTimers();
    const columns = makeColumns("name");
    const setModel = vi.fn();
    const opts = makeOptions(columns, { setColumnFilterModel: setModel });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.value = "a";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(setModel).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(setModel).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(setModel).toHaveBeenCalledTimes(1);

    feature.detach();
    vi.useRealTimers();
  });

  it("flushes pending debounce on blur", () => {
    vi.useFakeTimers();
    const columns = makeColumns("name");
    const setModel = vi.fn();
    const opts = makeOptions(columns, { setColumnFilterModel: setModel });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.value = "test";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(setModel).not.toHaveBeenCalled();

    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(setModel).toHaveBeenCalledTimes(1);

    feature.detach();
    vi.useRealTimers();
  });

  // ── Focus preservation after debounce/filter apply ──────────────────

  it("input retains focus and DOM identity after debounce applies filter and sync runs", () => {
    vi.useFakeTimers();
    const columns = makeColumns("name");
    const models = new Map<string, ColumnFilterModel | null>();
    const setModel = vi.fn((field: string, model: ColumnFilterModel | null) => {
      models.set(field, model);
    });
    const opts = makeOptions(columns, {
      setColumnFilterModel: setModel,
      getColumnFilterModel: (field) => models.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.focus();
    expect(document.activeElement).toBe(input);

    input.value = "hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(300);
    expect(setModel).toHaveBeenCalledTimes(1);

    feature.syncFloatingFilters();

    const inputAfterSync = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(inputAfterSync).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("hello");

    feature.detach();
    vi.useRealTimers();
  });

  it("range input retains focus after filter apply and sync", () => {
    vi.useFakeTimers();
    const columns = makeColumns("age");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const models = new Map<string, ColumnFilterModel | null>();
    const setModel = vi.fn((field: string, model: ColumnFilterModel | null) => {
      models.set(field, model);
    });
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
      getColumnFilterModel: (field) => models.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    const minInput = inputs[0]!;
    minInput.focus();
    expect(document.activeElement).toBe(minInput);

    minInput.value = "10";
    minInput.dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(300);
    expect(setModel).toHaveBeenCalledTimes(1);

    feature.syncFloatingFilters();

    expect(document.activeElement).toBe(minInput);
    expect(minInput.disabled).toBe(false);
    expect(minInput.value).toBe("10");

    feature.detach();
    vi.useRealTimers();
  });

  // ── Operator fallback ───────────────────────────────────────────────

  it("uses fallback operator for text input when defaultOperator is incompatible", () => {
    const columns = makeColumns("name");
    const betweenFilter: NormalizedColumnFilterConfig = {
      type: "text",
      defaultOperator: "in",
      caseSensitive: false,
      trimInput: false,
    };
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("name", betweenFilter);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.value = "hello";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(setModel).toHaveBeenCalledWith(
      "name",
      {
        type: "text",
        conditions: [{ operator: "contains", value: "hello" }],
      },
      "ui",
    );

    feature.detach();
  });

  // ── Center header layout ────────────────────────────────────────────

  it("center header row does not consume combined height — floating row is a sibling", () => {
    const columns = makeColumns("name");
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const headerRow = ctx.getHeaderRowEl()!;
    const floatingRow = headerRow.nextElementSibling;
    expect(floatingRow?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(floatingRow).not.toBe(headerRow);
    expect(headerRow.contains(floatingRow)).toBe(false);

    feature.detach();
  });

  it("pinned-only columns still report floating header addon height", () => {
    const columns: ColumnDef[] = [
      { field: "left1", headerName: "Left1", pinned: "left" },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);

    const header = document.createElement("div");
    header.className = "lfg-header";
    root.appendChild(header);
    const headerRow = document.createElement("div");
    headerRow.className = "lfg-header-row";
    header.appendChild(headerRow);

    const leftStack = document.createElement("div");
    leftStack.className = "lfg-pinned-header-stack lfg-pinned-left-header-stack";
    root.appendChild(leftStack);
    const pinnedLeftHeader = document.createElement("div");
    pinnedLeftHeader.className = "lfg-pinned-header-row";
    leftStack.appendChild(pinnedLeftHeader);

    const ctx: DomGridFeatureContext = {
      root,
      surface: root,
      viewport: root,
      getPool: () => [],
      getColumns: () => columns,
      getDisplayRows: () => ({ rowCount: 0, getRow: () => null, getRowData: () => undefined, getSourceIndex: () => -1 }),
      getSourceRows: () => [],
      getVisibleRowStart: () => 0,
      requestSync: () => {},
      requestColumnTransformSync: () => {},
      resolveRowId: (_row, idx) => String(idx),
      getHeaderRowEl: () => headerRow,
      getPinnedHeaderRowEl: () => pinnedLeftHeader,
      getPinnedRightHeaderRowEl: () => null,
      getHeaderLaneRefs: () => ({
        center: { container: header, leafRow: headerRow },
        left: { container: leftStack, leafRow: pinnedLeftHeader },
        right: null,
      }),
      getColumnGroupHeaders: () => undefined,
      getDataRevision: () => 1,
      getSelectedColumnIdsForColumnOrder: () => [],
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      getSortModel: () => [],
      toggleColumnSort: () => {},
      setColumnSort: () => {},
      pinColumn: () => {},
    };

    feature.attach(ctx);

    expect(feature.getHeaderAddonHeight()).toBe(ROW_HEIGHT);
    const centerHeaderRow = ctx.getHeaderRowEl()!;
    expect(centerHeaderRow.nextElementSibling?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(pinnedLeftHeader.nextElementSibling?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(pinnedLeftHeader.contains(pinnedLeftHeader.nextElementSibling!)).toBe(false);

    feature.detach();
  });

  it("runtime disable returns addon height to zero", () => {
    const columns = makeColumns("name");
    let enabled: boolean | undefined = true;
    const opts = makeOptions(columns, {
      getFloatingFiltersOption: () => enabled,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);
    expect(feature.getHeaderAddonHeight()).toBe(ROW_HEIGHT);

    enabled = false;
    feature.syncFloatingFilters();
    expect(feature.getHeaderAddonHeight()).toBe(0);
    expect(root.querySelector(".lfg-floating-filter-row")).toBeNull();

    feature.detach();
  });

  // ── No row-value scan ───────────────────────────────────────────────

  it("no row-value provider or distinct scan is called during floating row render", () => {
    const columns = makeColumns("name", "age");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("name", TEXT_FILTER);
    filterConfigs.set("age", NUMBER_FILTER);
    const getSourceRows = vi.fn(() => []);
    const getDisplayRows = vi.fn(() => ({
      rowCount: 0,
      getRow: () => null,
      getRowData: () => undefined,
      getSourceIndex: () => -1,
    }));
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);

    const headerRow = document.createElement("div");
    headerRow.className = "lfg-header-row";
    root.appendChild(headerRow);

    const ctx: DomGridFeatureContext = {
      root,
      surface: root,
      viewport: root,
      getPool: () => [],
      getColumns: () => columns,
      getDisplayRows: getDisplayRows as unknown as DomGridFeatureContext["getDisplayRows"],
      getSourceRows,
      getVisibleRowStart: () => 0,
      requestSync: () => {},
      requestColumnTransformSync: () => {},
      resolveRowId: (_row, idx) => String(idx),
      getHeaderRowEl: () => headerRow,
      getPinnedHeaderRowEl: () => null,
      getPinnedRightHeaderRowEl: () => null,
      getDataRevision: () => 1,
      getSelectedColumnIdsForColumnOrder: () => [],
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      getSortModel: () => [],
      toggleColumnSort: () => {},
      setColumnSort: () => {},
      pinColumn: () => {},
    };

    feature.attach(ctx);

    expect(getSourceRows).not.toHaveBeenCalled();
    expect(getDisplayRows).not.toHaveBeenCalled();

    feature.detach();
  });

  // ── Data revision does NOT rebuild DOM ──────────────────────────────

  it("data revision change alone does not rebuild floating filter DOM", () => {
    const columns = makeColumns("name");
    let dataRevision = 1;
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);

    const headerRow = document.createElement("div");
    headerRow.className = "lfg-header-row";
    root.appendChild(headerRow);

    const ctx: DomGridFeatureContext = {
      root,
      surface: root,
      viewport: root,
      getPool: () => [],
      getColumns: () => columns,
      getDisplayRows: () => ({ rowCount: 0, getRow: () => null, getRowData: () => undefined, getSourceIndex: () => -1 }),
      getSourceRows: () => [],
      getVisibleRowStart: () => 0,
      requestSync: () => {},
      requestColumnTransformSync: () => {},
      resolveRowId: (_row, idx) => String(idx),
      getHeaderRowEl: () => headerRow,
      getPinnedHeaderRowEl: () => null,
      getPinnedRightHeaderRowEl: () => null,
      getDataRevision: () => dataRevision,
      getSelectedColumnIdsForColumnOrder: () => [],
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      getSortModel: () => [],
      toggleColumnSort: () => {},
      setColumnSort: () => {},
      pinColumn: () => {},
    };

    feature.attach(ctx);

    const rowEl = root.querySelector(".lfg-floating-filter-row")!;
    const inputEl = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(rowEl).not.toBeNull();
    expect(inputEl).not.toBeNull();

    dataRevision = 99;
    feature.syncFloatingFilters();

    expect(root.querySelector(".lfg-floating-filter-row")).toBe(rowEl);
    expect(root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")).toBe(inputEl);

    feature.detach();
  });

  // ── Control-aware representability ──────────────────────────────────

  it("text input with 'in' operator shows disabled Filtered", () => {
    const columns = makeColumns("name");
    const inModel: ColumnFilterModel = {
      type: "text",
      conditions: [{ operator: "in", value: ["a", "b"] }],
    };
    const opts = makeOptions(columns, {
      getColumnFilterModel: () => inModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Filtered");

    feature.detach();
  });

  it("text input with 'isNull' operator shows disabled Filtered", () => {
    const columns = makeColumns("name");
    const isNullModel: ColumnFilterModel = {
      type: "text",
      conditions: [{ operator: "isNull" }],
    };
    const opts = makeOptions(columns, {
      getColumnFilterModel: () => isNullModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Filtered");

    feature.detach();
  });

  it("selection model shows disabled Filtered for text input", () => {
    const columns = makeColumns("name");
    const selectionModel: ColumnFilterModel = {
      type: "text",
      conditions: [{ operator: "contains", value: "x" }],
      selection: { operator: "in", values: ["a", "b"] },
    };
    const opts = makeOptions(columns, {
      getColumnFilterModel: () => selectionModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Filtered");

    feature.detach();
  });

  it("number range with unsupported 'equals' operator shows disabled", () => {
    const columns = makeColumns("age");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const equalsModel: ColumnFilterModel = {
      type: "number",
      conditions: [{ operator: "equals", value: 42 }],
    };
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      getColumnFilterModel: () => equalsModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    expect(inputs[0]!.disabled).toBe(true);
    expect(inputs[1]!.disabled).toBe(true);
    expect(inputs[0]!.getAttribute("aria-label")).toBe("Minimum age filter");
    expect(inputs[1]!.getAttribute("aria-label")).toBe("Maximum age filter");

    feature.detach();
  });

  it("date range with unsupported 'equals' operator shows disabled", () => {
    const columns = makeDateRangeColumns("dob");
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("dob", DATE_FILTER);
    const equalsModel: ColumnFilterModel = {
      type: "date",
      conditions: [{ operator: "equals", value: "2024-01-01" }],
    };
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      getColumnFilterModel: () => equalsModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    expect(inputs[0]!.disabled).toBe(true);
    expect(inputs[1]!.disabled).toBe(true);

    feature.detach();
  });

  it("text input event handler does not overwrite non-representable model", () => {
    const columns = makeColumns("name");
    const models = new Map<string, ColumnFilterModel | null>();
    const inModel: ColumnFilterModel = {
      type: "text",
      conditions: [{ operator: "in", value: ["a", "b"] }],
    };
    models.set("name", inModel);
    const setModel = vi.fn();
    const opts = makeOptions(columns, {
      getColumnFilterModel: (field) => models.get(field) ?? null,
      setColumnFilterModel: setModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.disabled = false;
    input.value = "overwrite";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(setModel).not.toHaveBeenCalled();

    feature.detach();
  });

  // ── Disabled column ─────────────────────────────────────────────────

  it("disabled: true renders control but input is disabled", () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name", floatingFilter: { disabled: true } },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(input).not.toBeNull();
    expect(input.type).toBe("text");
    expect(input.disabled).toBe(true);

    feature.detach();
  });

  it("disabled: true displays current representable filter value", () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name", floatingFilter: { disabled: true } },
    ];
    const models = new Map<string, ColumnFilterModel | null>();
    models.set("name", {
      type: "text",
      conditions: [{ operator: "contains", value: "hello" }],
    });
    const opts = makeOptions(columns, {
      getColumnFilterModel: (field) => models.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe("hello");

    feature.detach();
  });

  it("disabled: true does not render menu button", () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name", floatingFilter: { disabled: true, menuButton: true } },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    expect(root.querySelector(".lfg-column-filter-trigger")).toBeNull();

    feature.detach();
  });

  it("disabled: true does not apply filter on Enter", () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name", floatingFilter: { disabled: true } },
    ];
    const setModel = vi.fn();
    const opts = makeOptions(columns, { setColumnFilterModel: setModel });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    input.disabled = false;
    input.value = "test";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(setModel).not.toHaveBeenCalled();

    feature.detach();
  });

  it("disabled: true with non-representable model shows consistent disabled Filtered state", () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name", floatingFilter: { disabled: true } },
    ];
    const complexModel: ColumnFilterModel = {
      type: "text",
      operator: "and",
      conditions: [
        { operator: "contains", value: "a" },
        { operator: "startsWith", value: "b" },
      ],
    };
    const opts = makeOptions(columns, {
      getColumnFilterModel: () => complexModel,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const input = root.querySelector<HTMLInputElement>(".lfg-floating-filter-input")!;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Filtered");
    expect(input.value).toBe("");

    feature.detach();
  });

  it("disabled: true on range control disables both inputs and shows values", () => {
    const columns: ColumnDef[] = [
      { field: "age", headerName: "Age", floatingFilter: { disabled: true } },
    ];
    const filterConfigs = new Map<string, NormalizedColumnFilterConfig>();
    filterConfigs.set("age", NUMBER_FILTER);
    const models = new Map<string, ColumnFilterModel | null>();
    models.set("age", {
      type: "number",
      conditions: [{ operator: "gte", value: 18 }],
    });
    const opts = makeOptions(columns, {
      getFilterConfig: (field) => filterConfigs.get(field) ?? null,
      getColumnFilterModel: (field) => models.get(field) ?? null,
    });
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const inputs = root.querySelectorAll<HTMLInputElement>(".lfg-floating-filter-range .lfg-floating-filter-input");
    expect(inputs[0]!.disabled).toBe(true);
    expect(inputs[1]!.disabled).toBe(true);
    expect(inputs[0]!.value).toBe("18");

    feature.detach();
  });

  it("floatingFilter: false still produces empty aligned cell", () => {
    const columns: ColumnDef[] = [
      { field: "name", headerName: "Name" },
      { field: "notes", headerName: "Notes", floatingFilter: false },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);
    const ctx = makeCtx(root, columns);

    feature.attach(ctx);

    const cells = root.querySelectorAll(".lfg-floating-filter-cell");
    expect(cells.length).toBe(2);
    const notesCell = cells[1]!;
    expect(notesCell.querySelector(".lfg-floating-filter-input")).toBeNull();
    expect(notesCell.querySelector(".lfg-floating-filter-range")).toBeNull();
    expect(notesCell.getAttribute("data-col-id")).toBe("notes");

    feature.detach();
  });

  // ── Pinned selection checkbox coverage ──────────────────────────────

  it("pinned floating filter row does not cover selection checkbox header", () => {
    const columns: ColumnDef[] = [
      { field: "__lfg_selection__", headerName: "", internal: "selection", pinned: "left" },
      { field: "name", headerName: "Name" },
    ];
    const opts = makeOptions(columns);
    const feature = floatingFilterFeature(opts);

    const header = document.createElement("div");
    header.className = "lfg-header";
    root.appendChild(header);
    const headerRow = document.createElement("div");
    headerRow.className = "lfg-header-row";
    header.appendChild(headerRow);

    const leftStack = document.createElement("div");
    leftStack.className = "lfg-pinned-header-stack lfg-pinned-left-header-stack";
    root.appendChild(leftStack);
    const pinnedLeftHeader = document.createElement("div");
    pinnedLeftHeader.className = "lfg-pinned-header-row";
    leftStack.appendChild(pinnedLeftHeader);

    const selHeaderCell = document.createElement("div");
    selHeaderCell.className = "lfg-header-cell";
    selHeaderCell.setAttribute("data-col-id", "__lfg_selection__");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "lfg-header-selection-checkbox";
    selHeaderCell.appendChild(checkbox);
    pinnedLeftHeader.appendChild(selHeaderCell);

    const ctx: DomGridFeatureContext = {
      root,
      surface: root,
      viewport: root,
      getPool: () => [],
      getColumns: () => columns,
      getDisplayRows: () => ({ rowCount: 0, getRow: () => null, getRowData: () => undefined, getSourceIndex: () => -1 }),
      getSourceRows: () => [],
      getVisibleRowStart: () => 0,
      requestSync: () => {},
      requestColumnTransformSync: () => {},
      resolveRowId: (_row, idx) => String(idx),
      getHeaderRowEl: () => headerRow,
      getPinnedHeaderRowEl: () => pinnedLeftHeader,
      getPinnedRightHeaderRowEl: () => null,
      getHeaderLaneRefs: () => ({
        center: { container: header, leafRow: headerRow },
        left: { container: leftStack, leafRow: pinnedLeftHeader },
        right: null,
      }),
      getColumnGroupHeaders: () => undefined,
      getDataRevision: () => 1,
      getSelectedColumnIdsForColumnOrder: () => [],
      getSelectedRowCountForRowOrder: () => 0,
      isRowSelectedForRowOrder: () => false,
      getSelectedRowIdsForRowOrder: () => [],
      getSortModel: () => [],
      toggleColumnSort: () => {},
      setColumnSort: () => {},
      pinColumn: () => {},
    };

    feature.attach(ctx);

    const selCheckbox = pinnedLeftHeader.querySelector(".lfg-header-selection-checkbox");
    expect(selCheckbox).not.toBeNull();

    const floatingRow = pinnedLeftHeader.nextElementSibling;
    expect(floatingRow?.classList.contains("lfg-floating-filter-row")).toBe(true);
    expect(pinnedLeftHeader.contains(floatingRow!)).toBe(false);
    expect(selHeaderCell.contains(floatingRow!)).toBe(false);

    feature.detach();
  });
});
