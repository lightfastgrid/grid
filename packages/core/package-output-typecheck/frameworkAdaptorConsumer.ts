import {
  type CsvExportEventCallbacks,
  type CsvExportGridOptions,
  type CsvExportGridProps,
  Grid,
  type GridAdapterApi,
  type GridApi,
  type GridCreateOptions,
  type GridEventCallbacks,
  type GridEventSource,
  type GridLifecycle,
  type GridOptions,
  subscribeGridEventCallbacks,
} from "@lightfastgrid/core";

declare const source: GridEventSource;
declare const callbacks: GridEventCallbacks;
declare const host: HTMLElement;

const unsubscribe = subscribeGridEventCallbacks(source, () => callbacks);
unsubscribe();

const csvOptions: CsvExportGridOptions = { csvExport: true };
const csvCallbacks: CsvExportEventCallbacks = {
  onCsvExportCompleted: (event) => {
    event.byteLength.toFixed();
  },
};
const csvCompatibility: CsvExportGridProps = {
  ...csvOptions,
  ...csvCallbacks,
};

void csvOptions;
void csvCallbacks;
void csvCompatibility;

const options: GridOptions = {
  columns: [{ field: "name" }],
  rows: [{ name: "Alpha" }],
};
const createOptions: GridCreateOptions = {
  ...options,
  onSortChanged: () => undefined,
  onBeforeCellEditCommit: () => undefined,
};
const grid = new Grid(createOptions);
const api: GridApi = grid;
const adapterApi: GridAdapterApi = grid;
const lifecycle: GridLifecycle = grid;
const eventSource: GridEventSource = grid;

const vanillaUnsubscribers = [
  grid.on("selection:changed", (event) => event.selectedCount.toFixed()),
  grid.on("sort:changed", (event) => event.sortModel.length.toFixed()),
  grid.on("filter:changed", (event) => event.filteredRows.toFixed()),
  grid.on("csv-export:completed", (event) => event.byteLength.toFixed()),
];

grid.mount(host);
grid.setSelectedRowIds([]);
grid.setSortModel([{ field: "name", sort: "asc" }]);
grid.setFilterModel({});
grid.applyTransaction({ add: [{ name: "Beta" }] });
for (const unsubscribeVanilla of vanillaUnsubscribers) unsubscribeVanilla();

void api;
void adapterApi;
void lifecycle;
void eventSource;
grid.destroy();
