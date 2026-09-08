// @vitest-environment jsdom
//
// Integration tests for TooltipController — delegated event handling,
// floating lifecycle, tooltip content, row-lookup performance, and
// null-grid safety. No full Grid mount; uses a minimal harness with
// fake DOM rows.

import { afterEach, describe, expect, it, vi } from "vitest";

import { FloatingPositioner } from "../../../features/floating/FloatingPositioner";
import { TooltipController } from "../../../features/tooltips/TooltipController";
import type { Grid } from "../../../Grid";
import { createArrayDisplayRowReader } from "../../../rendering/rowViewAccess";
import type { ColumnDef, RowData } from "../../../types";

// ── Helpers ────────────────────────────────────────────────────

const SHOW_DELAY = 250;

function makeColumns(overrides?: Partial<ColumnDef>[]): ColumnDef[] {
  const base: ColumnDef[] = [
    { field: "id" },
    { field: "name" },
    { field: "amount" },
  ];
  if (overrides) {
    for (let i = 0; i < overrides.length && i < base.length; i++) {
      const col = base[i];
      const ov = overrides[i];
      if (col && ov) Object.assign(col, ov);
    }
  }
  return base;
}

function makeData(): RowData[] {
  return [
    { id: "1", name: "Alice", amount: 100 },
    { id: "2", name: "Bob", amount: -50 },
  ];
}

interface Harness {
  root: HTMLElement;
  viewport: HTMLElement;
  controller: TooltipController;
  columns: ColumnDef[];
  data: RowData[];
  resolveRowId: MockResolveRowId;
}

type MockResolveRowId = ReturnType<typeof createResolveRowIdMock>;

function createResolveRowIdMock() {
  return vi.fn<[row: RowData, index: number], string>(
    (row: RowData) => String((row as Record<string, unknown>).id),
  );
}

function createHarness(
  columnOverrides?: Partial<ColumnDef>[],
  opts?: { getGridInstance?: () => Grid | null },
): Harness {
  const root = document.createElement("div");
  const viewport = document.createElement("div");
  root.appendChild(viewport);
  document.body.appendChild(root);

  const columns = makeColumns(columnOverrides);
  const data = makeData();
  const resolveRowId = createResolveRowIdMock();

  const controller = new TooltipController({
    gridRoot: root,
    viewport,
    getColumns: () => columns,
    getDisplayRows: () => createArrayDisplayRowReader(data),
    resolveRowId,
    getGridInstance: opts?.getGridInstance ?? (() => ({} as Grid)),
  });
  controller.attach(root);

  return { root, viewport, controller, columns, data, resolveRowId };
}

/**
 * Build a fake body row with cells mirroring the real grid DOM structure.
 */
function buildRow(
  rowId: string,
  rowIndex: number,
  fields: string[],
  opts?: { rowClass?: string; cellTexts?: Record<string, string> },
): HTMLElement {
  const row = document.createElement("div");
  row.className = opts?.rowClass ?? "lfg-row";
  row.setAttribute("data-row-id", rowId);
  row.setAttribute("data-row-index", String(rowIndex));

  for (const field of fields) {
    const cell = document.createElement("div");
    cell.className = "lfg-cell";
    cell.setAttribute("data-col-id", field);
    cell.textContent = opts?.cellTexts?.[field] ?? `${field}-value`;
    row.appendChild(cell);
  }
  return row;
}

function buildPinnedRow(
  rowId: string,
  rowIndex: number,
  fields: string[],
  pinType: "left" | "right",
): HTMLElement {
  const className = pinType === "left" ? "lfg-pinned-row" : "lfg-pinned-right-row";
  return buildRow(rowId, rowIndex, fields, { rowClass: className });
}

function getCell(row: HTMLElement, field: string): HTMLElement {
  return row.querySelector(`.lfg-cell[data-col-id="${field}"]`)!;
}

/**
 * Fire a `pointerover` event that bubbles. The controller listens via
 * delegated `pointerover` on the root, with `relatedTarget` guards.
 */
function firePointerOver(
  target: HTMLElement,
  relatedTarget?: HTMLElement | null,
): void {
  target.dispatchEvent(
    new PointerEvent("pointerover", {
      bubbles: true,
      relatedTarget: relatedTarget ?? null,
    }),
  );
}

