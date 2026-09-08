import type { GridApi, GridCreateOptions } from '@lightfastgrid/core';
import type {
  ReactLightFastGridHandle,
  ReactLightFastGridProps,
} from '@lightfastgrid/react';
import type { CSSProperties } from 'react';

declare const handle: ReactLightFastGridHandle;

const api: Omit<GridApi, 'setOverlays'> = handle;
const options: GridCreateOptions = { columns: [], rows: [] };
const style: CSSProperties = { height: '100%' };
const props: ReactLightFastGridProps = {
  columns: options.columns,
  rows: options.rows,
  height: 500,
  className: 'consumer-grid',
  style,
  immutableRows: true,
};

handle.getInstance();
void api;
void props;
