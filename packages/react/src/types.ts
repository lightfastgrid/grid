import type {
  ActionMenuCellRenderer,
  CellShellOverlayRenderContext,
  Grid,
  GridApi,
  GridCreateOptions,
  GridOverlayRenderContext,
  HeaderActionRenderContext,
  RowActionRenderContext,
} from '@lightfastgrid/core';
import type { CSSProperties, ReactNode } from 'react';

export type ReactRowActionRenderContext = Omit<RowActionRenderContext, 'host'>;

export interface ReactRowActionRenderResult {
  node: ReactNode;
  cleanup?: () => void;
}

export type ReactRowActionRenderReturn =
  | ReactNode
  | ReactRowActionRenderResult;

export interface ReactActionCustomCellRenderer {
  kind: 'actions';
  mode: 'custom';
  render(ctx: ReactRowActionRenderContext): ReactRowActionRenderReturn;
}

export type ReactActionCellRenderer =
  | ActionMenuCellRenderer
  | ReactActionCustomCellRenderer;

export type ReactCellRendererRegistry = Record<string, ReactActionCellRenderer>;

export type ReactHeaderActionRenderContext = Omit<
  HeaderActionRenderContext,
  'host'
>;

export interface ReactHeaderActionRenderResult {
  node: ReactNode;
  cleanup?: () => void;
}

export type ReactHeaderActionRenderReturn =
  | ReactNode
  | ReactHeaderActionRenderResult;

export interface ReactHeaderActionRenderer {
  kind: 'header-action';
  mode: 'custom';
  render(ctx: ReactHeaderActionRenderContext): ReactHeaderActionRenderReturn;
}

export type ReactHeaderRendererRegistry = Record<
  string,
  ReactHeaderActionRenderer
>;

// ── Overlays ───────────────────────────────────────────────────────────

/**
 * React overlay render context. Mirrors the core context but hides the raw
 * `host` element — React adapters render via `createRoot(host)`.
 */
export type ReactOverlayRenderContext = Omit<GridOverlayRenderContext, 'host'>;

/** Object form result for an overlay render — node plus optional cleanup. */
export interface ReactOverlayRenderResult {
  node: ReactNode;
  cleanup?: () => void;
}

/** Allowed return type from a React overlay render function. */
export type ReactOverlayRenderReturn =
  | ReactNode
  | ReactOverlayRenderResult;

/**
 * React-flavoured overlay options. `render` returns a React node (or a
 * `{ node, cleanup }` object). When `render` is omitted, `text` and
 * `className` behave the same as in the core overlay API.
 */
export interface ReactOverlayOptions {
  text?: string;
  className?: string;
  render?: (ctx: ReactOverlayRenderContext) => ReactOverlayRenderReturn;
}

/** Per-variant React overlay customization passed via `overlays` prop. */
export interface ReactGridOverlaysOptions {
  loading?: ReactOverlayOptions;
  noRows?: ReactOverlayOptions;
  noMatchingRows?: ReactOverlayOptions;
}

/**
 * React handle: identical to the core handle except `setOverlays` accepts
 * the React overlay options shape (the adapter converts to core form).
 */
export type ReactLightFastGridHandle = Omit<
  GridApi,
  'setOverlays'
> & {
  getInstance(): Grid | null;
  setOverlays(overlays?: ReactGridOverlaysOptions): void;
};

export interface ReactContainerProps {
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  /**
   * Apply replacement `rows` props through the core immutable-row diff.
   * Requires a stable `getRowId`; otherwise the adaptor falls back to
   * `setRows`.
   */
  immutableRows?: boolean;
}

// ── Cell-shell overlays ───────────────────────────────────────────────

export type ReactCellShellOverlayRenderContext = Omit<
  CellShellOverlayRenderContext,
  'host'
>;

export interface ReactCellShellOverlayRenderResult {
  node: ReactNode;
  cleanup?: () => void;
}

export type ReactCellShellOverlayRenderReturn =
  | ReactNode
  | ReactCellShellOverlayRenderResult;

export interface ReactCellShellOverlayRenderer {
  kind: 'cell-shell-overlay';
  render(ctx: ReactCellShellOverlayRenderContext): ReactCellShellOverlayRenderReturn;
}

export type ReactCellShellOverlayRegistry = Record<
  string,
  ReactCellShellOverlayRenderer
>;

export type ReactLightFastGridProps = Omit<
  GridCreateOptions,
  'cellRenderers' | 'headerRenderers' | 'overlays' | 'cellShellOverlays'
> & ReactContainerProps & {
  cellRenderers?: ReactCellRendererRegistry;
  headerRenderers?: ReactHeaderRendererRegistry;
  overlays?: ReactGridOverlaysOptions;
  cellShellOverlays?: ReactCellShellOverlayRegistry;
};
