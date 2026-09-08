import type {
  GridApi,
  GridCreateOptions,
  GridOptions,
} from '@lightfastgrid/core';
import type { CSSProperties } from 'react';

import type {
  ReactGridOverlaysOptions,
  ReactLightFastGridHandle,
  ReactLightFastGridProps,
} from '../types';

type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

function assertTrue<T extends true>(_value: T): void {}

type ReactOnlyKey = 'height' | 'className' | 'style' | 'immutableRows';

assertTrue<IsExact<Extract<keyof GridOptions, ReactOnlyKey>, never>>(true);
assertTrue<
  IsExact<Exclude<keyof ReactLightFastGridHandle, keyof GridApi>, 'getInstance'>
>(true);
assertTrue<
  IsExact<
    ReactLightFastGridHandle['setOverlays'],
    (overlays?: ReactGridOverlaysOptions) => void
  >
>(true);
assertTrue<
  IsExact<Extract<keyof ReactLightFastGridProps, ReactOnlyKey>, ReactOnlyKey>
>(true);

const style: CSSProperties = { minHeight: 240 };
const core: GridCreateOptions = { columns: [], rows: [] };
declare const handle: ReactLightFastGridHandle;
const api: Omit<GridApi, 'setOverlays'> = handle;
const react: ReactLightFastGridProps = {
  columns: core.columns,
  rows: core.rows,
  height: 400,
  className: 'grid',
  style,
  immutableRows: true,
};

void react;
void api;
