import type { ActionMenuCellRenderer, RowData } from '@lightfastgrid/core';

import type {
  ReactCellRendererRegistry,
  ReactRowActionRenderContext,
} from '../types';

function MyDropdown({
  row,
  close,
}: {
  row: RowData;
  close: () => void;
}) {
  return (
    <button type="button" onClick={close}>
      {String(row.id ?? '')}
    </button>
  );
}

const menuRenderer: ActionMenuCellRenderer = {
  kind: 'actions',
  getActions: () => [{ id: 'edit', label: 'Edit' }],
  onAction: ({ close }) => {
    close();
  },
};

const registry: ReactCellRendererRegistry = {
  menu: menuRenderer,
  customComponent: {
    kind: 'actions',
    mode: 'custom',
    render: ({ row, close }) => (
      <MyDropdown row={row} close={close} />
    ),
  },
};

const acceptsHostlessContext = (ctx: ReactRowActionRenderContext) => {
  return (
    <MyDropdown row={ctx.row} close={ctx.close} />
  );
};

void registry;
void acceptsHostlessContext;
