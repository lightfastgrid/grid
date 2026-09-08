import type {
  CsvExportCapability,
  CsvExportParams,
  CsvExportResult,
  CsvExportTask,
} from '@lightfastgrid/core';
import { createRef } from 'react';

import type {
  ReactLightFastGridHandle,
  ReactLightFastGridProps,
} from '../types';

type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends
      (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false;

const exactSignatures: [
  IsExact<
    ReactLightFastGridHandle['exportDataAsCsv'],
    CsvExportCapability['exportDataAsCsv']
  >,
  IsExact<
    ReactLightFastGridHandle['getDataAsCsv'],
    CsvExportCapability['getDataAsCsv']
  >,
] = [true, true];

const gridRef = createRef<ReactLightFastGridHandle>();

const task: CsvExportTask | undefined = gridRef.current?.exportDataAsCsv();
const paramsTask: CsvExportTask | undefined = gridRef.current?.exportDataAsCsv({
  fileName: 'orders.csv',
  rows: { mode: 'selected' },
  columns: { mode: 'fields', fields: ['name', 'price'] },
  output: { type: 'blob' },
  utf8Bom: true,
  onProgress: (progress) => void progress.emittedBytes,
});

const text: Promise<string> | undefined = gridRef.current?.getDataAsCsv();
const paramsText: Promise<string> | undefined = gridRef.current?.getDataAsCsv({
  fileName: 'orders.csv',
  rows: { mode: 'all' },
});

const standaloneParams: CsvExportParams = { output: { type: 'text' } };
const props: ReactLightFastGridProps = {
  csvExport: {
    fileName: 'react-export.csv',
    includeColumnHeaders: false,
  },
  onCsvExportProgress: (progress) => void progress.processedRows,
  onCsvExportCompleted: (result) => void result.byteLength,
  onCsvExportCancelled: (event) => void event.taskId,
  onCsvExportError: (event) => void event.error,
};

async function consume(): Promise<void> {
  const result: CsvExportResult | undefined = await task?.promise;
  void result;
  void (await paramsTask?.promise);
  void (await text);
  void (await paramsText);
}

void exactSignatures;
void gridRef;
void standaloneParams;
void props;
void consume;
