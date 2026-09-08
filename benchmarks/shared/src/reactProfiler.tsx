import type { ReactNode } from "react";
import { Profiler, useCallback, useMemo, useState } from "react";

import type { GridBenchmarkReactProfileSummary } from "./benchmarkProtocol.ts";

type ProfileBridge = {
  enabled: boolean;
  summary: GridBenchmarkReactProfileSummary | null;
};

const defaultBridge: ProfileBridge = {
  enabled: false,
  summary: null,
};

export function useOptionalReactProfiler(): {
  wrap(children: ReactNode): ReactNode;
  getSummary(): GridBenchmarkReactProfileSummary | null;
  setEnabled(enabled: boolean): void;
} {
  const [bridge, setBridge] = useState<ProfileBridge>(defaultBridge);

  const onRender = useCallback((_id: string, _phase: string, actualDuration: number) => {
    setBridge((current) => {
      if (!current.enabled) return current;
      const commitCount = (current.summary?.commitCount ?? 0) + 1;
      const totalActualDurationMs =
        (current.summary?.totalActualDurationMs ?? 0) + actualDuration;
      const maxActualDurationMs = Math.max(
        current.summary?.maxActualDurationMs ?? 0,
        actualDuration,
      );
      return {
        enabled: true,
        summary: { commitCount, totalActualDurationMs, maxActualDurationMs },
      };
    });
  }, []);

  return useMemo(
    () => ({
      wrap(children: ReactNode) {
        if (!bridge.enabled) return children;
        return (
          <Profiler id="grid-benchmark" onRender={onRender}>
            {children}
          </Profiler>
        );
      },
      getSummary() {
        return bridge.summary;
      },
      setEnabled(enabled: boolean) {
        setBridge({
          enabled,
          summary: enabled ? { commitCount: 0, totalActualDurationMs: 0, maxActualDurationMs: 0 } : null,
        });
      },
    }),
    [bridge.enabled, bridge.summary, onRender],
  );
}
