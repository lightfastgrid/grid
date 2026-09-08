import { densityOptionLabel } from "./actions/density/densityOptions.ts";
import { toggleDemoFullscreen } from "./actions/fullscreen/toggleDemoFullscreen.ts";
import { mountDemoQuickSearch } from "./actions/search/DemoQuickSearch.ts";
import { getPanelEntry, type OpenPanelId } from "./panels/panelRegistry.ts";
import { addDemoRows } from "./panels/rows/commands/addDemoRows.ts";
import { el } from "./shell/dom.ts";
import {
  bindFocusStealGuard,
  iconColumns,
  iconDensity,
  iconExport,
  iconFilters,
  iconFullscreen,
  iconPlus,
  iconSettings,
  iconSort,
} from "./shell/ToolbarIcons.ts";
import {
  mountToolbarNavButton,
  mountToolbarPanelHost,
  type ToolbarNavButtonHandle,
  type ToolbarPanelAlign,
} from "./shell/ToolbarNavButton.ts";
import type {
  InteractiveDemoPanelId,
  InteractiveDemoPanelProps,
  InteractiveDemoToolbarProps,
} from "./types.ts";

import "./InteractiveDemoToolbar.css";

export type InteractiveDemoToolbarHandle = {
  setActiveFilterCount: (count: number) => void;
  setActiveSortCount: (count: number) => void;
  setDensity: (density: InteractiveDemoToolbarProps["density"]) => void;
  setFloatingFiltersEnabled: (enabled: boolean) => void;
  setGroupedHeadersEnabled: (enabled: boolean) => void;
  setPaginationEnabled: (enabled: boolean) => void;
  setThemePreference: (
    preference: InteractiveDemoToolbarProps["themePreference"],
  ) => void;
  destroy: () => void;
};

type NavSlot = {
  panelId: OpenPanelId;
  root: HTMLElement;
  button: ToolbarNavButtonHandle;
  align: ToolbarPanelAlign;
};

/**
 * Mount the InteractiveDemo toolbar shell into `root`.
 * Thin shell: layout + exactly one open panel.
 */
