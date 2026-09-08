import { useState } from "react";

import { densityOptionLabel } from "./actions/density/densityOptions.ts";
import { toggleDemoFullscreen } from "./actions/fullscreen/toggleDemoFullscreen.ts";
import { DemoQuickSearch } from "./actions/search/DemoQuickSearch.tsx";
import type { OpenPanelId } from "./panels/panelRegistry.ts";
import { addDemoRows } from "./panels/rows/commands/addDemoRows.ts";
import { preventToolbarFocusSteal } from "./shell/preventToolbarFocusSteal.ts";
import {
  IconColumns,
  IconDensity,
  IconExport,
  IconFilters,
  IconFullscreen,
  IconPlus,
  IconSettings,
  IconSort,
} from "./shell/ToolbarIcons.tsx";
import { ToolbarNavButton } from "./shell/ToolbarNavButton.tsx";
import { ToolbarNavItem } from "./shell/ToolbarNavItem.tsx";
import type {
  InteractiveDemoPanelId,
  InteractiveDemoToolbarProps,
} from "./types.ts";

import "./InteractiveDemoToolbar.css";

/**
 * Thin shell: layout + which panel is open.
 * Each dropdown mounts under its own trigger via ToolbarNavItem.
 */
export function InteractiveDemoToolbar({
  getGrid,
  density,
  onDensityChange,
  activeFilterCount = 0,
  activeSortCount = 0,
  floatingFiltersEnabled,
  onFloatingFiltersChange,
  groupedHeadersEnabled,
  onGroupedHeadersChange,
  paginationEnabled,
  onPaginationChange,
  themePreference,
  onThemePreferenceChange,
  onStatus,
}: InteractiveDemoToolbarProps) {
  const [openPanel, setOpenPanel] = useState<InteractiveDemoPanelId>(null);

  const togglePanel = (panel: OpenPanelId) => {
    setOpenPanel((current) => (current === panel ? null : panel));
  };

  const closePanel = () => setOpenPanel(null);

  return (
    <div className="interactive-demo-toolbar" role="toolbar" aria-label="Grid demo">
      <div className="interactive-demo-toolbar-left">
        <ToolbarNavButton
          primary
          label="Add row"
          icon={<IconPlus />}
          ariaLabel="Add row"
          onClick={() => {
            addDemoRows(getGrid, 1);
            onStatus("Row added");
          }}
        />

        <span className="interactive-demo-separator" aria-hidden="true" />

        <ToolbarNavItem
          panelId="columns"
          openPanel={openPanel}
          getGrid={getGrid}
          onClose={closePanel}
          onStatus={onStatus}
        >
          <ToolbarNavButton
            chevron
            label="Columns"
            icon={<IconColumns />}
            active={openPanel === "columns"}
            onClick={() => togglePanel("columns")}
          />
        </ToolbarNavItem>

        <ToolbarNavItem
          panelId="filters"
          openPanel={openPanel}
          getGrid={getGrid}
          onClose={closePanel}
          onStatus={onStatus}
          floatingFiltersEnabled={floatingFiltersEnabled}
          onFloatingFiltersChange={onFloatingFiltersChange}
        >
          <ToolbarNavButton
            menu
            label="Filters"
            icon={<IconFilters />}
            badge={activeFilterCount}
            active={openPanel === "filters"}
            onClick={() => togglePanel("filters")}
          />
        </ToolbarNavItem>

        <ToolbarNavItem
          panelId="sort"
          openPanel={openPanel}
          getGrid={getGrid}
          onClose={closePanel}
          onStatus={onStatus}
        >
          <ToolbarNavButton
            menu
            label="Sort"
            icon={<IconSort />}
            badge={activeSortCount}
            active={openPanel === "sort"}
            onClick={() => togglePanel("sort")}
          />
        </ToolbarNavItem>

        <ToolbarNavItem
          panelId="density"
          openPanel={openPanel}
          getGrid={getGrid}
          onClose={closePanel}
          onStatus={onStatus}
          density={density}
          onDensityChange={onDensityChange}
        >
          <ToolbarNavButton
            chevron
            label="Density"
            icon={<IconDensity />}
            title={`Density: ${densityOptionLabel(density)}`}
            active={openPanel === "density"}
            onClick={() => togglePanel("density")}
          />
        </ToolbarNavItem>

        <ToolbarNavItem
          panelId="export"
          openPanel={openPanel}
          getGrid={getGrid}
          onClose={closePanel}
          onStatus={onStatus}
        >
          <ToolbarNavButton
            chevron
            label="Export"
            icon={<IconExport />}
            active={openPanel === "export"}
            onClick={() => togglePanel("export")}
          />
        </ToolbarNavItem>
      </div>

      <div className="interactive-demo-toolbar-right">
        <DemoQuickSearch getGrid={getGrid} />

        <ToolbarNavItem
          panelId="settings"
          openPanel={openPanel}
          getGrid={getGrid}
          onClose={closePanel}
          align="end"
          onStatus={onStatus}
          floatingFiltersEnabled={floatingFiltersEnabled}
          onFloatingFiltersChange={onFloatingFiltersChange}
          groupedHeadersEnabled={groupedHeadersEnabled}
          onGroupedHeadersChange={onGroupedHeadersChange}
          paginationEnabled={paginationEnabled}
          onPaginationChange={onPaginationChange}
          themePreference={themePreference}
          onThemePreferenceChange={onThemePreferenceChange}
        >
          <ToolbarNavButton
            menu
            label="Settings"
            icon={<IconSettings />}
            active={openPanel === "settings"}
            onClick={() => togglePanel("settings")}
          />
        </ToolbarNavItem>

        <button
          type="button"
          className="interactive-demo-fullscreen-btn"
          aria-label="Fullscreen"
          onMouseDown={preventToolbarFocusSteal}
          onClick={toggleDemoFullscreen}
        >
          <IconFullscreen />
        </button>
      </div>
    </div>
  );
}
