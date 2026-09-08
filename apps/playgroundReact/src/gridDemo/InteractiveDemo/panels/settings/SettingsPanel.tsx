import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { preventToolbarFocusSteal } from "../../shell/preventToolbarFocusSteal.ts";
import { PanelDivider } from "../../shell/ui/PanelDivider.tsx";
import { PanelHeader } from "../../shell/ui/PanelHeader.tsx";
import { PanelInfoFooter } from "../../shell/ui/PanelInfoFooter.tsx";
import { PanelToggleRow } from "../../shell/ui/PanelToggleRow.tsx";

import { resetDemoSettings } from "./commands/resetDemoSettings.ts";
import {
  DEMO_THEME_OPTIONS,
  type DemoSettingsSnapshot,
  type DemoThemePreference,
} from "./commands/settingsPanelModel.ts";
import {
  IconFloatingFilters,
  IconGroupedHeaders,
  IconPagination,
  IconResetDemo,
  IconThemeDark,
  IconThemeLight,
  IconThemeSystem,
} from "./settingsPanelIcons.tsx";

export type SettingsPanelProps = InteractiveDemoPanelProps;

function themeIcon(value: DemoThemePreference) {
  if (value === "light") return <IconThemeLight />;
  if (value === "dark") return <IconThemeDark />;
  return <IconThemeSystem />;
}

/**
 * Settings panel — theme, layout toggles, and reset.
 */
export function SettingsPanel({
  getGrid,
  onClose,
  onStatus,
  floatingFiltersEnabled = true,
  onFloatingFiltersChange,
  groupedHeadersEnabled = false,
  onGroupedHeadersChange,
  paginationEnabled = true,
  onPaginationChange,
  themePreference = "dark",
  onThemePreferenceChange,
}: SettingsPanelProps) {
  const applyChrome = (next: DemoSettingsSnapshot) => {
    onGroupedHeadersChange?.(next.groupedHeadersEnabled);
    onFloatingFiltersChange?.(next.floatingFiltersEnabled);
    onPaginationChange?.(next.paginationEnabled);
    onThemePreferenceChange?.(next.themePreference);
  };

  return (
    <div className="interactive-demo-settings-root interactive-demo-panel-stack">
      <PanelHeader title="Settings" onClose={onClose} />

      <div className="interactive-demo-settings-toggles">
        <PanelToggleRow
          icon={<IconGroupedHeaders />}
          label="Grouped headers"
          checked={groupedHeadersEnabled}
          onChange={(enabled) => onGroupedHeadersChange?.(enabled)}
        />
        <PanelToggleRow
          icon={<IconFloatingFilters />}
          label="Floating filters"
          checked={floatingFiltersEnabled}
          onChange={(enabled) => onFloatingFiltersChange?.(enabled)}
        />
        <PanelToggleRow
          icon={<IconPagination />}
          label="Pagination"
          checked={paginationEnabled}
          onChange={(enabled) => onPaginationChange?.(enabled)}
        />
      </div>

      <PanelDivider />

      <section className="interactive-demo-settings-section">
        <h3 className="interactive-demo-settings-section-title">Theme</h3>
        <div
          className="interactive-demo-settings-theme"
          role="radiogroup"
          aria-label="Theme"
        >
          {DEMO_THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={themePreference === option.value}
              className={`interactive-demo-settings-theme-btn${
                themePreference === option.value ? " is-selected" : ""
              }`}
              onMouseDown={preventToolbarFocusSteal}
              onClick={() => onThemePreferenceChange?.(option.value)}
            >
              <span aria-hidden="true">{themeIcon(option.value)}</span>
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <PanelDivider />

      <section className="interactive-demo-settings-section">
        <h3 className="interactive-demo-settings-section-title">Reset</h3>
        <button
          type="button"
          className="interactive-demo-settings-reset"
          onMouseDown={preventToolbarFocusSteal}
          onClick={() => {
            resetDemoSettings(getGrid, applyChrome);
            onStatus?.("Grid state reset");
            onClose();
          }}
        >
          <span aria-hidden="true">
            <IconResetDemo />
          </span>
          Reset grid
        </button>
      </section>

      <PanelInfoFooter>
        Settings change this demo only.
      </PanelInfoFooter>
    </div>
  );
}
