// Architecture: cell-shell DOM is renderer-owned pooled content. Business logic
// lives here in features/cell-shells. Renderer/pool integration is intentionally
// limited to pooled shell bookkeeping fields (shellKind, shellRoot, etc.) and
// calls to bindCellShell/clearCellShell. Future rich cell content should reuse a
// feature-owned manager pattern and avoid adding more feature-specific pool
// fields without strong justification.

export {
  CellShellActionController,
  type CellShellActionControllerOptions,
} from "./CellShellActionController";
export {
  CELL_SHELL_ACTION_SELECTOR,
  CELL_SHELL_CHECKBOX_INPUT_SELECTOR,
  CELL_SHELL_GROUP_ACTION_SELECTOR,
  CELL_SHELL_OVERLAY_SELECTOR,
  isCellShellActionTarget,
  isCellShellOverlayTarget,
} from "./cellShellActionDom";
export {
  cellShellActionFeature,
  type CellShellActionFeatureOptions,
} from "./cellShellActionFeature";
export { cellShellDependsOnlyOnOwnField } from "./cellShellDependencies";
export type { CellShellBindParams, CellShellPreviewParams } from "./CellShellManager";
export { bindCellShell, clearCellShell, createCellShellPreview, isActionShellKind } from "./CellShellManager";
export {
  CellShellOverlayController,
  type CellShellOverlayControllerOptions,
} from "./CellShellOverlayController";
export {
  cellShellOverlayFeature,
  type CellShellOverlayFeatureOptions,
} from "./cellShellOverlayFeature";
export type {
  CellOverlayTrigger,
  CellShellConfig,
  CellShellKind,
  CellShellOverlayConfig,
  CellShellValueSource,
} from "./cellShellTypes";
export { normalizeCellShell } from "./normalizeCellShell";
export type { ShellValueContext } from "./resolveShellValue";
export { resolveShellTone, resolveShellValue } from "./resolveShellValue";
