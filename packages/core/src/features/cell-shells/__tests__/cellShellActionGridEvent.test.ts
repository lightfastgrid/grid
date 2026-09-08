// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";

function flushRender(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

describe("cell-shell action Grid event", () => {
  const mounted: Array<{ container: HTMLElement; grid: Grid }> = [];

  afterEach(() => {
    for (const entry of mounted) {
      entry.grid.destroy();
      entry.container.remove();
    }
    mounted.length = 0;
  });

  it("publishes the existing action payload through the typed event bus", async () => {
    const onCellShellAction = vi.fn();
    const grid = new Grid({
      rows: [{ id: "r1", action: "Open" }],
      columns: [
        {
          field: "action",
          cellShell: {
            kind: "button",
            actionKey: "open",
            text: { literal: "Open" },
          },
        },
      ],
      getRowId: (row) => row.id,
      onCellShellAction,
    });
    const eventObserver = vi.fn();
    grid.on("cell-shell:action", eventObserver);
    const container = document.createElement("div");
    document.body.appendChild(container);
    grid.mount(container);
    mounted.push({ container, grid });
    await flushRender();

    const trigger = container.querySelector<HTMLElement>(
      '[data-action="open"]',
    );
    expect(trigger).not.toBeNull();
    trigger!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );

    expect(eventObserver).toHaveBeenCalledTimes(1);
    expect(onCellShellAction).toHaveBeenCalledTimes(1);
    expect(eventObserver.mock.calls[0]![0]).toBe(
      onCellShellAction.mock.calls[0]![0],
    );
    expect(eventObserver.mock.calls[0]![0]).toMatchObject({
      actionKey: "open",
      rowId: "r1",
      rowIndex: 0,
      field: "action",
      value: "Open",
      formattedValue: "Open",
    });
  });
});
