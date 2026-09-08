// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ColumnDef,
  ColumnMenuOptions,
  NormalizedColumnFilterConfig,
} from "../../../types";
import { FloatingController } from "../../floating/FloatingController";
import { FloatingPositioner } from "../../floating/FloatingPositioner";
import type { FloatingOptions } from "../../floating/types";
import { disconnectPopupTrigger, initializePopupTrigger } from "../../menu/popupSemantics";
import { DedicatedFilterController } from "../DedicatedFilterController";
import { FILTER_PANEL_CLASS, FILTER_TRIGGER_CLASS } from "../dedicatedFilterDom";

const TEXT_FILTER: NormalizedColumnFilterConfig = {
  type: "text",
  defaultOperator: "contains",
  caseSensitive: false,
  trimInput: true,
};

interface Fixture {
  readonly controller: DedicatedFilterController;
  readonly gridRoot: HTMLDivElement;
  readonly viewport: HTMLDivElement;
  readonly first: HTMLButtonElement;
  readonly second: HTMLButtonElement;
}

function makeTrigger(field: string): HTMLButtonElement {
  const trigger = document.createElement("button");
  trigger.className = FILTER_TRIGGER_CLASS;
  trigger.setAttribute("data-col-id", field);
  initializePopupTrigger(trigger, "dialog");
  return trigger;
}

function makeFixture(): Fixture {
  const gridRoot = document.createElement("div");
  const viewport = document.createElement("div");
  gridRoot.appendChild(viewport);
  document.body.appendChild(gridRoot);
  const columns: ColumnDef[] = [
    { field: "first", headerName: "First", filterable: true },
    { field: "second", headerName: "Second", filterable: true },
  ];
  const controller = new DedicatedFilterController({
    gridRoot,
    viewport,
    getColumns: () => columns,
    getColumnFilterModel: () => null,
    setColumnFilterModel: () => {},
    clearColumnFilter: () => {},
    getFilterConfig: () => TEXT_FILTER,
    getColumnMenuOptions: () =>
      ({
        filter: { placement: "dedicatedMenu" },
      }) satisfies ColumnMenuOptions,
  });
  controller.attach(gridRoot);
  const first = makeTrigger("first");
  const second = makeTrigger("second");
  gridRoot.append(first, second);
  return { controller, gridRoot, viewport, first, second };
}

function click(trigger: HTMLElement): void {
  trigger.dispatchEvent(
    new MouseEvent("click", { bubbles: true, button: 0 }),
  );
}

function invokeControllerClick(
  controller: DedicatedFilterController,
  trigger: HTMLElement,
): void {
  const event = new MouseEvent("click", { bubbles: true, button: 0 });
  Object.defineProperty(event, "target", { value: trigger });
  Reflect.apply(Reflect.get(controller, "onClick"), controller, [event]);
}

function activePanel(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`.${FILTER_PANEL_CLASS}`);
}

describe("Accessibility V2 F16D dedicated-filter popup semantics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("129 connects a closed floating-filter trigger to one canonical dialog", () => {
    const fixture = makeFixture();
    expect(fixture.first.getAttribute("aria-haspopup")).toBe("dialog");
    expect(fixture.first.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.first.hasAttribute("aria-controls")).toBe(false);

    click(fixture.first);
    const panel = activePanel(fixture.gridRoot);
    expect(panel).not.toBeNull();
    expect(panel!.id).toMatch(/^lfg-popup-dedicated-filter-[1-9]\d*$/);
    expect(panel!.getAttribute("role")).toBe("dialog");
    expect(panel!.getAttribute("aria-modal")).toBe("false");
    expect(panel!.getAttribute("aria-label")).toBe("Filter First");
    expect(fixture.first.getAttribute("aria-expanded")).toBe("true");
    expect(fixture.first.getAttribute("aria-controls")).toBe(panel!.id);

    click(fixture.first);
    expect(activePanel(fixture.gridRoot)).toBeNull();
    expect(fixture.first.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.first.hasAttribute("aria-controls")).toBe(false);

    fixture.controller.detach();
  });

  it("130 clears only the relation owned by replacement, dismissal, failure, and detach", () => {
    const fixture = makeFixture();
    const openOptions: FloatingOptions[] = [];
    const productionOpen = FloatingController.prototype.open;
    vi.spyOn(FloatingController.prototype, "open").mockImplementation(
      function (this: FloatingController, options): void {
        openOptions.push(options);
        productionOpen.call(this, options);
      },
    );

    click(fixture.first);
    const firstPanelId = activePanel(fixture.gridRoot)!.id;
    click(fixture.second);
    const secondPanelId = activePanel(fixture.gridRoot)!.id;
    expect(secondPanelId).not.toBe(firstPanelId);
    expect(fixture.first.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.first.hasAttribute("aria-controls")).toBe(false);
    expect(fixture.second.getAttribute("aria-controls")).toBe(secondPanelId);

    openOptions[0]!.onClose?.();
    expect(fixture.second.getAttribute("aria-expanded")).toBe("true");
    expect(fixture.second.getAttribute("aria-controls")).toBe(secondPanelId);
    expect(activePanel(fixture.gridRoot)?.id).toBe(secondPanelId);

    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(fixture.second.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.second.hasAttribute("aria-controls")).toBe(false);

    click(fixture.second);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(fixture.second.getAttribute("aria-expanded")).toBe("false");

    click(fixture.second);
    fixture.viewport.dispatchEvent(new Event("scroll"));
    expect(fixture.second.getAttribute("aria-expanded")).toBe("false");

    const positionError = new Error("position failed");
    vi.spyOn(FloatingPositioner.prototype, "position").mockImplementationOnce(
      () => {
        throw positionError;
      },
    );
    expect(() =>
      invokeControllerClick(fixture.controller, fixture.first),
    ).toThrow(positionError);
    expect(activePanel(fixture.gridRoot)).toBeNull();
    expect(fixture.first.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.first.hasAttribute("aria-controls")).toBe(false);

    const relationError = new Error("relation failed");
    const nativeSetAttribute = Element.prototype.setAttribute;
    const setAttribute = vi
      .spyOn(fixture.first, "setAttribute")
      .mockImplementation(function (
        this: HTMLButtonElement,
        name,
        value,
      ): void {
        if (name === "aria-controls") throw relationError;
        nativeSetAttribute.call(this, name, value);
      });
    expect(() =>
      invokeControllerClick(fixture.controller, fixture.first),
    ).toThrow(relationError);
    expect(activePanel(fixture.gridRoot)).toBeNull();
    expect(fixture.first.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.first.hasAttribute("aria-controls")).toBe(false);
    setAttribute.mockRestore();

    click(fixture.first);
    const closeError = new Error("relation cleanup failed");
    const removeAttribute = vi
      .spyOn(fixture.first, "removeAttribute")
      .mockImplementationOnce(() => {
        throw closeError;
      });
    expect(() =>
      invokeControllerClick(fixture.controller, fixture.first),
    ).toThrow(closeError);
    expect(activePanel(fixture.gridRoot)).toBeNull();
    removeAttribute.mockRestore();
    click(fixture.first);
    expect(activePanel(fixture.gridRoot)).not.toBeNull();
    click(fixture.first);

    click(fixture.second);
    const detachedId = fixture.second.getAttribute("aria-controls")!;
    fixture.second.remove();
    fixture.controller.detach();
    expect(disconnectPopupTrigger(fixture.second, detachedId)).toBe(false);
    expect(fixture.second.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.second.hasAttribute("aria-controls")).toBe(false);
  });
});
