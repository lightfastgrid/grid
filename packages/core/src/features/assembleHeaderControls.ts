import type { HeaderControlDescriptor, ResolveHeaderControls } from "../rendering/headerControlTypes";
import type { ColumnDef, ColumnMenuOptions, HeaderControlKind } from "../types";

import { menuHeaderControl } from "./column-menu/menuHeaderControl";
import { filterHeaderControl } from "./filters/filterHeaderControl";
import { headerActionHeaderControls } from "./header-actions/headerActionHeaderControl";

const DEFAULT_ORDER: HeaderControlKind[] = [
  "headerActions",
  "columnFilter",
  "columnMenu",
];

const VALID_KINDS = new Set<HeaderControlKind>(["headerActions", "columnMenu", "columnFilter"]);

function resolveOrder(col: ColumnDef): HeaderControlKind[] {
  const configured = col.headerControls?.order;
  if (!configured || configured.length === 0) return DEFAULT_ORDER;

  const seen = new Set<HeaderControlKind>();
  const out: HeaderControlKind[] = [];
  for (const item of configured) {
    if (!VALID_KINDS.has(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function resolveAll(
  col: ColumnDef,
  menuOptions?: ColumnMenuOptions,
): Map<HeaderControlKind, HeaderControlDescriptor[]> {
  const map = new Map<HeaderControlKind, HeaderControlDescriptor[]>();

  const actions = headerActionHeaderControls(col);
  if (actions.length > 0) map.set("headerActions", actions);

  const filter = filterHeaderControl(col, menuOptions);
  if (filter) map.set("columnFilter", [filter]);

  const menu = menuHeaderControl(col, menuOptions);
  if (menu) map.set("columnMenu", [menu]);

  return map;
}

export function assembleHeaderControlResolver(
  menuOptions?: ColumnMenuOptions,
): ResolveHeaderControls {
  return (col) => {
    const byKind = resolveAll(col, menuOptions);
    if (byKind.size === 0) return [];

    const ordered: HeaderControlDescriptor[] = [];
    for (const kind of resolveOrder(col)) {
      const items = byKind.get(kind);
      if (items) {
        for (const item of items) ordered.push(item);
      }
    }
    return ordered;
  };
}
