// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import type { LightFastGridColumnInput, LightFastGridProps, RowData } from "../../../types";
import {
  GROUP_HEADER_ROW_CLASS,
} from "..";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function createGrid(props: Partial<LightFastGridProps> = {}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "400px", width: "800px" });
  document.body.appendChild(container);

  const rows: RowData[] = [
    { id: "1", name: "Alice", email: "a@x.com", bank: 10, rating: 5 },
    { id: "2", name: "Bob", email: "b@x.com", bank: 20, rating: 4 },
  ];

  const columns: LightFastGridColumnInput[] = [
    {
      headerName: "Profile",
      children: [
        { field: "name", headerName: "Name" },
        { field: "email", headerName: "Email" },
      ],
    },
    {
      headerName: "Finance",
      children: [
        { field: "bank", headerName: "Bank" },
        { field: "rating", headerName: "Rating" },
      ],
    },
  ];

  const grid = new Grid({
    columns,
    rows,
    getRowId: (row: RowData) => String(row.id),
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    ...props,
  });
  grid.mount(container);
  await flushRenders();
  return { grid, container };
}

describe("Phase 3A infrastructure still holds with Phase 3B group rows", () => {
  it("still renders leaf labels; group rows are feature-owned siblings before leaf", async () => {
    const { grid, container } = await createGrid();
    const root = container.querySelector<HTMLElement>(".lfg-grid")!;

    const labels = Array.from(root.querySelectorAll(".lfg-header-label")).map(
      (el) => el.textContent!.trim(),
    );
    expect(labels).toEqual(expect.arrayContaining(["Name", "Email", "Bank", "Rating"]));

    const header = root.querySelector(".lfg-header")!;
    const groupRow = header.querySelector(`.${GROUP_HEADER_ROW_CLASS}`);
    const leafRow = header.querySelector(".lfg-header-row");
    expect(groupRow).toBeTruthy();
    expect(leafRow).toBeTruthy();
    expect(groupRow!.nextElementSibling === leafRow || groupRow!.compareDocumentPosition(leafRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("still attaches floating filters after the leaf header row", async () => {
    const { grid, container } = await createGrid({
      floatingFilters: true,
      defaultColDef: { filterable: true },
    });
    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const headerRow = root.querySelector(".lfg-header-row");
    const floating = headerRow?.nextElementSibling;

    expect(floating?.classList.contains("lfg-floating-filter-row")).toBe(true);

    grid.destroy();
    container.remove();
  });
});