export function mountInteractiveDemoToolbar(
  root: HTMLElement,
  props: InteractiveDemoToolbarProps,
): InteractiveDemoToolbarHandle {
  let openPanel: InteractiveDemoPanelId = null;
  let activeFilterCount = props.activeFilterCount ?? 0;
  let activeSortCount = props.activeSortCount ?? 0;
  let density = props.density;
  let floatingFiltersEnabled = props.floatingFiltersEnabled;
  let groupedHeadersEnabled = props.groupedHeadersEnabled;
  let paginationEnabled = props.paginationEnabled;
  let themePreference = props.themePreference;

  const cleanups: Array<() => void> = [];
  let panelCleanup: (() => void) | null = null;
  let restoreFocusOnClose = false;
  let outsideCleanup: (() => void) | null = null;

  const toolbar = el("div", "interactive-demo-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Grid demo");
  const left = el("div", "interactive-demo-toolbar-left");
  const right = el("div", "interactive-demo-toolbar-right");
  toolbar.append(left, right);
  root.append(toolbar);

  const slots: NavSlot[] = [];

  const closePanel = () => {
    setOpenPanel(null);
  };

  const closeAndRestoreFocus = () => {
    restoreFocusOnClose = true;
    closePanel();
  };

  const clearOutsideListeners = () => {
    outsideCleanup?.();
    outsideCleanup = null;
  };

  const mountOpenPanel = (slot: NavSlot) => {
    clearOutsideListeners();
    panelCleanup?.();
    panelCleanup = null;

    const entry = getPanelEntry(slot.panelId);
    const { host, destroy: destroyHost } = mountToolbarPanelHost(slot.root, {
      ariaLabel: entry.title,
      align: slot.align,
    });

    const panelProps: InteractiveDemoPanelProps = {
      getGrid: props.getGrid,
      onClose: closeAndRestoreFocus,
      floatingFiltersEnabled,
      onFloatingFiltersChange: (enabled) => {
        floatingFiltersEnabled = enabled;
        props.onFloatingFiltersChange(enabled);
      },
      density,
      onDensityChange: (next) => {
        density = next;
        props.onDensityChange(next);
        densityButton.setActive(openPanel === "density");
        densityButton.button.title = `Density: ${densityOptionLabel(density)}`;
      },
      groupedHeadersEnabled,
      onGroupedHeadersChange: (enabled) => {
        groupedHeadersEnabled = enabled;
        props.onGroupedHeadersChange(enabled);
      },
      paginationEnabled,
      onPaginationChange: (enabled) => {
        paginationEnabled = enabled;
        props.onPaginationChange(enabled);
      },
      themePreference,
      onThemePreferenceChange: (preference) => {
        themePreference = preference;
        props.onThemePreferenceChange(preference);
      },
      onStatus: props.onStatus,
    };

    const unmountPanel = entry.mount(host, panelProps);
    panelCleanup = () => {
      unmountPanel();
      destroyHost();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (slot.root.contains(target)) return;
      restoreFocusOnClose = false;
      closePanel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndRestoreFocus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    outsideCleanup = () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  };

  const setOpenPanel = (next: InteractiveDemoPanelId) => {
    const previous = openPanel;
    openPanel = next;

    for (const slot of slots) {
      slot.button.setActive(openPanel === slot.panelId);
    }

    clearOutsideListeners();
    panelCleanup?.();
    panelCleanup = null;

    if (previous && !next && restoreFocusOnClose) {
      restoreFocusOnClose = false;
      const prevSlot = slots.find((slot) => slot.panelId === previous);
      prevSlot?.button.button.focus();
    }

    if (!next) return;
    const slot = slots.find((entry) => entry.panelId === next);
    if (!slot) return;
    mountOpenPanel(slot);
  };

  const togglePanel = (panel: OpenPanelId) => {
    setOpenPanel(openPanel === panel ? null : panel);
  };

  const addNavItem = (
    parent: HTMLElement,
    panelId: OpenPanelId,
    buttonOptions: Parameters<typeof mountToolbarNavButton>[1],
    align: ToolbarPanelAlign = "start",
  ): ToolbarNavButtonHandle => {
    const item = el("div", "interactive-demo-nav-item");
    parent.append(item);
    const button = mountToolbarNavButton(item, {
      ...buttonOptions,
      active: openPanel === panelId,
      onClick: () => togglePanel(panelId),
    });
    slots.push({ panelId, root: item, button, align });
    return button;
  };

  const addRowButton = mountToolbarNavButton(left, {
    primary: true,
    label: "Add row",
    icon: iconPlus(),
    ariaLabel: "Add row",
    onClick: () => {
      addDemoRows(props.getGrid, 1);
      props.onStatus("Row added");
    },
  });
  cleanups.push(() => addRowButton.destroy());

  const separator = el("span", "interactive-demo-separator");
  separator.setAttribute("aria-hidden", "true");
  left.append(separator);

  addNavItem(left, "columns", {
    chevron: true,
    label: "Columns",
    icon: iconColumns(),
    onClick: () => undefined,
  });

  const filtersButton = addNavItem(left, "filters", {
    menu: true,
    label: "Filters",
    icon: iconFilters(),
    badge: activeFilterCount,
    onClick: () => undefined,
  });

  const sortButton = addNavItem(left, "sort", {
    menu: true,
    label: "Sort",
    icon: iconSort(),
    badge: activeSortCount,
    onClick: () => undefined,
  });

  const densityButton = addNavItem(left, "density", {
    chevron: true,
    label: "Density",
    icon: iconDensity(),
    title: `Density: ${densityOptionLabel(density)}`,
    onClick: () => undefined,
  });

  addNavItem(left, "export", {
    chevron: true,
    label: "Export",
    icon: iconExport(),
    onClick: () => undefined,
  });

  const searchCleanup = mountDemoQuickSearch(right, props.getGrid);
  cleanups.push(searchCleanup);

  addNavItem(
    right,
    "settings",
    {
      menu: true,
      label: "Settings",
      icon: iconSettings(),
      onClick: () => undefined,
    },
    "end",
  );

  const fullscreenBtn = el(
    "button",
    "interactive-demo-fullscreen-btn",
  ) as HTMLButtonElement;
  fullscreenBtn.type = "button";
  fullscreenBtn.setAttribute("aria-label", "Fullscreen");
  fullscreenBtn.append(iconFullscreen());
  const unguardFullscreen = bindFocusStealGuard(fullscreenBtn);
  const onFullscreen = () => toggleDemoFullscreen();
  fullscreenBtn.addEventListener("click", onFullscreen);
  right.append(fullscreenBtn);
  cleanups.push(() => {
    unguardFullscreen();
    fullscreenBtn.removeEventListener("click", onFullscreen);
    fullscreenBtn.remove();
  });

  return {
    setActiveFilterCount(count) {
      activeFilterCount = count;
      filtersButton.setBadge(count);
    },
    setActiveSortCount(count) {
      activeSortCount = count;
      sortButton.setBadge(count);
    },
    setDensity(next) {
      density = next;
      densityButton.button.title = `Density: ${densityOptionLabel(density)}`;
    },
    setFloatingFiltersEnabled(enabled) {
      floatingFiltersEnabled = enabled;
    },
    setGroupedHeadersEnabled(enabled) {
      groupedHeadersEnabled = enabled;
    },
    setPaginationEnabled(enabled) {
      paginationEnabled = enabled;
    },
    setThemePreference(preference) {
      themePreference = preference;
    },
    destroy() {
      clearOutsideListeners();
      panelCleanup?.();
      panelCleanup = null;
      for (const slot of slots) slot.button.destroy();
      for (let index = cleanups.length - 1; index >= 0; index -= 1) {
        cleanups[index]?.();
      }
      toolbar.remove();
    },
  };
}
