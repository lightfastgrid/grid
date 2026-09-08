import type { LightFastGridHandle } from '@lightfastgrid/core';
import { createRef } from 'react';

const gridRef = createRef<LightFastGridHandle>();

gridRef.current?.setSelectedRowIds(['r1']);
gridRef.current?.setSelectedColumnIds(['name']);

void gridRef;
