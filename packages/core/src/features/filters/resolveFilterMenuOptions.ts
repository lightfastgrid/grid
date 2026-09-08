import type { ColumnMenuOptions, FilterMenuPlacement } from "../../types";

export interface ResolvedFilterMenuOptions {
  conditionMainMenu: boolean;
  conditionDedicatedMenu: boolean;
  selectionMainMenu: boolean;
  selectionDedicatedMenu: boolean;
}

const NONE: ResolvedFilterMenuOptions = {
  conditionMainMenu: false,
  conditionDedicatedMenu: false,
  selectionMainMenu: false,
  selectionDedicatedMenu: false,
};

function expandPlacement(p: FilterMenuPlacement): { mainMenu: boolean; dedicatedMenu: boolean } {
  return {
    mainMenu: p === "mainMenu" || p === "both",
    dedicatedMenu: p === "dedicatedMenu" || p === "both",
  };
}

function isFilterHiddenBySectionMode(menuOptions: ColumnMenuOptions): boolean {
  const hasBuiltinKeys =
    "sort" in menuOptions ||
    "filter" in menuOptions ||
    "pinning" in menuOptions ||
    "visibility" in menuOptions ||
    "sizing" in menuOptions;

  if (!hasBuiltinKeys) {
    return typeof menuOptions.sections === "function";
  }

  return !("filter" in menuOptions);
}

const DEFAULT_MAIN_MENU: ResolvedFilterMenuOptions = {
  conditionMainMenu: true,
  conditionDedicatedMenu: false,
  selectionMainMenu: true,
  selectionDedicatedMenu: false,
};

export function resolveFilterMenuOptions(
  menuOptions: ColumnMenuOptions | undefined,
): ResolvedFilterMenuOptions {
  if (menuOptions === undefined) return DEFAULT_MAIN_MENU;
  const runtimeOptions: unknown = menuOptions;
  if (typeof runtimeOptions !== "object" || runtimeOptions === null) return NONE;
  if (menuOptions.enabled === false) return NONE;

  const filterOpt = menuOptions.filter;

  if (filterOpt === false) return NONE;

  if (isFilterHiddenBySectionMode(menuOptions)) return NONE;

  if (filterOpt === true || filterOpt === undefined) {
    const placement = menuOptions.filterPlacement ?? "mainMenu";
    const { mainMenu, dedicatedMenu } = expandPlacement(placement);
    return {
      conditionMainMenu: mainMenu,
      conditionDedicatedMenu: dedicatedMenu,
      selectionMainMenu: mainMenu,
      selectionDedicatedMenu: dedicatedMenu,
    };
  }

  if (filterOpt.enabled === false) return NONE;

  const condPlacement = filterOpt.placement ?? menuOptions.filterPlacement ?? "mainMenu";
  const { mainMenu: condMain, dedicatedMenu: condDedicated } = expandPlacement(condPlacement);

  const sel = filterOpt.selectionList;
  let selMain: boolean;
  let selDedicated: boolean;

  if (sel === false || (typeof sel === "object" && sel.enabled === false)) {
    selMain = false;
    selDedicated = false;
  } else if (sel === true || sel === undefined) {
    selMain = condMain;
    selDedicated = condDedicated;
  } else {
    const selPlacement = sel.placement ?? condPlacement;
    const expanded = expandPlacement(selPlacement);
    selMain = expanded.mainMenu;
    selDedicated = expanded.dedicatedMenu;
  }

  return {
    conditionMainMenu: condMain,
    conditionDedicatedMenu: condDedicated,
    selectionMainMenu: selMain,
    selectionDedicatedMenu: selDedicated,
  };
}

export function hasMainMenu(resolved: ResolvedFilterMenuOptions): boolean {
  return resolved.conditionMainMenu || resolved.selectionMainMenu;
}

export function hasDedicatedMenu(resolved: ResolvedFilterMenuOptions): boolean {
  return resolved.conditionDedicatedMenu || resolved.selectionDedicatedMenu;
}
