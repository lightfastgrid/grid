export const ADVANCED_EXPORT_FLYOUT_WIDTH = 560;
const GAP = 10;
const VIEWPORT_INSET = 12;
const MIN_WIDTH = 280;

export type AdvancedExportFixedPositionInput = {
  panelTop: number;
  panelRight: number;
  viewportWidth: number;
  viewportHeight: number;
  flyoutHeight: number;
};

export function resolveAdvancedExportFixedPosition(
  input: AdvancedExportFixedPositionInput,
): { top: number; left: number; width: number } {
  const left = input.panelRight + GAP;
  const width = Math.max(
    MIN_WIDTH,
    Math.min(
      ADVANCED_EXPORT_FLYOUT_WIDTH,
      input.viewportWidth - left - VIEWPORT_INSET,
    ),
  );

  let top = input.panelTop;
  const overflowBottom =
    top + input.flyoutHeight - (input.viewportHeight - VIEWPORT_INSET);
  if (overflowBottom > 0) {
    top = Math.max(VIEWPORT_INSET, top - overflowBottom);
  }

  return { top, left, width };
}

export function applyAdvancedExportPlacement(
  flyout: HTMLElement,
  root: HTMLElement,
): void {
  const panel =
    root.closest<HTMLElement>(".interactive-demo-panel") ?? root;
  const rect = panel.getBoundingClientRect();
  const { top, left, width } = resolveAdvancedExportFixedPosition({
    panelTop: rect.top,
    panelRight: rect.right,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    flyoutHeight: flyout.offsetHeight,
  });

  flyout.style.top = `${Math.round(top)}px`;
  flyout.style.left = `${Math.round(left)}px`;
  flyout.style.width = `${Math.round(width)}px`;
  flyout.style.maxWidth = `${Math.round(width)}px`;
  flyout.style.right = "auto";
}
