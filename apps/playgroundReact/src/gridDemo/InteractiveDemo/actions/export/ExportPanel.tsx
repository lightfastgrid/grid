import { useLayoutEffect, useRef, useState } from "react";

import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { PanelActionRow } from "../../shell/ui/PanelActionRow.tsx";
import { PanelDivider } from "../../shell/ui/PanelDivider.tsx";
import { PanelHeader } from "../../shell/ui/PanelHeader.tsx";
import { PanelInfoFooter } from "../../shell/ui/PanelInfoFooter.tsx";

import { AdvancedExportPanel } from "./AdvancedExportPanel.tsx";
import { exportDemoCsv } from "./exportDemoCsv.ts";
import {
  IconExportChevron,
  IconExportDownload,
} from "./exportPanelIcons.tsx";
import { applyAdvancedExportPlacement } from "./placeAdvancedExportFlyout.ts";

/**
 * Export dropdown — primary CSV download plus an optional advanced flyout.
 */
export function ExportPanel({
  getGrid,
  onClose,
  onStatus,
}: InteractiveDemoPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useLayoutEffect(() => {
    if (!advancedOpen) return;
    const root = rootRef.current;
    const flyout = flyoutRef.current;
    if (!root || !flyout) return;

    const apply = () => applyAdvancedExportPlacement(flyout, root);
    if (typeof flyout.showPopover === "function") {
      try {
        flyout.showPopover();
      } catch {
        /* already open (Strict Mode remount) */
      }
    }
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(root);
    observer.observe(flyout);
    window.addEventListener("resize", apply);
    window.addEventListener("scroll", apply, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
      window.removeEventListener("scroll", apply, true);
      if (typeof flyout.hidePopover === "function") {
        try {
          flyout.hidePopover();
        } catch {
          /* already closed */
        }
      }
    };
  }, [advancedOpen]);

  return (
    <div
      ref={rootRef}
      className={`interactive-demo-export-root${
        advancedOpen ? " has-advanced" : ""
      }`}
    >
      <div className="interactive-demo-panel-stack">
        <PanelHeader title="Export" onClose={onClose} />

        <div className="interactive-demo-panel-actions">
          <PanelActionRow
            icon={<IconExportDownload />}
            title="Download CSV"
            description="Filtered and sorted rows, visible columns"
            onClick={() => {
              exportDemoCsv(getGrid, () => onStatus?.("CSV exported"));
              onClose();
            }}
          />
        </div>

        <PanelDivider />

        <div className="interactive-demo-panel-actions">
          <PanelActionRow
            icon={<IconExportDownload />}
            title="Advanced export…"
            trailing={<IconExportChevron />}
            onClick={() => setAdvancedOpen((open) => !open)}
          />
        </div>

        <PanelInfoFooter>
          Use Advanced export for page, selection, and encoding options.
        </PanelInfoFooter>
      </div>

      {advancedOpen ? (
        <div
          ref={flyoutRef}
          className="interactive-demo-export-advanced"
          role="dialog"
          aria-label="Advanced export"
          popover="manual"
        >
          <AdvancedExportPanel
            getGrid={getGrid}
            onClose={onClose}
            onCloseAdvanced={() => setAdvancedOpen(false)}
            onStatus={onStatus}
          />
        </div>
      ) : null}
    </div>
  );
}
