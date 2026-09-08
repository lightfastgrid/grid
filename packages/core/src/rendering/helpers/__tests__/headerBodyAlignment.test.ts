// @vitest-environment jsdom
//
// Focused tests verifying header/body cell alignment stays correct after
// narrow column widths (e.g. post-sizeColumnsToFit). Exercises slot
// binding and CSS geometry variable assignment.
//
// Geometry is driven by CSS custom properties on the grid root:
//   --col-{token}-left  and  --col-{token}-width
// Both header cells and body cells reference these via a shared
// `[data-col-id="field"]` style rule. These tests verify:
//   1. Header/body field order matches in DOM order (not sorted).
//   2. Each matching pair shares the same geometry source (same
//      data-col-id → same CSS variable).
//   3. The CSS variables are set on the root for every visible column.

import { describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import type { LightFastGridColDef, RowData } from "../../../types";
import { CSS } from "../../const/css-classes";
import { fieldToCssToken } from "../columnGeometryVars";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const rows: RowData[] = [
  { id: "r1", name: "Alice", amount: 100 },
  { id: "r2", name: "Bob", amount: 200 },
  { id: "r3", name: "Carol", amount: 300 },
];

function makeGrid(opts: { columns: LightFastGridColDef[] }) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "300px", width: "600px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows,
    columns: opts.columns,
    getRowId: (row) => row.id as string,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
  });
  grid.mount(container);

  const root = (): HTMLElement =>
    container.querySelector(`.${CSS.GRID}`) as HTMLElement;

  return { grid, container, root };
}

/** Visible header cells in DOM order. */
function visibleHeaderFields(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".lfg-header-cell[data-col-id]"),
  )
    .filter((el) => el.style.display !== "none")
    .map((el) => el.getAttribute("data-col-id")!);
}

/** Visible body cells in the first row, in DOM order. */
function visibleBodyFields(root: HTMLElement): string[] {
  const row = root.querySelector(`.${CSS.ROW}[data-row-id="r1"]`);
  if (!row) return [];
  return Array.from(
    row.querySelectorAll<HTMLElement>(`.${CSS.CELL}[data-col-id]`),
  )
    .filter((el) => el.style.display !== "none")
    .map((el) => el.getAttribute("data-col-id")!);
}

describe("header/body alignment after narrow widths", () => {
  it("header and body fields match in DOM order (not sorted)", async () => {
    const { grid, container, root } = makeGrid({
      columns: [
        { field: "id", width: 48 },
        { field: "name", width: 48 },
        { field: "amount", width: 48 },
      ],
    });
    await flushRenders();

    const r = root();
    const headerFields = visibleHeaderFields(r);
    const bodyFields = visibleBodyFields(r);

    // Exact order match — no sorting allowed.
    expect(headerFields).toEqual(bodyFields);

    grid.destroy();
    container.remove();
  });

  it("header and body cells share the same geometry CSS variables per column", async () => {
    const { grid, container, root } = makeGrid({
      columns: [
        { field: "id", width: 48 },
        { field: "name", width: 80 },
        { field: "amount", width: 60 },
      ],
    });
    await flushRenders();

    const r = root();
    const fields = visibleHeaderFields(r);
    expect(fields.length).toBeGreaterThan(0);

    for (const field of fields) {
      const token = fieldToCssToken(field);
      const leftVar = r.style.getPropertyValue(`--col-${token}-left`);
      const widthVar = r.style.getPropertyValue(`--col-${token}-width`);

      // CSS variables must be set on the root for this field.
      expect(leftVar, `--col-${token}-left missing`).not.toBe("");
      expect(widthVar, `--col-${token}-width missing`).not.toBe("");

      // Both header and body cells reference the same data-col-id,
      // so the <style> rule maps them to the same CSS variable pair.
      const headerCell = r.querySelector(
        `.lfg-header-cell[data-col-id="${field}"]`,
      );
      const bodyCell = r.querySelector(
        `.${CSS.ROW}[data-row-id="r1"] .${CSS.CELL}[data-col-id="${field}"]`,
      );
      expect(headerCell, `header cell missing for ${field}`).not.toBeNull();
      expect(bodyCell, `body cell missing for ${field}`).not.toBeNull();

      // Both cells have the same data-col-id → the geometry style rule
      // gives them identical left and width from the same CSS variable.
      expect(headerCell!.getAttribute("data-col-id")).toBe(
        bodyCell!.getAttribute("data-col-id"),
      );
    }

    grid.destroy();
    container.remove();
  });

  it("geometry variables reflect expected widths and offsets", async () => {
    const { grid, container, root } = makeGrid({
      columns: [
        { field: "id", width: 48 },
        { field: "name", width: 80 },
        { field: "amount", width: 60 },
      ],
    });
    await flushRenders();

    const r = root();

    // Verify actual variable values match the column widths/offsets.
    expect(r.style.getPropertyValue("--col-id-left")).toBe("0px");
    expect(r.style.getPropertyValue("--col-id-width")).toBe("48px");
    expect(r.style.getPropertyValue("--col-name-left")).toBe("48px");
    expect(r.style.getPropertyValue("--col-name-width")).toBe("80px");
    expect(r.style.getPropertyValue("--col-amount-left")).toBe("128px");
    expect(r.style.getPropertyValue("--col-amount-width")).toBe("60px");

    grid.destroy();
    container.remove();
  });

  it("action columns with empty header still create header slots", async () => {
    const { grid, container, root } = makeGrid({
      columns: [
        { field: "id", width: 60 },
        { field: "name", width: 60 },
        {
          field: "__lfg_actions__",
          cellKind: "actions",
          actionsKey: "test",
          width: 44,
        },
      ],
    });
    await flushRenders();

    const r = root();
    const actionHeader = r.querySelector(
      '.lfg-header-cell[data-col-id="__lfg_actions__"]',
    ) as HTMLElement | null;
    expect(actionHeader).not.toBeNull();
    expect(actionHeader!.style.display).not.toBe("none");

    // Geometry variable must exist for the action column too.
    expect(
      r.style.getPropertyValue("--col-__lfg_actions__-left"),
    ).not.toBe("");
    expect(
      r.style.getPropertyValue("--col-__lfg_actions__-width"),
    ).toBe("44px");

    grid.destroy();
    container.remove();
  });

  it("no skipped header slots when width is very small", async () => {
    const { grid, container, root } = makeGrid({
      columns: [
        { field: "a", width: 48 },
        { field: "b", width: 48 },
        { field: "c", width: 48 },
        { field: "d", width: 48 },
        { field: "e", width: 48 },
      ],
    });
    await flushRenders();

    const r = root();
    const headerFields = visibleHeaderFields(r);
    const bodyFields = visibleBodyFields(r);

    expect(headerFields).toEqual(["a", "b", "c", "d", "e"]);
    expect(bodyFields).toEqual(["a", "b", "c", "d", "e"]);

    grid.destroy();
    container.remove();
  });
});
