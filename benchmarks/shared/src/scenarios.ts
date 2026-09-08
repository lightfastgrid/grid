import columnsConfig from "../columns.json" with { type: "json" };
import scenariosConfig from "../scenarios.json" with { type: "json" };
import valuePools from "../value-pools.json" with { type: "json" };

import type { ColumnKind, NeutralColumn } from "./benchmarkProtocol.ts";

export type ScenarioName = keyof typeof scenariosConfig.scenarios;

export type ScenarioDefinition = {
  readonly label: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly optIn: boolean;
  readonly memoryIntensive: boolean;
  readonly note?: string;
};

type BaseColumnJson = {
  readonly field: string;
  readonly headerName: string;
  readonly kind: ColumnKind;
  readonly pool?: string;
  readonly min?: number;
  readonly max?: number;
};

export const SCENARIO_SEED = scenariosConfig.seed;
export const DEFAULT_SCENARIO_NAME = scenariosConfig.defaultScenario;
export const COLUMN_WIDTH_PX = columnsConfig.columnWidthPx;

export function getScenario(
  name: string,
): ScenarioDefinition & { readonly name: string } {
  const scenario = (
    scenariosConfig.scenarios as Record<string, ScenarioDefinition | undefined>
  )[name];
  if (!scenario) {
    throw new Error(
      `Unknown benchmark scenario "${name}". Valid names: ${Object.keys(scenariosConfig.scenarios).join(", ")}`,
    );
  }
  return { name, ...scenario };
}

export function listScenarioNames(): string[] {
  return Object.keys(scenariosConfig.scenarios);
}

export function listDefaultScenarioNames(): string[] {
  return listScenarioNames().filter((name) => !getScenario(name).optIn);
}

export function assertScenarioAllowed(
  name: string,
  allowExtreme: boolean,
): ScenarioDefinition & { readonly name: string } {
  const scenario = getScenario(name);
  if (scenario.optIn && !allowExtreme) {
    throw new Error(
      `Scenario "${name}" is memory-intensive and opt-in. Pass allowExtreme: true or open the app with ?extreme=1. It is never run automatically.`,
    );
  }
  return scenario;
}

export function isExtremeOptInRequested(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("extreme") === "1" || params.get("scenario") === "extreme";
}

const KIND_CYCLE = columnsConfig.extraKindCycle as ColumnKind[];

function extraHeaderName(kind: ColumnKind, serial: number): string {
  switch (kind) {
    case "number":
      return `Metric ${serial}`;
    case "date":
      return `Date ${serial}`;
    case "status":
      return `Flag ${serial}`;
    default:
      return `Text ${serial}`;
  }
}

function extraPool(kind: ColumnKind): string | undefined {
  if (kind === "text") return "notes";
  if (kind === "status") return "statuses";
  return undefined;
}

export function createColumns(columnCount: number): NeutralColumn[] {
  if (columnCount < 1) {
    throw new Error("columnCount must be at least 1");
  }
  const base = columnsConfig.baseColumns as BaseColumnJson[];
  const columns: NeutralColumn[] = [];
  for (let index = 0; index < columnCount; index += 1) {
    if (index < base.length) {
      const def = base[index]!;
      columns.push({
        field: def.field,
        headerName: def.headerName,
        kind: def.kind,
        width: COLUMN_WIDTH_PX,
        sortable: true,
        filterable: true,
        searchable: true,
        pool: def.pool,
        min: def.min,
        max: def.max,
      });
      continue;
    }
    const serial = index - base.length + 1;
    const kind = KIND_CYCLE[(serial - 1) % KIND_CYCLE.length]!;
    const padded = String(serial).padStart(2, "0");
    columns.push({
      field: `${columnsConfig.extraFieldPrefix}_${padded}`,
      headerName: extraHeaderName(kind, serial),
      kind,
      width: COLUMN_WIDTH_PX,
      sortable: true,
      filterable: true,
      searchable: true,
      pool: extraPool(kind),
      min: kind === "number" ? 0 : undefined,
      max: kind === "number" ? 10_000 : undefined,
    });
  }
  return columns;
}

export function getValuePools(): typeof valuePools {
  return valuePools;
}
