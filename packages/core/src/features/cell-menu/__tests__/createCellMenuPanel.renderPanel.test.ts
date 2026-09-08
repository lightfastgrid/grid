// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { CellMenuContext, ColumnDef, RowData } from "../../../types";
import { createCellMenuPanel } from "../createCellMenuPanel";

function makeCtx(): CellMenuContext {
  const row: RowData = { id: "r1", name: "Ada", email: "ada@example.com" };
  const column: ColumnDef = { field: "name", headerName: "Name" };
  return {
    row,
    rowIndex: 0,
    rowId: "r1",
    column,
    field: "name",
    value: "Ada",
    grid: { getRows: () => [row] },
  };
}

describe("createCellMenuPanel renderPanel", () => {
  it("uses role=menu with menuitem semantics for descriptor-only panels", () => {
    const panel = createCellMenuPanel(
      [{ id: "copy-cell", label: "Copy cell", icon: "⧉" }],
      makeCtx(),
      vi.fn(),
      vi.fn(),
      "lfg-popup-cell-menu-1",
    );

    expect(panel.element.getAttribute("role")).toBe("menu");
    expect(panel.element.hasAttribute("aria-modal")).toBe(false);
    expect(
      panel.element.querySelector('[data-menu-action="copy-cell"]')?.getAttribute("role"),
    ).toBe("menuitem");
    panel.cleanup();
  });

  it("uses role=dialog without menuitem semantics when renderPanel is present", () => {
    const cleanup = vi.fn();
    const panel = createCellMenuPanel(
      [{ id: "copy-cell", label: "Copy cell", icon: "⧉" }],
      makeCtx(),
      vi.fn(),
      vi.fn(),
      "lfg-popup-cell-menu-1",
      undefined,
      (host, ctx) => {
        const link = document.createElement("a");
        link.href = `mailto:${String(ctx.row.email ?? "")}`;
        link.textContent = "Email";
        host.appendChild(link);
        return cleanup;
      },
    );

    expect(panel.element.getAttribute("role")).toBe("dialog");
    expect(panel.element.getAttribute("aria-modal")).toBe("false");
    expect(
      panel.element.querySelector('[data-menu-action="copy-cell"]')?.hasAttribute("role"),
    ).toBe(false);
    expect(panel.element.querySelector('a[href="mailto:ada@example.com"]')).toBeTruthy();

    panel.cleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("opens with renderPanel only (no actions)", () => {
    const panel = createCellMenuPanel(
      [],
      makeCtx(),
      vi.fn(),
      vi.fn(),
      "lfg-popup-cell-menu-2",
      undefined,
      (host) => {
        host.textContent = "links-only";
      },
    );
    expect(panel.element.getAttribute("role")).toBe("dialog");
    expect(panel.element.textContent).toContain("links-only");
    panel.cleanup();
  });

  it("rejects duplicate action ids within one open menu", () => {
    expect(() =>
      createCellMenuPanel(
        [
          { id: "copy", label: "Copy A" },
          { id: "copy", label: "Copy B" },
        ],
        makeCtx(),
        vi.fn(),
        vi.fn(),
        "lfg-popup-cell-menu-dup",
      ),
    ).toThrow(/unique within one open menu/i);
  });
});
