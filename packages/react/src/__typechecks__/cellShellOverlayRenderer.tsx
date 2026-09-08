import type {
  ReactCellShellOverlayRegistry,
  ReactCellShellOverlayRenderContext,
} from '../types';

function GameInfoOverlay({
  rowId,
  field,
  formattedValue,
  close,
}: {
  rowId: string;
  field: string;
  formattedValue: string;
  close: () => void;
}) {
  return (
    <div>
      <div>{rowId}</div>
      <div>{field}</div>
      <div>{formattedValue}</div>
      <button type="button" onClick={close}>Close</button>
    </div>
  );
}

const registry: ReactCellShellOverlayRegistry = {
  'game-info': {
    kind: 'cell-shell-overlay',
    render: ({ rowId, field, formattedValue, close }) => (
      <GameInfoOverlay
        rowId={rowId}
        field={field}
        formattedValue={formattedValue}
        close={close}
      />
    ),
  },
  'with-cleanup': {
    kind: 'cell-shell-overlay',
    render: (ctx) => ({
      node: <div>{ctx.value as string}</div>,
      cleanup: () => undefined,
    }),
  },
};

const acceptsHostlessContext = (ctx: ReactCellShellOverlayRenderContext) => {
  return (
    <GameInfoOverlay
      rowId={ctx.rowId}
      field={ctx.field}
      formattedValue={ctx.formattedValue}
      close={ctx.close}
    />
  );
};

void registry;
void acceptsHostlessContext;
