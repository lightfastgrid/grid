import type {
  ColumnDef,
  HeaderActionGridApi,
  HeaderActionRenderContext,
  HeaderActionRendererRegistry,
} from "../../types";
import { FloatingController } from "../floating/FloatingController";

import { HEADER_ACTION_TRIGGER_CLASS } from "./headerActionDom";

export interface HeaderActionControllerOptions {
  gridRoot: HTMLElement;
  viewport: HTMLElement;
  getColumns: () => ColumnDef[];
  getHeaderRenderers: () => HeaderActionRendererRegistry | undefined;
  getSelectedColumnIds: () => string[];
  getHeaderActionGridApi: () => HeaderActionGridApi;
}

export class HeaderActionController {
  private root: HTMLElement | null = null;
  private readonly floating: FloatingController;
  private readonly options: HeaderActionControllerOptions;
  private openKey: string | null = null;

  constructor(options: HeaderActionControllerOptions) {
    this.options = options;
    this.floating = new FloatingController(options.gridRoot, options.viewport);
  }

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    this.root.addEventListener("click", this.onClick);
  }

  detach(): void {
    this.floating.destroy();
    this.openKey = null;
    if (this.root) {
      this.root.removeEventListener("click", this.onClick);
      this.root = null;
    }
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;

    const target = event.target as Element | null;
    if (!target) return;

    const trigger = target.closest(
      `.${HEADER_ACTION_TRIGGER_CLASS}`,
    ) as HTMLButtonElement | null;
    if (!trigger || trigger.disabled) return;
    if (trigger.getAttribute("aria-disabled") === "true") return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const field = trigger.getAttribute("data-col-id");
    const actionId = trigger.getAttribute("data-header-action-id");
    const rendererKey = trigger.getAttribute("data-header-action-renderer-key");
    if (!field || !actionId || !rendererKey) return;

    const openKey = this.createOpenKey(field, actionId, rendererKey);
    if (this.openKey === openKey) {
      this.floating.close();
      this.openKey = null;
      return;
    }

    const columns = this.options.getColumns();
    const column = columns.find((c) => c.field === field);
    if (!column) return;

    const action = column.headerActions?.find((a) => a.id === actionId);
    if (!action || action.hidden || action.disabled) return;
    if (action.rendererKey !== rendererKey) return;

    const renderer = this.options.getHeaderRenderers()?.[rendererKey];
    if (!renderer) return;

    const selectedColumnIds = this.options.getSelectedColumnIds();
    const gridApi = this.options.getHeaderActionGridApi();
    const close = (): void => {
      this.floating.close();
      this.openKey = null;
    };

    this.floating.open({
      anchorEl: trigger,
      placement: action.placement ?? "bottom-center",
      arrow: true,
      closeOnOutsideClick: true,
      closeOnScroll: true,
      closeOnEscape: true,
      render: (host) => {
        const renderCtx: HeaderActionRenderContext = {
          host,
          field,
          column,
          columns,
          selectedColumnIds,
          grid: gridApi,
          close,
        };
        return renderer.render(renderCtx);
      },
      onClose: () => {
        this.openKey = null;
      },
    });

    this.openKey = openKey;
  };

  private createOpenKey(
    field: string,
    actionId: string,
    rendererKey: string,
  ): string {
    return `${field}\u0000${actionId}\u0000${rendererKey}`;
  }
}
