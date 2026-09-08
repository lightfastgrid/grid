import { describe, expect, it } from "vitest";

import type { VisualRowLayout } from "../../../../internal/layoutTypes";
import type {
  ColumnDef,
  ColumnGroupHeadersSnapshot,
} from "../../../../types";
import { copyKeyboardTarget,createKeyboardTargetState } from "../keyboardTarget";
import { planKeyboardNavigationTopology } from "../planNavigationTopology";
import {
  createKeyboardNavigationScratch,
  type KeyboardNavigationContext,
  resolveKeyboardNavigationTarget,
} from "../resolveNavigationTarget";

const ROWS: VisualRowLayout = {
  topDisplayIndexes: [8],
  centerRowCount: 3,
  centerToDisplayIndex: (index) => index + 10,
  bottomDisplayIndexes: [30],
};

function createPlan(withGroups = true) {
  const columns: ColumnDef[] = [
    { field: "left", pinned: "left" },
    { field: "a" },
    { field: "b" },
    { field: "right", pinned: "right" },
  ];
  const columnGroupHeaders: ColumnGroupHeadersSnapshot | undefined = withGroups
    ? {
        depth: 2,
        byField: {
          left: { path: [{ id: "left", headerName: "Left", level: 0 }] },
          a: { path: [
            { id: "center", headerName: "Center", level: 0 },
            { id: "center/ab", headerName: "AB", level: 1 },
          ] },
          b: { path: [
            { id: "center", headerName: "Center", level: 0 },
            { id: "center/ab", headerName: "AB", level: 1 },
          ] },
          right: { path: [{ id: "right", headerName: "Right", level: 0 }] },
        },
      }
    : undefined;
  return planKeyboardNavigationTopology({
    columns,
    columnGroupHeaders,
    hasFloatingFilterRow: true,
    topologyRevision: 1,
  });
}

function context(
  writingDirection: "ltr" | "rtl" = "ltr",
): KeyboardNavigationContext {
  return {
    plan: createPlan(),
    rowLayout: ROWS,
    pageSize: 2,
    writingDirection,
  };
}

function move(
  current: ReturnType<typeof createKeyboardTargetState>,
  direction: Parameters<typeof resolveKeyboardNavigationTarget>[1],
  ctx = context(),
) {
  const scratch = createKeyboardNavigationScratch();
  const result = resolveKeyboardNavigationTarget(current, direction, ctx, scratch);
  if (result.moved) copyKeyboardTarget(current, scratch.candidate);
  return { result, target: { ...current }, scratch };
}

