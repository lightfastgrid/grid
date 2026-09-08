import type { CellShellOverlayRenderer } from '@lightfastgrid/core';
import { createRoot } from 'react-dom/client';

import type {
  ReactCellShellOverlayRegistry,
  ReactCellShellOverlayRenderResult,
  ReactCellShellOverlayRenderReturn,
} from './types';

function isRenderResultObject(
  value: ReactCellShellOverlayRenderReturn,
): value is ReactCellShellOverlayRenderResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'node' in value
  );
}

export function adaptCellShellOverlays(
  overlays: ReactCellShellOverlayRegistry | undefined,
): Record<string, CellShellOverlayRenderer> | undefined {
  if (!overlays) return undefined;

  const adapted: Record<string, CellShellOverlayRenderer> = {};

  for (const [key, renderer] of Object.entries(overlays)) {
    const coreRenderer: CellShellOverlayRenderer = {
      kind: 'cell-shell-overlay',
      render: (ctx) => {
        const root = createRoot(ctx.host);
        const { host: _, ...reactCtx } = ctx;
        const result = renderer.render(reactCtx);
        const node = isRenderResultObject(result) ? result.node : result;
        const userCleanup = isRenderResultObject(result)
          ? result.cleanup
          : undefined;

        root.render(node);

        return () => {
          root.unmount();
          userCleanup?.();
        };
      },
    };

    adapted[key] = coreRenderer;
  }

  return adapted;
}
