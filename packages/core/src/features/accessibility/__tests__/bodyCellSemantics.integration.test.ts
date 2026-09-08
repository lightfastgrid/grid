// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { ROW_HEIGHT } from "../../../rendering/helpers/gridConstants";
import type {
  CellAccessibilityParams,
  LightFastGridProps,
  RowData,
} from "../../../types";

async function flushRenders(): Promise<void> {
  // End-of-scroll arming is scrollend-driven; dispatch then drain quiet frames.
  for (const viewport of document.querySelectorAll(".lfg-viewport")) {
    viewport.dispatchEvent(new Event("scrollend"));
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function bodyCell(
  container: HTMLElement,
  rowId: string,
  field: string,
): HTMLElement {
  const cell = container.querySelector<HTMLElement>(
    `[data-row-id="${rowId}"] .lfg-cell[data-col-id="${field}"]`,
  );
  expect(cell).not.toBeNull();
  return cell!;
}

describe("Section 6 mounted body-cell semantics", () => {
  let grid: Grid | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    grid?.destroy();
    container?.remove();
    grid = null;
    container = null;
  });

  async function mount(props: LightFastGridProps): Promise<void> {
    container = document.createElement("div");
    Object.assign(container.style, { height: "220px", width: "520px" });
    document.body.appendChild(container);
    grid = new Grid(props);
    grid.mount(container);
    await flushRenders();
    await flushRenders();
  }

  it("uses the existing formatted display value without re-entering the value pipeline", async () => {
    const valueGetter = vi.fn(
      ({ row }: { row: RowData }) => row.amount,
    );
    const valueFormatter = vi.fn(
      ({ value }: { value: unknown }) => `$${String(value)}`,
    );
    const getCellAriaLabel = vi.fn(
      ({ formattedValue }: CellAccessibilityParams) =>
        `Balance ${formattedValue}`,
    );
    await mount({
      rows: [{ id: "r0", amount: 42 }],
      columns: [{
        field: "amount",
        headerName: "Amount",
        valueGetter,
        valueFormatter,
        getCellAriaLabel,
        cellAriaDescribedBy: "amount-help",
      }],
      getRowId: (row) => row.id,
      suppressRowVirtualization: true,
    });

    const cell = bodyCell(container!, "r0", "amount");
    expect(cell.textContent).toBe("$42");
    expect(cell.getAttribute("role")).toBe("gridcell");
    expect(cell.getAttribute("aria-colindex")).toBe("1");
    expect(cell.getAttribute("tabindex")).toBe("-1");
    expect(cell.getAttribute("aria-label")).toBe("Balance $42");
    expect(cell.getAttribute("aria-describedby")).toBe("amount-help");
    expect(valueGetter).toHaveBeenCalledTimes(1);
    expect(valueFormatter).toHaveBeenCalledTimes(1);
    expect(getCellAriaLabel).toHaveBeenCalledTimes(1);

    await flushRenders();
    expect(valueGetter).toHaveBeenCalledTimes(1);
    expect(valueFormatter).toHaveBeenCalledTimes(1);
    expect(getCellAriaLabel).toHaveBeenCalledTimes(1);
  });

  it("updates cell selection and active descendant through low-frequency events", async () => {
    await mount({
      rows: [{ id: "r0", a: "A", b: "B" }],
      columns: [{ field: "a" }, { field: "b" }],
      getRowId: (row) => row.id,
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
    });

    const surface = container!.querySelector<HTMLElement>(".lfg-grid-surface")!;
    const a = bodyCell(container!, "r0", "a");
    const b = bodyCell(container!, "r0", "b");
    expect(a.getAttribute("aria-selected")).toBe("false");
    expect(b.getAttribute("aria-selected")).toBe("false");

    grid!.setSelectedColumnIds(["b"]);
    await flushRenders();
    expect(a.getAttribute("aria-selected")).toBe("false");
    expect(b.getAttribute("aria-selected")).toBe("true");

    grid!.setColumnSelection(false);
    await flushRenders();
    await flushRenders();
    expect(a.hasAttribute("aria-selected")).toBe(false);
    expect(b.hasAttribute("aria-selected")).toBe(false);

    a.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
    expect(surface.getAttribute("aria-activedescendant")).toBe(a.id);
    expect(a.classList.contains("lfg-cell-focused")).toBe(true);
    expect(a.id).toMatch(/^lfg-a11y-\d+-cell-\d+$/);

    grid!.clearFocusedCell();
    expect(surface.getAttribute("aria-activedescendant")).toBeNull();
  });

  it("observes accessibility-only default column replacements", async () => {
    const firstLabel = vi.fn(() => "First");
    const secondLabel = vi.fn(() => "Second");
    await mount({
      rows: [{ id: "r0", value: "Visible" }],
      columns: [{ field: "value", headerName: "Value" }],
      defaultColDef: { getCellAriaLabel: firstLabel },
      getRowId: (row) => row.id,
      suppressRowVirtualization: true,
    });
    const cell = bodyCell(container!, "r0", "value");
    expect(cell.getAttribute("aria-label")).toBe("Visible First");

    grid!.setDefaultColDef({ getCellAriaLabel: secondLabel });
    await flushRenders();
    await flushRenders();

    expect(cell.getAttribute("aria-label")).toBe("Visible Second");
    expect(firstLabel).toHaveBeenCalledTimes(1);
    expect(secondLabel).toHaveBeenCalledTimes(1);
  });

  it("keeps physical ids stable through vertical recycling and writes only after settle", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `r${index}`,
      value: `Value ${index}`,
    }));
    await mount({
      rows,
      columns: [{ field: "value", headerName: "Value" }],
      getRowId: (row) => row.id,
    });

    const root = container!.querySelector<HTMLElement>(".lfg-grid")!;
    const viewport = root.querySelector<HTMLElement>(".lfg-viewport")!;
    const cell = root.querySelector<HTMLElement>(
      ".lfg-row[data-row-id] .lfg-cell[data-col-id='value']",
    )!;
    const physicalId = cell.id;
    const setAttribute = vi.spyOn(cell, "setAttribute");
    const removeAttribute = vi.spyOn(cell, "removeAttribute");

    viewport.scrollTop = 35 * ROW_HEIGHT;
    for (let index = 0; index < 2_000; index += 1) {
      viewport.dispatchEvent(new Event("scroll"));
    }
    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();

    await flushRenders();
    await flushRenders();
    expect(cell.id).toBe(physicalId);
    expect(cell.getAttribute("role")).toBe("gridcell");
    expect(cell.getAttribute("aria-label")).toMatch(/^Value: Value \d+$/);

    setAttribute.mockClear();
    removeAttribute.mockClear();
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();
    await flushRenders();
    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("uses unique physical ids across grid instances", async () => {
    await mount({
      rows: [{ id: "r0", value: "A" }],
      columns: [{ field: "value" }],
      getRowId: (row) => row.id,
      suppressRowVirtualization: true,
    });
    const firstId = bodyCell(container!, "r0", "value").id;
    grid!.destroy();
    container!.remove();
    grid = null;
    container = null;

    await mount({
      rows: [{ id: "r0", value: "A" }],
      columns: [{ field: "value" }],
      getRowId: (row) => row.id,
      suppressRowVirtualization: true,
    });
    expect(bodyCell(container!, "r0", "value").id).not.toBe(firstId);
  });
});
