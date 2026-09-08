// @vitest-environment jsdom
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import type { GridOverlayRenderContext } from '@lightfastgrid/core';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { adaptOverlays } from '../adaptOverlays';

function makeCoreCtx(): GridOverlayRenderContext {
  return {
    host: document.createElement('div'),
    kind: 'loading',
    grid: null,
  };
}

describe('adaptOverlays', () => {
  it('returns undefined when input is undefined', () => {
    expect(adaptOverlays(undefined)).toBeUndefined();
  });

  it('passes text and className through when render is omitted', () => {
    const adapted = adaptOverlays({
      loading: { text: 'Loading…', className: 'a b' },
    })!;
    expect(adapted.loading).toEqual({
      text: 'Loading…',
      className: 'a b',
    });
  });

  it('mounts JSX on a child mount node; cleanup unmounts before host clear', () => {
    const userCleanup = vi.fn();
    const adapted = adaptOverlays({
      loading: {
        render: () => ({
          node: <div data-testid="overlay">Loading</div>,
          cleanup: userCleanup,
        }),
      },
    })!;

    const ctx = makeCoreCtx();
    let cleanup: (() => void) | void;

    act(() => {
      cleanup = adapted.loading!.render!(ctx);
    });

    const mount = ctx.host.querySelector('[data-lfg-overlay-react-mount]');
    expect(mount).not.toBeNull();
    expect(mount!.querySelector('[data-testid="overlay"]')).not.toBeNull();

    act(() => {
      cleanup!();
    });

    expect(userCleanup).toHaveBeenCalledTimes(1);
    expect(ctx.host.querySelector('[data-lfg-overlay-react-mount]')).toBeNull();

    ctx.host.replaceChildren();
    expect(ctx.host.childNodes.length).toBe(0);
  });
});
