import type { LightFastGridColumnInput, RowData } from "@lightfastgrid/core";
import { useEffect, useState } from "react";

import { loadGridDataset, resolveGridDatasetUrl } from "./loadGridDataset";

export interface GridDatasetState {
  rows: RowData[];
  columns: LightFastGridColumnInput[];
  loading: boolean;
  error: string | null;
}

interface DatasetSnapshot {
  url: string;
  rows: RowData[];
  columns: LightFastGridColumnInput[];
  loading: boolean;
  error: string | null;
}

/**
 * Dataset loading for gridDemo: mount the grid and keep `loading` set until
 * the fetch completes.
 */
export function useGridDataset(url?: string): GridDatasetState {
  const datasetUrl = url ?? resolveGridDatasetUrl();
  const [snapshot, setSnapshot] = useState<DatasetSnapshot>(() => ({
    url: datasetUrl,
    rows: [],
    columns: [],
    loading: true,
    error: null,
  }));

  useEffect(() => {
    const abortController = new AbortController();

    void loadGridDataset(datasetUrl, { signal: abortController.signal })
      .then((dataset) => {
        setSnapshot({
          url: datasetUrl,
          rows: dataset.rowData,
          columns: dataset.columnDefs,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (abortController.signal.aborted) return;
        console.error(err);
        setSnapshot({
          url: datasetUrl,
          rows: [],
          columns: [],
          loading: false,
          error:
            err instanceof Error ? err.message : "Failed to load dataset",
        });
      });

    return () => {
      abortController.abort();
    };
  }, [datasetUrl]);

  const loading = snapshot.loading || snapshot.url !== datasetUrl;

  return {
    rows: snapshot.rows,
    columns: snapshot.columns,
    loading,
    error: snapshot.error,
  };
}
