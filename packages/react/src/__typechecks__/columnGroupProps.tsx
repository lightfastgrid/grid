import { createRef } from 'react';

import type { ReactLightFastGridHandle } from '../types';
import type { ReactLightFastGridProps } from '../types';

const gridRef = createRef<ReactLightFastGridHandle>();

const _flatColumns: ReactLightFastGridProps = {
  columns: [
    { field: 'name', headerName: 'Name' },
    { field: 'email', headerName: 'Email' },
  ],
  rows: [],
};

const _groupedColumns: ReactLightFastGridProps = {
  columns: [
    {
      headerName: 'Profile',
      groupId: 'profile',
      children: [
        { field: 'name', headerName: 'Name' },
        { field: 'email', headerName: 'Email' },
      ],
    },
    {
      headerName: 'Finance',
      children: [
        { field: 'balance', headerName: 'Balance', sortable: true },
        { field: 'rating', headerName: 'Rating', pinned: 'left' },
      ],
    },
  ],
  rows: [],
};

const _nestedGroups: ReactLightFastGridProps = {
  columns: [
    {
      headerName: 'Outer',
      groupId: 'outer',
      children: [
        {
          headerName: 'Inner',
          groupId: 'inner',
          children: [
            { field: 'deep', headerName: 'Deep', width: 120 },
          ],
        },
      ],
    },
  ],
  rows: [],
};

const _mixedFlatAndGrouped: ReactLightFastGridProps = {
  columns: [
    { field: 'standalone' },
    {
      headerName: 'Group',
      children: [{ field: 'grouped' }],
    },
  ],
  rows: [],
};

const _columnGroupHeadersToggle: ReactLightFastGridProps = {
  columns: [
    {
      headerName: 'Profile',
      children: [
        { field: 'name' },
        { field: 'email' },
      ],
    },
  ],
  rows: [],
  columnGroupHeaders: false,
};

const _columnGroupHeadersOptions: ReactLightFastGridProps = {
  columns: [{ field: 'a' }],
  rows: [],
  columnGroupHeaders: { enabled: true },
};

gridRef.current?.getInstance()?.setColumns([
  {
    headerName: 'Group',
    children: [
      { field: 'a', headerName: 'A' },
      { field: 'b', headerName: 'B' },
    ],
  },
]);

gridRef.current?.setColumnGroupHeaders(false);
gridRef.current?.setColumnGroupHeaders({ enabled: true });
const _enabled: boolean = gridRef.current?.isColumnGroupHeadersEnabled() ?? true;

void [
  _flatColumns,
  _groupedColumns,
  _nestedGroups,
  _mixedFlatAndGrouped,
  _columnGroupHeadersToggle,
  _columnGroupHeadersOptions,
  _enabled,
  gridRef,
];