describe("Accessibility V2 pure navigation", () => {
  it("140/143/144: initializes in the body and crosses every header row", () => {
    const target = createKeyboardTargetState();
    expect(move(target, "right").target).toMatchObject({
      kind: "bodyCell",
      visualRowIndex: 0,
      displayRowIndex: 8,
      columnOrdinal: 0,
    });

    expect(move(target, "up").target.kind).toBe("floatingFilter");
    expect(move(target, "up").target.kind).toBe("leafHeader");
    expect(move(target, "up").target).toMatchObject({
      kind: "groupHeader",
      level: 0,
      spanIndex: 0,
    });
    expect(move(target, "down").target.kind).toBe("leafHeader");
    expect(move(target, "down").target.kind).toBe("floatingFilter");
    expect(move(target, "down").target.displayRowIndex).toBe(8);

    expect(move(target, "down").target.displayRowIndex).toBe(10);
    expect(move(target, "down").target.displayRowIndex).toBe(11);
    expect(move(target, "down").target.displayRowIndex).toBe(12);
    expect(move(target, "down").target.displayRowIndex).toBe(30);
    expect(move(target, "down").result.moved).toBe(false);
  });

  it("141: reverses horizontal arrows in RTL", () => {
    const target = createKeyboardTargetState();
    move(target, "right");
    target.columnOrdinal = 1;
    expect(move(target, "left", context("rtl")).target.columnOrdinal).toBe(2);
    expect(move(target, "right", context("rtl")).target.columnOrdinal).toBe(1);
  });

  it("keeps body navigation on data columns when internals precede them", () => {
    const plan = planKeyboardNavigationTopology({
      columns: [
        { field: "selection", internal: "selection" },
        { field: "a" },
        { field: "internal", internal: "selection" },
        { field: "b" },
      ],
      hasFloatingFilterRow: false,
      topologyRevision: 1,
    });
    const ctx: KeyboardNavigationContext = {
      plan,
      rowLayout: ROWS,
      pageSize: 2,
      writingDirection: "ltr",
    };
    const target = createKeyboardTargetState();

    expect(move(target, "right", ctx).target).toMatchObject({
      kind: "bodyCell",
      columnOrdinal: 1,
    });
    expect(move(target, "left", ctx).result.moved).toBe(false);
    expect(move(target, "right", ctx).target.columnOrdinal).toBe(3);
    expect(move(target, "home", ctx).target.columnOrdinal).toBe(1);
    expect(move(target, "end", ctx).target.columnOrdinal).toBe(3);
  });

  it("142: moves adjacent group spans and follows group depth", () => {
    const target = createKeyboardTargetState();
    target.kind = "groupHeader";
    target.level = 0;
    target.spanIndex = 1;
    target.anchorColumnOrdinal = 1;

    expect(move(target, "down").target).toMatchObject({
      kind: "groupHeader",
      level: 1,
      anchorColumnOrdinal: 1,
    });
    expect(move(target, "down").target.kind).toBe("leafHeader");
    expect(move(target, "up").target.kind).toBe("groupHeader");
    expect(move(target, "up").target.level).toBe(0);
    expect(move(target, "right").target).toMatchObject({
      kind: "groupHeader",
      spanIndex: 2,
      anchorColumnOrdinal: 3,
    });
  });

  it("145/146: applies local/global boundaries and page clamping", () => {
    const target = createKeyboardTargetState();
    move(target, "right");
    target.columnOrdinal = 2;
    target.visualRowIndex = 2;
    target.displayRowIndex = 11;

    expect(move(target, "home").target.columnOrdinal).toBe(0);
    expect(move(target, "end").target.columnOrdinal).toBe(3);
    expect(move(target, "firstTarget").target).toMatchObject({
      kind: "groupHeader",
      level: 0,
      spanIndex: 0,
    });
    expect(move(target, "lastTarget").target).toMatchObject({
      kind: "bodyCell",
      visualRowIndex: 4,
      displayRowIndex: 30,
      columnOrdinal: 3,
    });
    expect(move(target, "pageUp").target.visualRowIndex).toBe(2);
    expect(move(target, "pageUp").target.visualRowIndex).toBe(0);
    expect(move(target, "pageUp").result.moved).toBe(false);
  });

  it("147/156: normalizes malformed targets and reuses scratch identities", () => {
    const current = createKeyboardTargetState();
    current.kind = "bodyCell";
    current.visualRowIndex = Number.NaN;
    current.displayRowIndex = -50;
    current.columnOrdinal = Number.POSITIVE_INFINITY;
    const scratch = createKeyboardNavigationScratch();
    const normalized = scratch.normalized;
    const candidate = scratch.candidate;
    const ctx = context();

    for (let i = 0; i < 1_000; i++) {
      resolveKeyboardNavigationTarget(current, "right", ctx, scratch);
    }

    expect(scratch.normalized).toBe(normalized);
    expect(scratch.candidate).toBe(candidate);
    expect(scratch.normalized).toMatchObject({
      kind: "bodyCell",
      visualRowIndex: 0,
      displayRowIndex: 8,
      columnOrdinal: 0,
    });

    const staleGroup = createKeyboardTargetState();
    staleGroup.kind = "groupHeader";
    staleGroup.level = 0;
    staleGroup.spanIndex = 1;
    staleGroup.anchorColumnOrdinal = -50;
    resolveKeyboardNavigationTarget(staleGroup, "end", ctx, scratch);
    expect(scratch.normalized.anchorColumnOrdinal).toBe(1);

    Reflect.set(staleGroup, "kind", "invalid");
    expect(
      resolveKeyboardNavigationTarget(staleGroup, "right", ctx, scratch).moved,
    ).toBe(false);
  });
});
