import type {
  CellMenuActionContext,
  CellMenuOptions,
} from "@lightfastgrid/core";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { CellMenuCustomPanel } from "./CellMenuCustomPanel.tsx";

/**
 * Per-cell menu demo: copy actions plus a small React panel (links + status).
 * Hover ⋮ or right-click a body cell.
 */
export function createGridDemoCellMenu(): CellMenuOptions {
  return {
    enabled: true,
    trigger: "contextmenu-and-button",
    placement: "bottom-end",
    triggerButton: {
      icon: "⋮",
      ariaLabel: "Open cell menu",
      className: "grid-demo-cell-menu-trigger",
      placement: "right-center",
    },
    getActions: () => [
      {
        id: "copy-cell",
        label: "Copy cell",
        icon: "⧉",
      },
      {
        id: "copy-row",
        label: "Copy row JSON",
        icon: "{}",
      },
    ],
    onAction: ({
      actionId,
      row,
      value,
      close,
    }: CellMenuActionContext) => {
      switch (actionId) {
        case "copy-cell":
          void navigator.clipboard.writeText(String(value ?? ""));
          break;
        case "copy-row":
          void navigator.clipboard.writeText(JSON.stringify(row));
          break;
      }
      close();
    },
    renderPanel: (host, ctx) => {
      const root: Root = createRoot(host);
      root.render(createElement(CellMenuCustomPanel, ctx));
      return () => {
        root.unmount();
      };
    },
  };
}
