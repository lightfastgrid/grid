import type {
  GridOverlayOptions,
  GridOverlaysOptions,
} from '@lightfastgrid/core';

import {
  createOverlayReactMount,
  teardownOverlayReactRoot,
} from './overlayReactRoot';
import type {
  ReactGridOverlaysOptions,
  ReactOverlayOptions,
  ReactOverlayRenderResult,
  ReactOverlayRenderReturn,
} from './types';

function isRenderResultObject(
  value: ReactOverlayRenderReturn,
): value is ReactOverlayRenderResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'node' in value
  );
}

/**
 * Adapt one React overlay variant into a core variant.
 *
 * - When `render` is omitted, pass `text`/`className` through unchanged.
 * - When `render` exists, the core `render({ host, kind, grid })` callback
 *   creates a React root on a child mount node inside `host`, calls the user
 *   render with `{ kind, grid }`, mounts the returned node, and returns a
 *   cleanup that unmounts the root and runs any user-supplied cleanup.
 */
function adaptOverlayOptions(
  options: ReactOverlayOptions,
): GridOverlayOptions {
  const { text, className, render } = options;
  if (!render) {
    return { text, className };
  }
  return {
    text,
    className,
    render: ({ host, kind, grid }) => {
      const { root, mount } = createOverlayReactMount(host);
      const result = render({ kind, grid });
      const node = isRenderResultObject(result) ? result.node : result;
      const userCleanup = isRenderResultObject(result)
        ? result.cleanup
        : undefined;

      root.render(node);

      return () => {
        userCleanup?.();
        teardownOverlayReactRoot(root, mount);
      };
    },
  };
}

/**
 * Adapt React overlay options to core overlay options. Returns `undefined`
 * when input is `undefined` so reference identity is preserved upstream.
 */
export function adaptOverlays(
  overlays: ReactGridOverlaysOptions | undefined,
): GridOverlaysOptions | undefined {
  if (!overlays) return undefined;
  const out: GridOverlaysOptions = {};
  if (overlays.loading) out.loading = adaptOverlayOptions(overlays.loading);
  if (overlays.noRows) out.noRows = adaptOverlayOptions(overlays.noRows);
  if (overlays.noMatchingRows) {
    out.noMatchingRows = adaptOverlayOptions(overlays.noMatchingRows);
  }
  return out;
}
