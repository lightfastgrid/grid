import type { GridThemeDensity } from "@lightfastgrid/core";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

import { getPanelEntry, type OpenPanelId } from "../panels/panelRegistry.ts";
import type { DemoGridGetter, DemoThemePreference } from "../runtime/types.ts";
import type { InteractiveDemoPanelId } from "../types.ts";

import { type ToolbarPanelAlign, ToolbarPanelHost } from "./ToolbarPanelHost.tsx";

type ToolbarNavItemProps = {
  panelId: OpenPanelId;
  openPanel: InteractiveDemoPanelId;
  getGrid: DemoGridGetter;
  onClose: () => void;
  /** Settings (right side) anchors to the trigger’s right edge. */
  align?: ToolbarPanelAlign;
  floatingFiltersEnabled?: boolean;
  onFloatingFiltersChange?: (enabled: boolean) => void;
  density?: GridThemeDensity;
  onDensityChange?: (density: GridThemeDensity) => void;
  groupedHeadersEnabled?: boolean;
  onGroupedHeadersChange?: (enabled: boolean) => void;
  paginationEnabled?: boolean;
  onPaginationChange?: (enabled: boolean) => void;
  themePreference?: DemoThemePreference;
  onThemePreferenceChange?: (preference: DemoThemePreference) => void;
  onStatus?: (message: string) => void;
  children: ReactNode;
};

function readNavTrigger(root: HTMLElement | null): HTMLButtonElement | null {
  if (!root) return null;
  return root.querySelector(":scope > .interactive-demo-btn");
}

/**
 * Wraps a toolbar trigger so its dropdown mounts under that button,
 * not at a fixed toolbar-left offset.
 *
 * Interaction (design): one panel open via shell; click-outside or Esc closes;
 * Esc restores focus to the trigger; panel is a non-modal dialog.
 */
export function ToolbarNavItem({
  panelId,
  openPanel,
  getGrid,
  onClose,
  align = "start",
  floatingFiltersEnabled,
  onFloatingFiltersChange,
  density,
  onDensityChange,
  groupedHeadersEnabled,
  onGroupedHeadersChange,
  paginationEnabled,
  onPaginationChange,
  themePreference,
  onThemePreferenceChange,
  onStatus,
  children,
}: ToolbarNavItemProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreFocusOnCloseRef = useRef(false);
  const isOpen = openPanel === panelId;
  const entry = isOpen ? getPanelEntry(panelId) : null;
  const OpenPanel = entry?.Panel;

  const closeAndRestoreFocus = useCallback(() => {
    restoreFocusOnCloseRef.current = true;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) return;
    if (!restoreFocusOnCloseRef.current) return;
    restoreFocusOnCloseRef.current = false;
    readNavTrigger(rootRef.current)?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const target = event.target;
      if (!(root && target instanceof Node)) return;
      if (root.contains(target)) return;
      restoreFocusOnCloseRef.current = false;
      onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndRestoreFocus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose, closeAndRestoreFocus]);

  return (
    <div ref={rootRef} className="interactive-demo-nav-item">
      {children}
      {entry && OpenPanel ? (
        <ToolbarPanelHost ariaLabel={entry.title} align={align}>
          <OpenPanel
            getGrid={getGrid}
            onClose={closeAndRestoreFocus}
            floatingFiltersEnabled={floatingFiltersEnabled}
            onFloatingFiltersChange={onFloatingFiltersChange}
            density={density}
            onDensityChange={onDensityChange}
            groupedHeadersEnabled={groupedHeadersEnabled}
            onGroupedHeadersChange={onGroupedHeadersChange}
            paginationEnabled={paginationEnabled}
            onPaginationChange={onPaginationChange}
            themePreference={themePreference}
            onThemePreferenceChange={onThemePreferenceChange}
            onStatus={onStatus}
          />
        </ToolbarPanelHost>
      ) : null}
    </div>
  );
}
