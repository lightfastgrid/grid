import type { ColumnDef } from "../types";

export type HeaderControlLayoutRole = "action" | "menu";

export interface HeaderControlDescriptor {
  id: string;
  layoutRole?: HeaderControlLayoutRole;
  className: string;
  ariaLabel: string;
  ariaHaspopup?: string;
  ariaExpanded?: string;
  textContent?: string;
  disabled?: boolean;
  dataset?: Record<string, string>;
}

export type ResolveHeaderControls = (col: ColumnDef) => HeaderControlDescriptor[];
