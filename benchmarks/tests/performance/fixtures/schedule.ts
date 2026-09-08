import {
  requiredOperationsForPurpose,
  type SlotPurpose,
} from "../../../shared/src/filterScenarios.ts";
import { LFG_QUICK_SEARCH_MODES, type LfgQuickSearchMode } from "../../../shared/src/lfgQuickSearchMode.ts";
import { SCHEDULE_SEED } from "./profiles.ts";

export type { SlotPurpose };

export type ScheduleRole = "warmup" | "measured";

export type ScheduleSlot = {
  readonly lane: "react" | "vanilla";
  readonly round: number;
  readonly role: ScheduleRole;
  readonly appId: string;
  readonly product: "lightfastgrid" | "ag-grid";
  readonly lfgMode: LfgQuickSearchMode | null;
  readonly purpose: SlotPurpose;
  readonly orderInRound: number;
};

export type LaneSchedule = {
  readonly lane: "react" | "vanilla";
  readonly products: {
    readonly A: string;
    readonly B: string;
  };
  readonly algorithm: "alternating-ab-ba";
  readonly seed: number;
  readonly slots: readonly ScheduleSlot[];
};

const LANE_PRODUCTS = {
  react: { A: "lightfastgrid", B: "ag-grid" },
  vanilla: { A: "lightfastgrid-vanilla", B: "ag-grid-vanilla" },
} as const;

export type RoundIdentity = {
  readonly appId: string;
  readonly product: "lightfastgrid" | "ag-grid";
  readonly lfgMode: LfgQuickSearchMode | null;
  readonly purpose: SlotPurpose;
};

function identitiesForLane(lane: "react" | "vanilla"): RoundIdentity[] {
  const lfg = LANE_PRODUCTS[lane].A;
  const ag = LANE_PRODUCTS[lane].B;
  return [
    {
      appId: lfg,
      product: "lightfastgrid",
      lfgMode: null,
      purpose: "competitive",
    },
    {
      appId: ag,
      product: "ag-grid",
      lfgMode: null,
      purpose: "competitive",
    },
    ...LFG_QUICK_SEARCH_MODES.map((lfgMode) => ({
      appId: lfg,
      product: "lightfastgrid" as const,
      lfgMode,
      purpose: "quickSearch" as const,
    })),
    {
      appId: ag,
      product: "ag-grid",
      lfgMode: null,
      purpose: "quickSearch",
    },
  ];
}

function orderForRound(round: number, identities: readonly RoundIdentity[]): RoundIdentity[] {
  return round % 2 === 0 ? [...identities] : [...identities].reverse();
}

export function buildLaneSchedule(
  lane: "react" | "vanilla",
  warmupRounds: number,
  measuredRounds: number,
): LaneSchedule {
  const products = LANE_PRODUCTS[lane];
  const identities = identitiesForLane(lane);
  const slots: ScheduleSlot[] = [];
  const totalRounds = warmupRounds + measuredRounds;
  for (let round = 0; round < totalRounds; round += 1) {
    const role: ScheduleRole = round < warmupRounds ? "warmup" : "measured";
    const order = orderForRound(round, identities);
    order.forEach((identity, orderInRound) => {
      slots.push({
        lane,
        round,
        role,
        appId: identity.appId,
        product: identity.product,
        lfgMode: identity.lfgMode,
        purpose: identity.purpose,
        orderInRound,
      });
    });
  }
  return {
    lane,
    products,
    algorithm: "alternating-ab-ba",
    seed: SCHEDULE_SEED,
    slots,
  };
}

export function buildRuntimeSchedule(warmupRounds: number, measuredRounds: number) {
  return {
    algorithm: "alternating-ab-ba" as const,
    seed: SCHEDULE_SEED,
    description:
      "Each lane runs independent AB/BA rounds. Competitive slots measure one canonical LightFastGrid product-default identity and AG Grid for Mount/Sort/Filter/Reset/Scroll. Quick Search slots then measure LightFastGrid workerIsolated, forced main thread, and production optimized, plus AG Grid, for Quick Search only. Odd rounds reverse the full list. AG Grid is measured once per equivalent scenario per round. React and Vanilla never share a page or a ranking.",
    lanes: {
      react: buildLaneSchedule("react", warmupRounds, measuredRounds),
      vanilla: buildLaneSchedule("vanilla", warmupRounds, measuredRounds),
    },
  };
}

export function slotIdentityKey(slot: {
  readonly appId: string;
  readonly purpose: SlotPurpose;
  readonly lfgMode: string | null;
}): string {
  return `${slot.appId}:${slot.purpose}:${slot.lfgMode ?? "default"}`;
}

export { requiredOperationsForPurpose };
