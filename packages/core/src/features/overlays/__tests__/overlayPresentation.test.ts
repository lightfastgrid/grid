// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  GridOverlayKind,
  GridOverlaysOptions,
  LightFastGridOverlayPresentationChangedEvent,
} from "../../../types";
import { OverlayController } from "../OverlayController";
import {
  MAX_OVERLAY_PRESENTATION_TEXT_LENGTH,
  resolveOverlayPresentation,
} from "../overlayPresentation";

describe("overlay presentation semantics", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("resolves default, blank, custom, and bounded status text", () => {
    expect(resolveOverlayPresentation("loading", undefined)).toEqual({
      kind: "loading",
      text: "Loading...",
    });
    expect(
      resolveOverlayPresentation("noRows", { text: "   " }),
    ).toEqual({
      kind: "noRows",
      text: "No rows",
    });
    expect(
      resolveOverlayPresentation("noMatchingRows", {
        text: "  Nothing matched  ",
      }),
    ).toEqual({
      kind: "noMatchingRows",
      text: "Nothing matched",
    });
    expect(
      resolveOverlayPresentation("loading", {
        text: `  ${"x".repeat(
          MAX_OVERLAY_PRESENTATION_TEXT_LENGTH + 100,
        )}`,
      }).text,
    ).toHaveLength(MAX_OVERLAY_PRESENTATION_TEXT_LENGTH);
    expect(
      resolveOverlayPresentation("noRows", {
        text: '<img src="x" onerror="throw new Error()">',
      }).text,
    ).toBe('<img src="x" onerror="throw new Error()">');
  });

  it("publishes accepted semantic changes and stays silent when unchanged", () => {
    let state: {
      loading: boolean;
      manualOverlay: GridOverlayKind | null;
      overlays?: GridOverlaysOptions;
    } = {
      loading: true,
      manualOverlay: null,
    };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const changes: LightFastGridOverlayPresentationChangedEvent[] = [];
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => state,
      getDisplayRowCount: () => 1,
      getGridInstance: () => null,
      onPresentationChanged: (event) => changes.push(event),
    });

    controller.sync();
    controller.sync();
    expect(changes).toEqual([{ kind: "loading", text: "Loading..." }]);

    state = {
      ...state,
      overlays: { loading: { className: "visual-only" } },
    };
    controller.sync();
    expect(changes).toHaveLength(1);

    state = {
      ...state,
      overlays: { loading: { text: "Fetching records" } },
    };
    controller.sync();
    expect(changes[changes.length - 1]).toEqual({
      kind: "loading",
      text: "Fetching records",
    });

    state = {
      loading: true,
      manualOverlay: "noMatchingRows",
      overlays: {
        noMatchingRows: { text: "No matching employees" },
      },
    };
    controller.sync();
    expect(changes[changes.length - 1]).toEqual({
      kind: "noMatchingRows",
      text: "No matching employees",
    });

    state = { ...state, loading: false, manualOverlay: null };
    controller.sync();
    expect(changes[changes.length - 1]).toEqual({
      kind: null,
      text: null,
    });

    controller.destroy();
    expect(changes[changes.length - 1]).toEqual({
      kind: null,
      text: null,
    });
  });

  it("uses configured text for custom DOM without inspecting or rerunning it", () => {
    const render = vi.fn(({ host }: { host: HTMLElement }) => {
      host.textContent = "Complex visual content";
    });
    const onPresentationChanged = vi.fn();
    const state = {
      loading: true,
      manualOverlay: null,
      overlays: {
        loading: {
          text: "Loading employee records",
          render,
        },
      },
    } satisfies {
      loading: boolean;
      manualOverlay: GridOverlayKind | null;
      overlays: GridOverlaysOptions;
    };
    const root = document.createElement("div");
    document.body.appendChild(root);
    const controller = new OverlayController({
      gridRoot: root,
      getOverlayState: () => state,
      getDisplayRowCount: () => 1,
      getGridInstance: () => null,
      onPresentationChanged,
    });

    controller.sync();
    controller.sync();
    expect(render).toHaveBeenCalledTimes(1);
    expect(onPresentationChanged).toHaveBeenCalledTimes(1);
    expect(onPresentationChanged).toHaveBeenCalledWith({
      kind: "loading",
      text: "Loading employee records",
    });
  });

  it("publishes nothing after render failure and isolates observer failure", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onPresentationChanged = vi.fn();
    const failing = new OverlayController({
      gridRoot: root,
      getOverlayState: () => ({
        loading: true,
        manualOverlay: null,
        overlays: {
          loading: {
            render: () => {
              throw new Error("render failed");
            },
          },
        },
      }),
      getDisplayRowCount: () => 1,
      getGridInstance: () => null,
      onPresentationChanged,
    });
    expect(() => failing.sync()).toThrow("render failed");
    expect(onPresentationChanged).not.toHaveBeenCalled();

    const isolatedRoot = document.createElement("div");
    document.body.appendChild(isolatedRoot);
    const isolated = new OverlayController({
      gridRoot: isolatedRoot,
      getOverlayState: () => ({
        loading: true,
        manualOverlay: null,
      }),
      getDisplayRowCount: () => 1,
      getGridInstance: () => null,
      onPresentationChanged: () => {
        throw new Error("observer failed");
      },
    });
    expect(() => isolated.sync()).not.toThrow();
    expect(
      isolatedRoot.querySelector(".lfg-overlay")?.textContent,
    ).toBe("Loading...");
  });
});
