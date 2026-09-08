import type { NeutralFilterModel } from "./benchmarkProtocol.ts";
import { waitForGridEventThenRender } from "./completion.ts";
import {
  EMPTY_NEUTRAL_FILTER_MODEL,
  fromAgGridFilterModel,
  fromLightFastGridFilterModel,
  toAgGridFilterModel,
  toLightFastGridFilterModel,
} from "./neutralFilter.ts";

type LfgFilterHost = {
  on(event: "filter:changed", handler: (value?: unknown) => void): () => void;
  setFilterModel(model: Record<string, unknown>): void;
  clearFilters(): void;
  getFilterModel(): Record<string, unknown>;
};

type AgGridFilterHost = {
  addEventListener(event: "filterChanged", listener: () => void): void;
  removeEventListener(event: "filterChanged", listener: () => void): void;
  setFilterModel(model: Record<string, unknown> | null): void | Promise<void>;
  onFilterChanged(): void;
  getFilterModel(): Record<string, unknown> | null;
};

function subscribeLfgFilter(grid: LfgFilterHost) {
  return (handler: (value?: unknown) => void) => grid.on("filter:changed", handler);
}

function subscribeAgFilter(grid: AgGridFilterHost) {
  return (handler: (value?: unknown) => void) => {
    const listener = () => handler();
    grid.addEventListener("filterChanged", listener);
    return () => grid.removeEventListener("filterChanged", listener);
  };
}

export async function applyLightFastGridNeutralFilter(
  grid: LfgFilterHost,
  model: NeutralFilterModel,
  appLabel: string,
): Promise<void> {
  await waitForGridEventThenRender({
    appLabel,
    operation: "applyFilterModel",
    subscribe: subscribeLfgFilter(grid),
    afterSubscribe: () => {
      grid.setFilterModel(toLightFastGridFilterModel(model));
    },
  });
}

export async function clearLightFastGridNeutralFilter(
  grid: LfgFilterHost,
  appLabel: string,
): Promise<void> {
  if (Object.keys(grid.getFilterModel() ?? {}).length === 0) return;
  await waitForGridEventThenRender({
    appLabel,
    operation: "clearFilterModel",
    subscribe: subscribeLfgFilter(grid),
    afterSubscribe: () => {
      grid.clearFilters();
    },
  });
}

export function readLightFastGridNeutralFilter(grid: LfgFilterHost): NeutralFilterModel {
  return fromLightFastGridFilterModel(grid.getFilterModel());
}

export async function applyAgGridNeutralFilter(
  grid: AgGridFilterHost,
  model: NeutralFilterModel,
  appLabel: string,
): Promise<void> {
  await waitForGridEventThenRender({
    appLabel,
    operation: "applyFilterModel",
    subscribe: subscribeAgFilter(grid),
    afterSubscribe: async () => {
      await grid.setFilterModel(toAgGridFilterModel(model));
      grid.onFilterChanged();
    },
  });
}

export async function clearAgGridNeutralFilter(
  grid: AgGridFilterHost,
  appLabel: string,
): Promise<void> {
  const current = grid.getFilterModel();
  if (!current || Object.keys(current).length === 0) return;
  await waitForGridEventThenRender({
    appLabel,
    operation: "clearFilterModel",
    subscribe: subscribeAgFilter(grid),
    afterSubscribe: async () => {
      await grid.setFilterModel(null);
      grid.onFilterChanged();
    },
  });
}

export function readAgGridNeutralFilter(grid: AgGridFilterHost): NeutralFilterModel {
  return fromAgGridFilterModel(grid.getFilterModel()) ?? EMPTY_NEUTRAL_FILTER_MODEL;
}