/**
 * Fire a `pointerout` event that bubbles.
 */
function firePointerOut(
  target: HTMLElement,
  relatedTarget?: HTMLElement | null,
): void {
  target.dispatchEvent(
    new PointerEvent("pointerout", {
      bubbles: true,
      relatedTarget: relatedTarget ?? null,
    }),
  );
}

/**
 * Fire a `mouseover` event that bubbles.
 */
function fireMouseOver(
  target: HTMLElement,
  relatedTarget?: HTMLElement | null,
): void {
  target.dispatchEvent(
    new MouseEvent("mouseover", {
      bubbles: true,
      relatedTarget: relatedTarget ?? null,
    }),
  );
}

/**
 * Fire a `mouseout` event that bubbles.
 */
function fireMouseOut(
  target: HTMLElement,
  relatedTarget?: HTMLElement | null,
): void {
  target.dispatchEvent(
    new MouseEvent("mouseout", {
      bubbles: true,
      relatedTarget: relatedTarget ?? null,
    }),
  );
}

function fireFocusIn(target: HTMLElement): void {
  target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

function fireFocusOut(target: HTMLElement): void {
  target.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

function advanceTimers(ms: number): void {
  vi.advanceTimersByTime(ms);
}

function getTooltipElement(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".lfg-tooltip");
}

// ── Tests ──────────────────────────────────────────────────────

describe("TooltipController", () => {
  let harness: Harness;

  afterEach(() => {
    harness.controller.detach();
    harness.root.remove();
    vi.useRealTimers();
  });

  // ── No tooltip config ───────────────────────────────────────

  it("does not open tooltip when column has no tooltip config", () => {
    vi.useFakeTimers();
    harness = createHarness(); // no tooltip config on any column
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);

    expect(getTooltipElement(harness.root)).toBeNull();
  });

  // ── tooltip: true ───────────────────────────────────────────

  it("tooltip: true opens formatted value on truncated cell hover", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltip: true }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    const cell = getCell(row, "name");
    Object.defineProperty(cell, "scrollWidth", { value: 200, configurable: true });
    Object.defineProperty(cell, "clientWidth", { value: 100, configurable: true });

    firePointerOver(cell);
    advanceTimers(SHOW_DELAY + 50);

    const tooltip = getTooltipElement(harness.root);
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe("Alice");
  });

  it("publishes role and a composed target description relationship", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "Help" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);
    const cell = getCell(row, "name");
    cell.setAttribute(
      "aria-describedby",
      "application-help   secondary-help",
    );

    firePointerOver(cell);
    advanceTimers(SHOW_DELAY + 50);

    const tooltip = getTooltipElement(harness.root);
    expect(tooltip?.getAttribute("role")).toBe("tooltip");
    expect(tooltip?.id).toMatch(/^lfg-tooltip-[1-9]\d*$/);
    expect(tooltip?.isConnected).toBe(true);
    expect(tooltip?.hasAttribute("tabindex")).toBe(false);
    expect(cell.getAttribute("aria-describedby")).toBe(
      `application-help   secondary-help ${tooltip!.id}`,
    );

    firePointerOut(cell, harness.root);
    expect(cell.getAttribute("aria-describedby")).toBe(
      "application-help   secondary-help",
    );
  });

  it("tooltip: true does not open for non-truncated cell", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltip: true }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    const cell = getCell(row, "name");
    Object.defineProperty(cell, "scrollWidth", { value: 100, configurable: true });
    Object.defineProperty(cell, "clientWidth", { value: 100, configurable: true });

    firePointerOver(cell);
    advanceTimers(SHOW_DELAY + 50);

    expect(getTooltipElement(harness.root)).toBeNull();
  });

  // ── tooltipValueGetter ──────────────────────────────────────

  it("tooltipValueGetter opens custom text even if not truncated", () => {
    vi.useFakeTimers();
    harness = createHarness([
      {},
      { tooltipValueGetter: () => "Custom tip for name" },
      {},
    ]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    const cell = getCell(row, "name");
    Object.defineProperty(cell, "scrollWidth", { value: 100, configurable: true });
    Object.defineProperty(cell, "clientWidth", { value: 100, configurable: true });

    firePointerOver(cell);
    advanceTimers(SHOW_DELAY + 50);

    const tooltip = getTooltipElement(harness.root);
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe("Custom tip for name");
  });

  // ── Empty tooltip result ─────────────────────────────────────

  it("empty tooltip result does not open", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);

    expect(getTooltipElement(harness.root)).toBeNull();
  });

  it("propagates getter failures without retaining pending owner state", () => {
    vi.useFakeTimers();
    const failure = new Error("tooltip getter failed");
    harness = createHarness([
      {},
      {
        tooltipValueGetter: () => {
          throw failure;
        },
      },
      {},
    ]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);
    const cell = getCell(row, "name");

    firePointerOver(cell);
    expect(() => advanceTimers(SHOW_DELAY + 50)).toThrow(failure);
    expect(getTooltipElement(harness.root)).toBeNull();
    expect(cell.hasAttribute("aria-describedby")).toBe(false);

    harness.columns[1]!.tooltipValueGetter = () => "recovered";
    firePointerOut(cell, harness.root);
    firePointerOver(cell, harness.root);
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)?.textContent).toBe("recovered");
  });

  // ── textContent safety ──────────────────────────────────────

  it("tooltip uses textContent, not innerHTML", () => {
    vi.useFakeTimers();
    harness = createHarness([
      {},
      { tooltipValueGetter: () => "<b>XSS</b>" },
      {},
    ]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);

    const tooltip = getTooltipElement(harness.root);
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe("<b>XSS</b>");
    expect(tooltip!.querySelector("b")).toBeNull();
  });

  // ── Close on pointer out ────────────────────────────────────

  it("tooltip closes on pointer out", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    const cell = getCell(row, "name");
    firePointerOver(cell);
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)).not.toBeNull();

    // Pointer leaves cell to root (relatedTarget is root, outside cell).
    firePointerOut(cell, harness.root);
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  it("pointer moving within the same cell does not close tooltip", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    const cell = getCell(row, "name");
    // Add a child inside the cell.
    const span = document.createElement("span");
    span.textContent = "child";
    cell.appendChild(span);

    firePointerOver(cell);
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)).not.toBeNull();

    // Pointer moves from cell to its child — relatedTarget guard prevents close.
    firePointerOut(cell, span);
    expect(getTooltipElement(harness.root)).not.toBeNull();
  });

  it("remains open while moving between the cell and tooltip", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);
    const cell = getCell(row, "name");

    firePointerOver(cell);
    advanceTimers(SHOW_DELAY + 50);
    const tooltip = getTooltipElement(harness.root)!;

    firePointerOut(cell, tooltip);
    firePointerOver(tooltip, cell);
    expect(getTooltipElement(harness.root)).toBe(tooltip);

    firePointerOut(tooltip, cell);
    firePointerOver(cell, tooltip);
    expect(getTooltipElement(harness.root)).toBe(tooltip);

    firePointerOut(cell, harness.root);
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  // ── Close on scroll ─────────────────────────────────────────

  it("tooltip closes on scroll", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)).not.toBeNull();

    harness.viewport.dispatchEvent(new Event("scroll"));
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  // ── Close on Escape ─────────────────────────────────────────

  it("tooltip closes on Escape", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)).not.toBeNull();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  it("Escape dismisses a focus tooltip without moving grid focus", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);
    const cell = getCell(row, "name");
    cell.tabIndex = -1;
    cell.focus();
    advanceTimers(SHOW_DELAY + 50);

    expect(document.activeElement).toBe(cell);
    expect(getTooltipElement(harness.root)).not.toBeNull();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(document.activeElement).toBe(cell);
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  it("keeps the tooltip while either focus or pointer ownership remains", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);
    const cell = getCell(row, "name");

    fireFocusIn(cell);
    firePointerOver(cell);
    advanceTimers(SHOW_DELAY + 50);
    fireFocusOut(cell);
    expect(getTooltipElement(harness.root)).not.toBeNull();

    const tooltip = getTooltipElement(harness.root)!;
    firePointerOut(cell, tooltip);
    firePointerOver(tooltip, cell);
    expect(getTooltipElement(harness.root)).toBe(tooltip);

    firePointerOut(tooltip, harness.root);
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  // ── Replace on hover to different cell ──────────────────────

  it("opening another tooltip closes/replaces previous", () => {
    vi.useFakeTimers();
    harness = createHarness([
      { tooltipValueGetter: () => "tip-id" },
      { tooltipValueGetter: () => "tip-name" },
      {},
    ]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    firePointerOver(getCell(row, "id"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)?.textContent).toBe("tip-id");

    // Move to second cell (relatedTarget is the first cell).
    firePointerOver(getCell(row, "name"), getCell(row, "id"));
    advanceTimers(SHOW_DELAY + 50);

    const tooltips = harness.root.querySelectorAll(".lfg-tooltip");
    expect(tooltips.length).toBe(1);
    expect(tooltips[0]!.textContent).toBe("tip-name");
  });

  it("moves the generated relationship from the prior target on replacement", () => {
    vi.useFakeTimers();
    harness = createHarness([
      { tooltipValueGetter: () => "tip-id" },
      { tooltipValueGetter: () => "tip-name" },
      {},
    ]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);
    const first = getCell(row, "id");
    const second = getCell(row, "name");
    first.setAttribute("aria-describedby", "first-help");
    second.setAttribute("aria-describedby", "second-help");

    firePointerOver(first);
    advanceTimers(SHOW_DELAY + 50);
    const tooltipId = getTooltipElement(harness.root)!.id;

    firePointerOver(second, first);
    advanceTimers(SHOW_DELAY + 50);

    expect(first.getAttribute("aria-describedby")).toBe("first-help");
    expect(second.getAttribute("aria-describedby")).toBe(
      `second-help ${tooltipId}`,
    );
  });

  it("removes a published relationship when floating positioning fails", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);
    const cell = getCell(row, "name");
    cell.setAttribute("aria-describedby", "application-help");
    const failure = new Error("position failed");
    const position = vi
      .spyOn(FloatingPositioner.prototype, "position")
      .mockImplementation(() => {
        throw failure;
      });

    firePointerOver(cell);
    expect(() => advanceTimers(SHOW_DELAY + 50)).toThrow(failure);

    expect(getTooltipElement(harness.root)).toBeNull();
    expect(cell.getAttribute("aria-describedby")).toBe("application-help");
    position.mockRestore();
  });

  // ── Focus in/out ────────────────────────────────────────────

  it("tooltip opens on focusin and closes on focusout", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "focus-tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    const cell = getCell(row, "name");
    fireFocusIn(cell);
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)?.textContent).toBe("focus-tip");

    fireFocusOut(cell);
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  // ── Pinned columns ──────────────────────────────────────────

  it("works for pinned-left cells", () => {
    vi.useFakeTimers();
    harness = createHarness([
      { pinned: "left", tooltipValueGetter: () => "pinned-left-tip" },
      {},
      {},
    ]);
    const row = buildPinnedRow("1", 0, ["id"], "left");
    harness.root.appendChild(row);

    firePointerOver(getCell(row, "id"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)?.textContent).toBe("pinned-left-tip");
  });

  it("works for pinned-right cells", () => {
    vi.useFakeTimers();
    harness = createHarness([
      {},
      {},
      { pinned: "right", tooltipValueGetter: () => "pinned-right-tip" },
    ]);
    const row = buildPinnedRow("1", 0, ["amount"], "right");
    harness.root.appendChild(row);

    firePointerOver(getCell(row, "amount"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)?.textContent).toBe("pinned-right-tip");
  });

  // ── Row-pinned rows ─────────────────────────────────────────

  it("works for row-pinned top/bottom center cells", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "row-pin-tip" }, {}]);

    const layer = document.createElement("div");
    layer.className = "lfg-row-pinned-top-layer";
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    layer.appendChild(row);
    harness.root.appendChild(layer);

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)?.textContent).toBe("row-pin-tip");
  });

  it("works for row-pinned bottom left sub-lane cells", () => {
    vi.useFakeTimers();
    harness = createHarness([
      { tooltipValueGetter: () => "bottom-left-tip" },
      {},
      {},
    ]);

    const layer = document.createElement("div");
    layer.className = "lfg-row-pinned-bottom-left-layer";
    const row = buildPinnedRow("1", 0, ["id"], "left");
    layer.appendChild(row);
    harness.root.appendChild(layer);

    firePointerOver(getCell(row, "id"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)?.textContent).toBe("bottom-left-tip");
  });

  // ── Delegated listeners ─────────────────────────────────────

  it("uses delegated listeners, not per-cell", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);

    const row1 = buildRow("1", 0, ["id", "name", "amount"]);
    const row2 = buildRow("2", 1, ["id", "name", "amount"]);
    harness.root.appendChild(row1);
    harness.root.appendChild(row2);

    const spy = vi.spyOn(getCell(row1, "name"), "addEventListener");
    firePointerOver(getCell(row1, "name"));
    advanceTimers(SHOW_DELAY + 50);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("performs no tooltip resolution for continuous scroll without an open tooltip", () => {
    vi.useFakeTimers();
    const getter = vi.fn(() => "tip");
    harness = createHarness([{}, { tooltipValueGetter: getter }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    for (let index = 0; index < 2_000; index += 1) {
      harness.viewport.dispatchEvent(new Event("scroll"));
    }
    advanceTimers(SHOW_DELAY + 50);

    expect(getter).not.toHaveBeenCalled();
    expect(harness.resolveRowId).not.toHaveBeenCalled();
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  // ── Selection/action columns excluded ───────────────────────

  it("does not open tooltip on selection column", () => {
    vi.useFakeTimers();
    const columns: ColumnDef[] = [
      { field: "__lfg_selection__", internal: "selection", tooltip: true },
      { field: "name", tooltipValueGetter: () => "tip" },
    ];
    const data = makeData();
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);
    document.body.appendChild(root);

    const controller = new TooltipController({
      gridRoot: root,
      viewport,
      getColumns: () => columns,
      getDisplayRows: () => createArrayDisplayRowReader(data),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getGridInstance: () => ({} as Grid),
    });
    controller.attach(root);
    harness = { root, viewport, controller, columns, data, resolveRowId: createResolveRowIdMock() };

    const row = buildRow("1", 0, ["__lfg_selection__", "name"]);
    root.appendChild(row);

    firePointerOver(getCell(row, "__lfg_selection__"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(root)).toBeNull();

    controller.detach();
    root.remove();
  });

  it("does not open tooltip on action column", () => {
    vi.useFakeTimers();
    const columns: ColumnDef[] = [
      { field: "__lfg_actions__", cellKind: "actions", tooltip: true },
      { field: "name" },
    ];
    const data = makeData();
    const root = document.createElement("div");
    const viewport = document.createElement("div");
    root.appendChild(viewport);
    document.body.appendChild(root);

    const controller = new TooltipController({
      gridRoot: root,
      viewport,
      getColumns: () => columns,
      getDisplayRows: () => createArrayDisplayRowReader(data),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getGridInstance: () => ({} as Grid),
    });
    controller.attach(root);
    harness = { root, viewport, controller, columns, data, resolveRowId: createResolveRowIdMock() };

    const row = buildRow("1", 0, ["__lfg_actions__", "name"]);
    root.appendChild(row);

    firePointerOver(getCell(row, "__lfg_actions__"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(root)).toBeNull();

    controller.detach();
    root.remove();
  });

  // ── Cleanup ─────────────────────────────────────────────────

  it("cleans up listeners on detach", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    harness.controller.detach();

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  it("detach removes the generated relationship and tooltip DOM only", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);
    const cell = getCell(row, "name");
    cell.setAttribute("aria-describedby", "application-help");
    firePointerOver(cell);
    advanceTimers(SHOW_DELAY + 50);

    harness.controller.detach();

    expect(getTooltipElement(harness.root)).toBeNull();
    expect(cell.getAttribute("aria-describedby")).toBe("application-help");
  });

  // ── Null grid instance ──────────────────────────────────────

  it("does not throw and does not open when grid instance is null", () => {
    vi.useFakeTimers();
    harness = createHarness(
      [{}, { tooltipValueGetter: () => "tip" }, {}],
      { getGridInstance: () => null },
    );
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    // Should not throw.
    expect(() => {
      firePointerOver(getCell(row, "name"));
      advanceTimers(SHOW_DELAY + 50);
    }).not.toThrow();

    expect(getTooltipElement(harness.root)).toBeNull();
  });

  // ── Row lookup performance ──────────────────────────────────

  it("resolveRowId is called exactly once on fast-path (index matches id)", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    harness.resolveRowId.mockClear();

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);

    // Fast path: one resolveRowId call inside resolveRow to verify index→id
    // match. The returned rowId is reused for the tooltip params — no second call.
    expect(harness.resolveRowId.mock.calls.length).toBe(1);
  });

  it("falls back to full scan when data-row-index is stale (after sort)", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);

    // Row DOM says index=0 and id="2", but data[0] is id="1".
    // This simulates a stale DOM attribute after sort/filter.
    const row = buildRow("2", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    harness.resolveRowId.mockClear();

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);

    // Fast-path check (index 0) calls resolveRowId once → mismatch.
    // Fallback scan calls resolveRowId for each row until match at index 1.
    // The matched rowId is reused — no extra final call.
    // Total: 1 (fast-path miss) + 2 (scan finds at index 1) = 3.
    expect(harness.resolveRowId.mock.calls.length).toBe(3);

    const tooltip = getTooltipElement(harness.root);
    expect(tooltip).not.toBeNull();
    // Should resolve row "2" (Bob) — the tooltip should use Bob's name.
    expect(tooltip!.textContent).toBe("tip");
  });

  // ── Mouse event support ─────────────────────────────────────

  it("tooltip opens from mouseover", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "mouse-tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    fireMouseOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);

    const tooltip = getTooltipElement(harness.root);
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe("mouse-tip");
  });

  it("tooltip closes on mouseout", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    const cell = getCell(row, "name");
    fireMouseOver(cell);
    advanceTimers(SHOW_DELAY + 50);
    expect(getTooltipElement(harness.root)).not.toBeNull();

    fireMouseOut(cell, harness.root);
    expect(getTooltipElement(harness.root)).toBeNull();
  });

  it("tooltipValueGetter opens on mouseover even when not truncated", () => {
    vi.useFakeTimers();
    harness = createHarness([
      {},
      { tooltipValueGetter: () => "custom mouse tip" },
      {},
    ]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    const cell = getCell(row, "name");
    Object.defineProperty(cell, "scrollWidth", { value: 50, configurable: true });
    Object.defineProperty(cell, "clientWidth", { value: 100, configurable: true });

    fireMouseOver(cell);
    advanceTimers(SHOW_DELAY + 50);

    const tooltip = getTooltipElement(harness.root);
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe("custom mouse tip");
  });

  it("does not double-schedule when both pointer and mouse events fire", () => {
    vi.useFakeTimers();
    harness = createHarness([{}, { tooltipValueGetter: () => "tip" }, {}]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);

    const cell = getCell(row, "name");
    // Both events fire for the same cell — only one tooltip should appear.
    firePointerOver(cell);
    fireMouseOver(cell);
    advanceTimers(SHOW_DELAY + 50);

    const tooltips = harness.root.querySelectorAll(".lfg-tooltip");
    expect(tooltips.length).toBe(1);
  });

  it("181: keyboard resolution is deferred, latest-target-wins, and detach-safe", async () => {
    vi.useFakeTimers();
    const firstGetter = vi.fn(() => "first");
    const secondGetter = vi.fn(() => "second");
    harness = createHarness([
      { tooltipValueGetter: firstGetter },
      { tooltipValueGetter: secondGetter },
      {},
    ]);
    const row = buildRow("1", 0, ["id", "name", "amount"]);
    harness.root.appendChild(row);
    const first = getCell(row, "id");
    const second = getCell(row, "name");

    harness.controller.requestTooltipForKeyboardTarget(first);
    harness.controller.requestTooltipForKeyboardTarget(second);
    expect(firstGetter).not.toHaveBeenCalled();
    expect(secondGetter).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(firstGetter).not.toHaveBeenCalled();
    expect(secondGetter).not.toHaveBeenCalled();
    advanceTimers(SHOW_DELAY + 50);
    expect(firstGetter).not.toHaveBeenCalled();
    expect(secondGetter).toHaveBeenCalledOnce();
    expect(getTooltipElement(harness.root)?.textContent).toBe("second");

    harness.controller.requestTooltipForKeyboardTarget(first);
    harness.controller.detach();
    await Promise.resolve();
    advanceTimers(SHOW_DELAY + 50);
    expect(firstGetter).not.toHaveBeenCalled();
  });
});

