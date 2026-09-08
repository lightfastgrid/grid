import type {
  ActionCellRenderer,
  CellRendererRegistry,
} from '@lightfastgrid/core';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import type {
  ReactCellRendererRegistry,
  ReactRowActionRenderResult,
  ReactRowActionRenderReturn,
} from './types';

function isRenderResultObject(
  value: ReactRowActionRenderReturn,
): value is ReactRowActionRenderResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'node' in value
  );
}

export function adaptCellRenderers(
  renderers: ReactCellRendererRegistry | undefined,
): CellRendererRegistry | undefined {
  if (!renderers) return undefined;

  const adapted: CellRendererRegistry = {};

  for (const [key, renderer] of Object.entries(renderers)) {
    if (renderer.mode !== 'custom') {
      adapted[key] = renderer;
      continue;
    }

    const coreRenderer: ActionCellRenderer = {
      kind: 'actions',
      mode: 'custom',
      render: (ctx) => {
        const root = createRoot(ctx.host);
        const renderCtx = {
          row: ctx.row,
          rowIndex: ctx.rowIndex,
          rowId: ctx.rowId,
          column: ctx.column,
          grid: ctx.grid,
          close: ctx.close,
        };
        const result = renderer.render(renderCtx);
        const node = isRenderResultObject(result) ? result.node : result;
        const userCleanup = isRenderResultObject(result)
          ? result.cleanup
          : undefined;

        // Core popup owners focus freshly rendered custom content before their
        // open transaction returns. Match the header-renderer adapter and make
        // the initial React commit part of that same transaction.
        flushSync(() => {
          root.render(node);
        });

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
