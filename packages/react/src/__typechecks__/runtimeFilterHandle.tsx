import { createRef } from 'react';

import type { ReactLightFastGridHandle } from '../types';

const gridRef = createRef<ReactLightFastGridHandle>();

gridRef.current?.setFilterModel({ name: { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] } });
gridRef.current?.setFilterModel({}, 'api');
gridRef.current?.getFilterModel();
gridRef.current?.clearFilters();
gridRef.current?.clearFilters('ui');

gridRef.current?.setColumnFilterModel('name', { type: 'text', operator: 'and', conditions: [{ operator: 'contains', value: 'a' }] });
gridRef.current?.setColumnFilterModel('name', null, 'ui');
gridRef.current?.getColumnFilterModel('name');
gridRef.current?.clearColumnFilter('name');
gridRef.current?.clearColumnFilter('name', 'api');

void gridRef;
