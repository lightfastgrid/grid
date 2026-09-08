import type { HeaderActionRendererRegistry } from '@lightfastgrid/core';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import type {
  ReactHeaderActionRenderResult,
  ReactHeaderActionRenderReturn,
  ReactHeaderRendererRegistry,
} from './types';

function isRenderResultObject(
  value: ReactHeaderActionRenderReturn,
): value is ReactHeaderActionRenderResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'node' in value
  );
}

export function adaptHeaderRenderers(
  renderers: ReactHeaderRendererRegistry | undefined,
): HeaderActionRendererRegistry | undefined {
  if (!renderers) return undefined;

  const adapted: HeaderActionRendererRegistry = {};

  for (const [key, renderer] of Object.entries(renderers)) {
    const coreRenderer: HeaderActionRendererRegistry[string] = {
      kind: 'header-action',
      mode: 'custom',
      render: (ctx) => {
        const root = createRoot(ctx.host);
        const renderCtx = {
          field: ctx.field,
          column: ctx.column,
          columns: ctx.columns,
          selectedColumnIds: ctx.selectedColumnIds,
          grid: ctx.grid,
          close: ctx.close,
        };
        const result = renderer.render(renderCtx);
        const node = isRenderResultObject(result) ? result.node : result;
        const userCleanup = isRenderResultObject(result)
          ? result.cleanup
          : undefined;

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
