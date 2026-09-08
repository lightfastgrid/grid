import type {
  CsvExportCapability,
  CsvExportResult,
  CsvExportTask,
} from '@lightfastgrid/core';
import {
  LightFastGrid,
  type ReactLightFastGridHandle,
  type ReactLightFastGridProps,
} from '@lightfastgrid/react';
import { createRef } from 'react';

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

const props: ReactLightFastGridProps = {
  rows: [{ id: 'one', value: 'One' }],
  columns: [{ field: 'value' }],
  csvExport: { includeColumnHeaders: false },
};
const ref = createRef<ReactLightFastGridHandle>();
const element = <LightFastGrid {...props} ref={ref} />;

function consumeBuiltHandle(handle: ReactLightFastGridHandle): {
  task: CsvExportTask;
  text: Promise<string>;
  result: Promise<CsvExportResult>;
} {
  const task = handle.exportDataAsCsv({ output: { type: 'text' } });
  const text = handle.getDataAsCsv({ rows: { mode: 'all' } });
  return { task, text, result: task.promise };
}

void exactSignatures;
void element;
void consumeBuiltHandle;
