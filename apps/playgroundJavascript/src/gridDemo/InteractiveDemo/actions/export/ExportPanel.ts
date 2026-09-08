import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { el } from "../../shell/dom.ts";
import { iconDownload, iconExportChevron } from "../../shell/ToolbarIcons.ts";
import {
  mountPanelActionRow,
  mountPanelDivider,
  mountPanelHeader,
  mountPanelInfoFooter,
} from "../../shell/ui/panelPrimitives.ts";

import { mountAdvancedExportPanel } from "./AdvancedExportPanel.ts";
import { exportDemoCsv } from "./exportDemoCsv.ts";
import { applyAdvancedExportPlacement } from "./placeAdvancedExportFlyout.ts";

/**
 * Export dropdown — primary CSV download plus an optional advanced flyout.
 */
export function mountExportPanel(
  host: HTMLElement,
  props: InteractiveDemoPanelProps,
): () => void {
  const { getGrid, onClose, onStatus } = props;
  const cleanups: (() => void)[] = [];

  const wrapper = el("div", "interactive-demo-export-root");
  const mainStack = el("div", "interactive-demo-panel-stack");

  const headerHandle = mountPanelHeader(mainStack, {
    title: "Export",
    onClose,
  });
  cleanups.push(headerHandle.destroy);

  const actionsContainer = el("div", "interactive-demo-panel-actions");
  mainStack.append(actionsContainer);

  cleanups.push(
    mountPanelActionRow(actionsContainer, {
      icon: iconDownload(),
      title: "Download CSV",
      description: "Filtered and sorted rows, visible columns",
      onClick: () => {
        exportDemoCsv(getGrid, () => onStatus?.("CSV exported"));
        onClose();
      },
    }),
  );

  mountPanelDivider(mainStack);

  const advancedActionsContainer = el("div", "interactive-demo-panel-actions");
  mainStack.append(advancedActionsContainer);

  let advancedOpen = false;
  const advancedHost = el("div", "interactive-demo-export-advanced");
  advancedHost.setAttribute("role", "dialog");
  advancedHost.setAttribute("aria-label", "Advanced export");
  advancedHost.setAttribute("popover", "manual");

  let destroyAdvanced: (() => void) | null = null;
  let placementObserver: ResizeObserver | null = null;

  function stopPlacementTracking() {
    placementObserver?.disconnect();
    placementObserver = null;
    window.removeEventListener("resize", trackPlacement);
    window.removeEventListener("scroll", trackPlacement, true);
  }

  function trackPlacement() {
    applyAdvancedExportPlacement(advancedHost, wrapper);
  }

  function toggleAdvanced() {
    advancedOpen = !advancedOpen;
    wrapper.classList.toggle("has-advanced", advancedOpen);
    if (advancedOpen) {
      destroyAdvanced = mountAdvancedExportPanel(advancedHost, {
        getGrid,
        onClose,
        onCloseAdvanced: () => toggleAdvanced(),
        onStatus,
      });
      wrapper.append(advancedHost);
      if (typeof advancedHost.showPopover === "function") {
        advancedHost.showPopover();
      }
      trackPlacement();
      placementObserver = new ResizeObserver(trackPlacement);
      placementObserver.observe(wrapper);
      placementObserver.observe(advancedHost);
      window.addEventListener("resize", trackPlacement);
      window.addEventListener("scroll", trackPlacement, true);
    } else {
      stopPlacementTracking();
      destroyAdvanced?.();
      destroyAdvanced = null;
      advancedHost.remove();
    }
  }

  cleanups.push(
    mountPanelActionRow(advancedActionsContainer, {
      icon: iconDownload(),
      title: "Advanced export…",
      trailing: iconExportChevron(),
      onClick: toggleAdvanced,
    }),
  );

  mountPanelInfoFooter(
    mainStack,
    "Use Advanced export for page, selection, and encoding options.",
  );

  wrapper.append(mainStack);
  host.append(wrapper);

  return () => {
    stopPlacementTracking();
    destroyAdvanced?.();
    for (const fn of cleanups) fn();
    wrapper.remove();
  };
}
