import type { ColumnMenuOptions } from "../../types";

export type ColumnMenuSectionKey = "sort" | "filter" | "pinning" | "visibility" | "sizing";

export interface ColumnMenuSectionMode<T extends object> {
  hidden: boolean;
  showAll: boolean;
  itemOptions?: T;
}

/**
 * Section resolution contract:
 * - menu omitted (`undefined`) => default-all for all built-in sections
 * - menu provided with no built-in keys and no `sections` => default-all
 *   (e.g. `{}` or `{ enabled: true }`)
 * - menu provided with only `sections` => built-ins hidden (custom-only mode)
 * - when at least one built-in section key is present => built-ins are allow-list based
 *   - omitted/false section => hidden
 *   - true section => show all section items
 *   - object section => explicit allow-list (only `=== true` item keys)
 */
export function resolveColumnMenuSectionMode<T extends object>(
  menuOptions: ColumnMenuOptions | undefined,
  sectionKey: ColumnMenuSectionKey,
): ColumnMenuSectionMode<T> {
  if (menuOptions === undefined) {
    return { hidden: false, showAll: true };
  }

  const hasBuiltinKeys =
    Object.prototype.hasOwnProperty.call(menuOptions, "sort") ||
    Object.prototype.hasOwnProperty.call(menuOptions, "filter") ||
    Object.prototype.hasOwnProperty.call(menuOptions, "pinning") ||
    Object.prototype.hasOwnProperty.call(menuOptions, "visibility") ||
    Object.prototype.hasOwnProperty.call(menuOptions, "sizing");

  if (!hasBuiltinKeys) {
    if (typeof menuOptions.sections === "function") {
      return { hidden: true, showAll: false };
    }
    return { hidden: false, showAll: true };
  }

  const sectionConfig = menuOptions[sectionKey];
  if (sectionConfig === undefined || sectionConfig === false) {
    return { hidden: true, showAll: false };
  }
  if (sectionConfig === true) {
    return { hidden: false, showAll: true };
  }

  return {
    hidden: false,
    showAll: false,
    itemOptions: sectionConfig as T,
  };
}

export function isColumnMenuSectionItemEnabled<T extends object>(
  mode: ColumnMenuSectionMode<T>,
  key: keyof T,
): boolean {
  if (mode.hidden) return false;
  if (mode.showAll) return true;
  return mode.itemOptions?.[key] === true;
}