// ── DisplayRowReader sorted display order ────────────────────────

describe("tooltip — DisplayRowReader sorted display order", () => {
  let root: HTMLElement;
  let viewport: HTMLElement;
  let controller: TooltipController;

  afterEach(() => {
    controller.detach();
    root.remove();
    vi.useRealTimers();
  });

  it("resolves sorted display row and display index after sort", () => {
    vi.useFakeTimers();
    // Source rows: Alice(id=1), Bob(id=2).
    // Display order after sort: Bob at display 0, Alice at display 1.
    const sourceRows: RowData[] = [
      { id: "1", name: "Alice", amount: 100 },
      { id: "2", name: "Bob", amount: -50 },
    ];
    const sortedDisplayRows: RowData[] = [sourceRows[1]!, sourceRows[0]!];

    root = document.createElement("div");
    viewport = document.createElement("div");
    root.appendChild(viewport);
    document.body.appendChild(root);

    const tooltipValueGetter = vi.fn(
      (params: { row: RowData; rowIndex: number; rowId: string }) =>
        `tip:${(params.row as Record<string, unknown>).name}@${params.rowIndex}`,
    );

    controller = new TooltipController({
      gridRoot: root,
      viewport,
      getColumns: () => [
        { field: "id" },
        { field: "name", tooltipValueGetter },
        { field: "amount" },
      ],
      getDisplayRows: () => createArrayDisplayRowReader(sortedDisplayRows),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getGridInstance: () => ({} as Grid),
    });
    controller.attach(root);

    // DOM row says display index 0, id "2" (Bob — first in sorted order).
    const row = buildRow("2", 0, ["id", "name", "amount"]);
    root.appendChild(row);

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);

    expect(tooltipValueGetter).toHaveBeenCalledTimes(1);
    const params = tooltipValueGetter.mock.calls[0]![0];
    // rowIndex should be the DISPLAY index (0), not the source index (1).
    expect(params.rowIndex).toBe(0);
    expect(params.rowId).toBe("2");
    expect(params.row).toBe(sourceRows[1]); // Bob

    const tooltip = getTooltipElement(root);
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toBe("tip:Bob@0");
  });

  it("stale DOM row-id mismatch returns null — no tooltip opens", () => {
    vi.useFakeTimers();
    const data: RowData[] = [
      { id: "1", name: "Alice", amount: 100 },
    ];

    root = document.createElement("div");
    viewport = document.createElement("div");
    root.appendChild(viewport);
    document.body.appendChild(root);

    const tooltipValueGetter = vi.fn(() => "should not appear");

    controller = new TooltipController({
      gridRoot: root,
      viewport,
      getColumns: () => [
        { field: "id" },
        { field: "name", tooltipValueGetter },
        { field: "amount" },
      ],
      getDisplayRows: () => createArrayDisplayRowReader(data),
      resolveRowId: (row) => String((row as Record<string, unknown>).id),
      getGridInstance: () => ({} as Grid),
    });
    controller.attach(root);

    // DOM row has id "deleted-row" that doesn't exist in display rows.
    const row = buildRow("deleted-row", 0, ["id", "name", "amount"]);
    root.appendChild(row);

    firePointerOver(getCell(row, "name"));
    advanceTimers(SHOW_DELAY + 50);

    // No tooltip should open — row not found in display rows.
    expect(getTooltipElement(root)).toBeNull();
    expect(tooltipValueGetter).not.toHaveBeenCalled();
  });
});
