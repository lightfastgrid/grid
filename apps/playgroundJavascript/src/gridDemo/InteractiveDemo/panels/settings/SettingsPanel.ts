import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { el } from "../../shell/dom.ts";
import { preventToolbarFocusSteal } from "../../shell/preventToolbarFocusSteal.ts";
import {
  mountPanelDivider,
  mountPanelHeader,
  mountPanelInfoFooter,
  mountPanelToggleRow,
} from "../../shell/ui/panelPrimitives.ts";

import { resetDemoSettings } from "./commands/resetDemoSettings.ts";
import {
  DEFAULT_DEMO_SETTINGS,
  DEMO_THEME_OPTIONS,
  type DemoSettingsSnapshot,
  type DemoThemePreference,
} from "./commands/settingsPanelModel.ts";
import {
  iconFloatingFilters,
  iconGroupedHeaders,
  iconPagination,
  iconResetDemo,
  iconThemeDark,
  iconThemeLight,
  iconThemeSystem,
} from "./settingsPanelIcons.ts";

function themeIcon(value: DemoThemePreference): SVGSVGElement {
  if (value === "light") return iconThemeLight();
  if (value === "dark") return iconThemeDark();
  return iconThemeSystem();
}

/**
 * Settings panel — theme, layout toggles, and reset.
 */
export function mountSettingsPanel(
  host: HTMLElement,
  props: InteractiveDemoPanelProps,
): () => void {
  const {
    getGrid,
    onClose,
    onStatus,
    floatingFiltersEnabled = DEFAULT_DEMO_SETTINGS.floatingFiltersEnabled,
    onFloatingFiltersChange,
    groupedHeadersEnabled = DEFAULT_DEMO_SETTINGS.groupedHeadersEnabled,
    onGroupedHeadersChange,
    paginationEnabled = DEFAULT_DEMO_SETTINGS.paginationEnabled,
    onPaginationChange,
    themePreference = DEFAULT_DEMO_SETTINGS.themePreference,
    onThemePreferenceChange,
  } = props;

  const root = el(
    "div",
    "interactive-demo-settings-root interactive-demo-panel-stack",
  );
  const cleanups: (() => void)[] = [];

  const headerHandle = mountPanelHeader(root, {
    title: "Settings",
    onClose,
  });
  cleanups.push(headerHandle.destroy);

  const togglesContainer = el("div", "interactive-demo-settings-toggles");
  cleanups.push(
    mountPanelToggleRow(togglesContainer, {
      icon: iconGroupedHeaders(),
      label: "Grouped headers",
      checked: groupedHeadersEnabled,
      onChange: (enabled) => onGroupedHeadersChange?.(enabled),
    }),
    mountPanelToggleRow(togglesContainer, {
      icon: iconFloatingFilters(),
      label: "Floating filters",
      checked: floatingFiltersEnabled,
      onChange: (enabled) => onFloatingFiltersChange?.(enabled),
    }),
    mountPanelToggleRow(togglesContainer, {
      icon: iconPagination(),
      label: "Pagination",
      checked: paginationEnabled,
      onChange: (enabled) => onPaginationChange?.(enabled),
    }),
  );
  root.append(togglesContainer);

  mountPanelDivider(root);

  const themeSection = el("section", "interactive-demo-settings-section");
  themeSection.append(
    el("h3", "interactive-demo-settings-section-title", "Theme"),
  );
  const themeGroup = el("div", "interactive-demo-settings-theme");
  themeGroup.setAttribute("role", "radiogroup");
  themeGroup.setAttribute("aria-label", "Theme");

  let currentTheme = themePreference;
  const themeButtons: HTMLButtonElement[] = [];

  const syncThemeButtons = () => {
    for (const btn of themeButtons) {
      const selected = btn.dataset.value === currentTheme;
      btn.setAttribute("aria-checked", String(selected));
      btn.classList.toggle("is-selected", selected);
    }
  };

  for (const option of DEMO_THEME_OPTIONS) {
    const btn = el("button", "interactive-demo-settings-theme-btn");
    btn.type = "button";
    btn.dataset.value = option.value;
    btn.setAttribute("role", "radio");
    btn.addEventListener("mousedown", preventToolbarFocusSteal);
    const iconWrap = el("span");
    iconWrap.setAttribute("aria-hidden", "true");
    iconWrap.append(themeIcon(option.value));
    btn.append(iconWrap, document.createTextNode(option.label));
    const onClick = () => {
      currentTheme = option.value;
      onThemePreferenceChange?.(option.value);
      syncThemeButtons();
    };
    btn.addEventListener("click", onClick);
    cleanups.push(
      () => btn.removeEventListener("mousedown", preventToolbarFocusSteal),
      () => btn.removeEventListener("click", onClick),
    );
    themeButtons.push(btn);
    themeGroup.append(btn);
  }
  syncThemeButtons();
  themeSection.append(themeGroup);
  root.append(themeSection);

  mountPanelDivider(root);

  const resetSection = el("section", "interactive-demo-settings-section");
  resetSection.append(
    el("h3", "interactive-demo-settings-section-title", "Reset"),
  );
  const resetBtn = el("button", "interactive-demo-settings-reset");
  resetBtn.type = "button";
  resetBtn.addEventListener("mousedown", preventToolbarFocusSteal);
  const resetIcon = el("span");
  resetIcon.setAttribute("aria-hidden", "true");
  resetIcon.append(iconResetDemo());
  resetBtn.append(resetIcon, document.createTextNode("Reset grid"));
  const onReset = () => {
    const applyChrome = (next: DemoSettingsSnapshot) => {
      onGroupedHeadersChange?.(next.groupedHeadersEnabled);
      onFloatingFiltersChange?.(next.floatingFiltersEnabled);
      onPaginationChange?.(next.paginationEnabled);
      onThemePreferenceChange?.(next.themePreference);
    };
    resetDemoSettings(getGrid, applyChrome);
    onStatus?.("Grid state reset");
    onClose();
  };
  resetBtn.addEventListener("click", onReset);
  cleanups.push(
    () => resetBtn.removeEventListener("mousedown", preventToolbarFocusSteal),
    () => resetBtn.removeEventListener("click", onReset),
  );
  resetSection.append(resetBtn);
  root.append(resetSection);

  mountPanelInfoFooter(root, "Settings change this demo only.");

  host.append(root);

  return () => {
    for (const fn of cleanups) fn();
    root.remove();
  };
}
