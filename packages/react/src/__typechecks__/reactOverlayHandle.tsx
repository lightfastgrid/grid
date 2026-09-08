import { createRef } from 'react';

import type {
  ReactLightFastGridHandle,
  ReactOverlayRenderContext,
} from '../types';

// The React handle works with createRef and the React overlay options shape.
const gridRef = createRef<ReactLightFastGridHandle>();

// setOverlays accepts a React render returning JSX.
gridRef.current?.setOverlays({
  loading: { render: () => <div /> },
});

// text/className-only variants also typecheck.
gridRef.current?.setOverlays({
  noRows: { text: 'No rows', className: 'empty a b' },
});

// Other handle methods remain available (handle is a superset minus setOverlays).
gridRef.current?.setLoading(true);
gridRef.current?.showNoMatchingRowsOverlay();
gridRef.current?.hideOverlay();

// The React overlay render context exposes `kind` and `grid`.
function readContext(ctx: ReactOverlayRenderContext): void {
  void ctx.kind;
  void ctx.grid;
}

// Type-level proof that the React overlay context does NOT expose `host`:
// `"host"` must not be assignable to the context's key union.
type ContextHasNoHost = 'host' extends keyof ReactOverlayRenderContext
  ? never
  : true;
const noHostExposed: ContextHasNoHost = true;

void gridRef;
void readContext;
void noHostExposed;
