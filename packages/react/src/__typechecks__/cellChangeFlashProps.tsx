import type {
  ColumnDef,
  LightFastGridColDef,
  LightFastGridDefaultColDef,
} from '@lightfastgrid/core';

import type { ReactLightFastGridProps } from '../types';

const column: ColumnDef = {
  field: 'name',
  cellChangeFlash: true,
};

const publicCol: LightFastGridColDef = {
  field: 'score',
  cellChangeFlash: false,
};

const defaults: LightFastGridDefaultColDef = {
  cellChangeFlash: true,
};

const props: ReactLightFastGridProps = {
  columns: [column, publicCol],
  rows: [],
  defaultColDef: defaults,
};

const disabled: ReactLightFastGridProps = {
  columns: [{ field: 'name', cellChangeFlash: false }],
  rows: [],
  defaultColDef: { cellChangeFlash: true },
};

void [props, disabled];
