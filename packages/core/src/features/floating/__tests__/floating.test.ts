// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FloatingController } from "../../../features/floating/FloatingController";
import { FloatingLayer } from "../../../features/floating/FloatingLayer";
import { FloatingPositioner } from "../../../features/floating/FloatingPositioner";
import type { FloatingOptions } from "../../../features/floating/types";

function createGridRoot(): HTMLDivElement {
  const root = document.createElement("div");
  Object.defineProperty(root, "getBoundingClientRect", {
    value: () => ({
      top: 100,
      left: 50,
      bottom: 700,
      right: 850,
      width: 800,
      height: 600,
      x: 50,
      y: 100,
    }),
  });
  document.body.appendChild(root);
  return root;
}

function createAnchor(
  rect: Partial<DOMRect> = {},
): HTMLDivElement {
  const el = document.createElement("div");
  const defaults = {
    top: 200,
    left: 100,
    bottom: 240,
    right: 300,
    width: 200,
    height: 40,
    x: 100,
    y: 200,
  };
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({ ...defaults, ...rect }),
  });
  return el;
}

// ─── FloatingLayer ───

describe("FloatingLayer", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = createGridRoot();
  });

  afterEach(() => {
    root.remove();
  });

  it("creates layer and host lazily on getHost()", () => {
    const layer = new FloatingLayer(root);
    expect(root.querySelector(".lfg-floating-layer")).toBeNull();

    const host = layer.getHost();
    expect(host).toBeInstanceOf(HTMLDivElement);
    expect(host.className).toBe("lfg-floating");
    expect(root.querySelector(".lfg-floating-layer")).toBeTruthy();
    layer.destroy();
  });

  it("reuses the same host on repeated getHost() calls", () => {
    const layer = new FloatingLayer(root);
    const h1 = layer.getHost();
    const h2 = layer.getHost();
    expect(h1).toBe(h2);
    layer.destroy();
  });

  it("show() makes layer and host visible", () => {
    const layer = new FloatingLayer(root);
    layer.show();
    const layerEl = root.querySelector(".lfg-floating-layer") as HTMLDivElement;
    const hostEl = root.querySelector(".lfg-floating") as HTMLDivElement;
    expect(layerEl.style.display).toBe("");
    expect(hostEl.style.display).toBe("");
    layer.destroy();
  });

  it("hide() hides layer and host", () => {
    const layer = new FloatingLayer(root);
    layer.show();
    layer.hide();
    const layerEl = root.querySelector(".lfg-floating-layer") as HTMLDivElement;
    const hostEl = root.querySelector(".lfg-floating") as HTMLDivElement;
    expect(layerEl.style.display).toBe("none");
    expect(hostEl.style.display).toBe("none");
    layer.destroy();
  });

  it("clear() empties host content", () => {
    const layer = new FloatingLayer(root);
    const host = layer.getHost();
    host.textContent = "hello";
    layer.clear();
    expect(host.textContent).toBe("");
    layer.destroy();
  });

  it("destroy() removes layer from DOM", () => {
    const layer = new FloatingLayer(root);
    layer.getHost();
    expect(root.querySelector(".lfg-floating-layer")).toBeTruthy();
    layer.destroy();
    expect(root.querySelector(".lfg-floating-layer")).toBeNull();
  });
});

// ─── FloatingPositioner ───

describe("FloatingPositioner", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = createGridRoot();
  });

  afterEach(() => {
    root.remove();
  });

  function makeHost(w = 120, h = 80): HTMLDivElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({
        top: 0, left: 0, bottom: h, right: w,
        width: w, height: h, x: 0, y: 0,
      }),
    });
    return el;
  }

  it("positions bottom-start below anchor, left-aligned", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    expect(result.x).toBe(50);
    expect(result.y).toBe(140);
    expect(result.placement).toBe("bottom-start");
    expect(host.style.transform).toBe("translate3d(50px, 140px, 0)");
  });

  it("positions bottom-end below anchor, right-aligned", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-end",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    expect(result.x).toBe(130);
    expect(result.y).toBe(140);
    expect(result.placement).toBe("bottom-end");
  });

  it("positions top-start above anchor", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "top-start",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    expect(result.x).toBe(50);
    expect(result.y).toBe(20);
    expect(result.placement).toBe("top-start");
  });

  it("positions top-end above anchor, right-aligned", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "top-end",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    expect(result.x).toBe(130);
    expect(result.y).toBe(20);
    expect(result.placement).toBe("top-end");
  });

  it("positions bottom-center below anchor, horizontally centered", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-center",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    // x = anchor.left(100) - root.left(50) + (anchor.width(200) - host.width(120)) / 2 = 90
    expect(result.x).toBe(90);
    expect(result.y).toBe(140);
    expect(result.placement).toBe("bottom-center");
  });

  it("positions top-center above anchor, horizontally centered", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "top-center",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    expect(result.x).toBe(90);
    expect(result.y).toBe(20);
    expect(result.placement).toBe("top-center");
  });

  it("positions right-start to the right of anchor, top-aligned", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "right-start",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    // x = anchor.right(300) - root.left(50) = 250
    // y = anchor.top(200) - root.top(100) = 100
    expect(result.x).toBe(250);
    expect(result.y).toBe(100);
    expect(result.placement).toBe("right-start");
  });

  it("positions right-center to the right of anchor, vertically centered", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "right-center",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    // y = anchor.top(200) - root.top(100) + (anchor.height(40) - host.height(80)) / 2 = 80
    expect(result.x).toBe(250);
    expect(result.y).toBe(80);
    expect(result.placement).toBe("right-center");
  });

  it("positions right-end to the right of anchor, bottom-aligned", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "right-end",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    // y = anchor.bottom(240) - root.top(100) - host.height(80) = 60
    expect(result.x).toBe(250);
    expect(result.y).toBe(60);
    expect(result.placement).toBe("right-end");
  });

  it("positions left-start to the left of anchor, top-aligned", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "left-start",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    // x = anchor.left(100) - root.left(50) - host.width(120) = -70
    // y = anchor.top(200) - root.top(100) = 100
    expect(result.x).toBe(-70);
    expect(result.y).toBe(100);
    expect(result.placement).toBe("left-start");
  });

  it("positions left-center to the left of anchor, vertically centered", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "left-center",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    expect(result.x).toBe(-70);
    expect(result.y).toBe(80);
    expect(result.placement).toBe("left-center");
  });

  it("applies side offset for left-center", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "left-center",
      matchAnchorWidth: false,
      clampToViewport: false,
      offset: 8,
    });

    // base x (-70) minus offset 8
    expect(result.x).toBe(-78);
    expect(result.y).toBe(80);
  });

  it("positions left-end to the left of anchor, bottom-aligned", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "left-end",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    expect(result.x).toBe(-70);
    expect(result.y).toBe(60);
    expect(result.placement).toBe("left-end");
  });

  it("flips right-start to left-start when no space on right", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 200, bottom: 240, left: 700, right: 800, width: 100, height: 40,
    });
    const host = makeHost(120, 80);

    Object.defineProperty(window, "innerWidth", { value: 850, writable: true });

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "right-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    // 800 + 120 = 920 > 850, and 700 - 120 = 580 >= 0, so flip
    expect(result.placement).toBe("left-start");
  });

  it("flips left-center to right-center when no space on left", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 200, bottom: 240, left: 60, right: 160, width: 100, height: 40,
    });
    const host = makeHost(120, 80);

    Object.defineProperty(window, "innerWidth", { value: 850, writable: true });

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "left-center",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    // 60 - 120 = -60 < 0, and 160 + 120 = 280 <= 850, so flip
    expect(result.placement).toBe("right-center");
  });

  it("positions cell placement overlaying the anchor", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "cell",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    expect(result.x).toBe(50);
    expect(result.y).toBe(100);
    expect(result.placement).toBe("cell");
  });

  it("cell placement with matchAnchorWidth sets width and height", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "cell",
      matchAnchorWidth: true,
      clampToViewport: false,
    });

    expect(host.style.width).toBe("200px");
    expect(host.style.height).toBe("40px");
  });

  it("matchAnchorWidth sets host width for non-cell placements", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor();
    const host = makeHost();

    positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: true,
      clampToViewport: false,
    });

    expect(host.style.width).toBe("200px");
  });

  it("flips bottom-start to top-start when no space below", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 680,
      bottom: 720,
      left: 100,
      right: 300,
      width: 200,
      height: 40,
    });
    const host = makeHost(120, 80);

    Object.defineProperty(window, "innerHeight", { value: 750, writable: true });

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    expect(result.placement).toBe("top-start");
  });

  it("flips bottom-end to top-end when no space below", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 680,
      bottom: 720,
      left: 100,
      right: 300,
      width: 200,
      height: 40,
    });
    const host = makeHost(120, 80);

    Object.defineProperty(window, "innerHeight", { value: 750, writable: true });

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-end",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    expect(result.placement).toBe("top-end");
  });

  it("flips top-end to bottom-end when no space above", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 30,
      bottom: 70,
      left: 100,
      right: 300,
      width: 200,
      height: 40,
    });
    const host = makeHost(120, 80);

    Object.defineProperty(window, "innerHeight", { value: 750, writable: true });

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "top-end",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    expect(result.placement).toBe("bottom-end");
  });

  it("flips top-start to bottom-start when no space above", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 30,
      bottom: 70,
      left: 100,
      right: 300,
      width: 200,
      height: 40,
    });
    const host = makeHost(120, 80);

    Object.defineProperty(window, "innerHeight", { value: 750, writable: true });

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "top-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    expect(result.placement).toBe("bottom-start");
  });

  it("flips bottom-start to top-start when grid root is constrained even if viewport has space", () => {
    // Grid root bottom = 700, anchor bottom = 650 → 650 + 80 = 730 > 700 → flip
    // Viewport (window.innerHeight) is large enough, but grid root is not
    const smallRoot = document.createElement("div");
    Object.defineProperty(smallRoot, "getBoundingClientRect", {
      value: () => ({
        top: 100, left: 50, bottom: 700, right: 850,
        width: 800, height: 600, x: 50, y: 100,
      }),
    });
    document.body.appendChild(smallRoot);
    Object.defineProperty(window, "innerHeight", { value: 2000, writable: true });

    const positioner = new FloatingPositioner(smallRoot);
    const anchor = createAnchor({
      top: 650, bottom: 690, left: 100, right: 300, width: 200, height: 40,
    });
    const host = makeHost(120, 80);

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    // 690 + 80 = 770 > root.bottom(700), and 650 - 80 = 570 >= root.top(100) → flip
    expect(result.placement).toBe("top-start");

    smallRoot.remove();
  });

  it("clamps floating host inside grid root even when viewport is larger", () => {
    Object.defineProperty(window, "innerWidth", { value: 2000, writable: true });

    const positioner = new FloatingPositioner(root);
    // Anchor far right, so host would overflow grid root
    const anchor = createAnchor({
      top: 200, bottom: 240, left: 800, right: 900, width: 100, height: 40,
    });
    const host = makeHost(200, 40);

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    // maxX = root.width(800) - host.width(200) = 600
    expect(result.x).toBe(600);
  });

  it("clamps x to grid root bounds", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 200,
      bottom: 240,
      left: 800,
      right: 900,
      width: 100,
      height: 40,
    });
    const host = makeHost(200, 40);

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    expect(result.x).toBe(600);
  });

  it("clamps y to grid root bounds", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 680,
      bottom: 720,
      left: 100,
      right: 300,
      width: 200,
      height: 40,
    });
    // Host taller than remaining space, no room to flip either
    const host = makeHost(120, 800);

    Object.defineProperty(window, "innerHeight", { value: 100, writable: true });

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    // maxY = root.height(600) - host.height(800) = -200, clamped to 0
    expect(result.y).toBe(0);
  });

  it("clamps to visible boundary when grid extends beyond viewport", () => {
    Object.defineProperty(window, "innerWidth", { value: 400, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 500, writable: true });

    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 200, bottom: 240, left: 300, right: 400, width: 100, height: 40,
    });
    const host = makeHost(200, 40);

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    // Visible boundary: intersect root(50,100,850,700) with viewport(0,0,400,500)
    // = (50,100,400,500). maxX = 400 - 50 - 200 = 150
    expect(result.x).toBe(150);
  });

  it("rounds x and y to integers", () => {
    const positioner = new FloatingPositioner(root);
    const anchor = createAnchor({
      top: 200.7,
      bottom: 240.7,
      left: 100.3,
      right: 300.3,
      width: 200,
      height: 40,
    });
    const host = makeHost();

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: false,
      clampToViewport: false,
    });

    expect(result.x).toBe(Math.round(100.3 - 50));
    expect(result.y).toBe(Math.round(240.7 - 100));
    expect(Number.isInteger(result.x)).toBe(true);
    expect(Number.isInteger(result.y)).toBe(true);
  });
});

// ─── FloatingController ───

describe("FloatingController", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = createGridRoot();
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  function makeOptions(overrides: Partial<FloatingOptions> = {}): FloatingOptions {
    return {
      anchorEl: createAnchor(),
      render: vi.fn((host: HTMLElement) => {
        const content = document.createElement("div");
        content.className = "test-content";
        content.textContent = "popup";
        host.appendChild(content);
      }),
      ...overrides,
    };
  }

  // ─── open / close / lifecycle ───

  it("open() renders content into floating host", () => {
    const ctrl = new FloatingController(root);
    const render = vi.fn();
    ctrl.open(makeOptions({ render }));

    expect(render).toHaveBeenCalledOnce();
    const host = root.querySelector(".lfg-floating") as HTMLElement;
    expect(host).toBeTruthy();
    expect(host.style.display).toBe("");

    ctrl.destroy();
  });

  it("open() with arrow sets placement and arrow host attributes", () => {
    const ctrl = new FloatingController(root);
    ctrl.open(
      makeOptions({
        placement: "left-center",
        arrow: true,
        clampToViewport: false,
      }),
    );

    const host = root.querySelector(".lfg-floating") as HTMLElement;
    expect(host.getAttribute("data-lfg-placement")).toBe("left-center");
    expect(host.hasAttribute("data-lfg-arrow")).toBe(true);
    expect(host.querySelector(":scope > .lfg-floating-arrow")).toBeTruthy();

    ctrl.close();
    expect(host.hasAttribute("data-lfg-placement")).toBe(false);
    expect(host.hasAttribute("data-lfg-arrow")).toBe(false);
    expect(host.querySelector(":scope > .lfg-floating-arrow")).toBeNull();

    ctrl.destroy();
  });

  it("open() without arrow does not set data-lfg-arrow", () => {
    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions({ placement: "bottom-end", clampToViewport: false }));

    const host = root.querySelector(".lfg-floating") as HTMLElement;
    expect(host.getAttribute("data-lfg-placement")).toBe("bottom-end");
    expect(host.hasAttribute("data-lfg-arrow")).toBe(false);

    ctrl.destroy();
  });

  it("close() clears content and hides host", () => {
    const ctrl = new FloatingController(root);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ onClose }));

    ctrl.close();

    const host = root.querySelector(".lfg-floating") as HTMLElement;
    expect(host.textContent).toBe("");
    expect(host.style.display).toBe("none");
    expect(onClose).toHaveBeenCalledOnce();

    ctrl.destroy();
  });

  it("opening a new floating closes the previous one", () => {
    const ctrl = new FloatingController(root);
    const onClose1 = vi.fn();
    ctrl.open(makeOptions({ onClose: onClose1 }));

    ctrl.open(makeOptions());

    expect(onClose1).toHaveBeenCalledOnce();

    ctrl.destroy();
  });

  it("only one floating host element exists", () => {
    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());
    ctrl.close();
    ctrl.open(makeOptions());

    const hosts = root.querySelectorAll(".lfg-floating");
    expect(hosts).toHaveLength(1);

    ctrl.destroy();
  });

  it("isOpen() reflects state", () => {
    const ctrl = new FloatingController(root);
    expect(ctrl.isOpen()).toBe(false);

    ctrl.open(makeOptions());
    expect(ctrl.isOpen()).toBe(true);

    ctrl.close();
    expect(ctrl.isOpen()).toBe(false);

    ctrl.destroy();
  });

  it("close() is safe to call when not open", () => {
    const ctrl = new FloatingController(root);
    expect(() => ctrl.close()).not.toThrow();
    ctrl.destroy();
  });

  it("destroy() is safe after close()", () => {
    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());
    ctrl.close();
    expect(() => ctrl.destroy()).not.toThrow();
  });

  it("destroy() removes layer from DOM", () => {
    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());
    ctrl.destroy();

    expect(root.querySelector(".lfg-floating-layer")).toBeNull();
  });

  it("reposition() updates transform", () => {
    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());

    const host = root.querySelector(".lfg-floating") as HTMLElement;
    const transformBefore = host.style.transform;
    expect(transformBefore).toContain("translate3d");

    ctrl.reposition();
    expect(host.style.transform).toContain("translate3d");

    ctrl.destroy();
  });

  // ─── outside pointerdown ───

  it("first outside pointerdown after open closes immediately", () => {
    const ctrl = new FloatingController(root);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ onClose }));

    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();

    ctrl.destroy();
  });

  it("pointerdown inside host does not close", () => {
    const ctrl = new FloatingController(root);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ onClose }));

    const host = root.querySelector(".lfg-floating")!;
    host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  it("pointerdown on anchorEl does not close", () => {
    const ctrl = new FloatingController(root);
    const onClose = vi.fn();
    const anchor = createAnchor();
    ctrl.open(makeOptions({ onClose, anchorEl: anchor }));

    anchor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  it("does not close on outside click when closeOnOutsideClick is false", () => {
    const ctrl = new FloatingController(root);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ onClose, closeOnOutsideClick: false }));

    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  // ─── Escape ───

  it("close on Escape", () => {
    const ctrl = new FloatingController(root);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ onClose }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onClose).toHaveBeenCalledOnce();

    ctrl.destroy();
  });

  it("does not close on Escape when closeOnEscape is false", () => {
    const ctrl = new FloatingController(root);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ onClose, closeOnEscape: false }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onClose).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  // ─── scroll container ───

  it("close on scroll when scroll container is provided", () => {
    const scrollEl = document.createElement("div");
    const ctrl = new FloatingController(root, scrollEl);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ onClose }));

    scrollEl.dispatchEvent(new Event("scroll"));
    expect(onClose).toHaveBeenCalledOnce();

    ctrl.destroy();
  });

  it("rAF reposition on scroll when closeOnScroll is false", () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 800, right: 900, width: 900, height: 800, x: 0, y: 0 }),
    });
    document.body.appendChild(scrollEl);
    const anchor = createAnchor();
    document.body.appendChild(anchor);

    const ctrl = new FloatingController(root, scrollEl);
    const repositionSpy = vi.spyOn(ctrl, "reposition");
    ctrl.open(makeOptions({ closeOnScroll: false, anchorEl: anchor }));
    repositionSpy.mockClear();
    rafCalls.length = 0;

    scrollEl.dispatchEvent(new Event("scroll"));
    expect(repositionSpy).not.toHaveBeenCalled();
    expect(rafCalls).toHaveLength(1);

    rafCalls[0]!(0);
    expect(repositionSpy).toHaveBeenCalledOnce();

    ctrl.destroy();
    anchor.remove();
    scrollEl.remove();
  });

  it("no throw when no scroll container is provided", () => {
    const ctrl = new FloatingController(root);
    expect(() => {
      ctrl.open(makeOptions());
      ctrl.close();
    }).not.toThrow();

    ctrl.destroy();
  });

  // ─── resize ───

  it("resize schedules rAF reposition, not synchronous reposition", () => {
    const anchor = createAnchor();
    document.body.appendChild(anchor);

    const ctrl = new FloatingController(root);
    const repositionSpy = vi.spyOn(ctrl, "reposition");
    ctrl.open(makeOptions({ anchorEl: anchor }));
    repositionSpy.mockClear();

    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    window.dispatchEvent(new Event("resize"));

    expect(repositionSpy).not.toHaveBeenCalled();
    expect(rafCalls).toHaveLength(1);

    rafCalls[0]!(0);
    expect(repositionSpy).toHaveBeenCalledOnce();

    ctrl.destroy();
    anchor.remove();
  });

  it("resize listener not active when closed", () => {
    const ctrl = new FloatingController(root);
    const repositionSpy = vi.spyOn(ctrl, "reposition");
    ctrl.open(makeOptions());
    ctrl.close();
    repositionSpy.mockClear();

    window.dispatchEvent(new Event("resize"));
    expect(repositionSpy).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  // ─── listener cleanup ───

  it("document listeners removed on close (identity check)", () => {
    const docAddSpy = vi.spyOn(document, "addEventListener");
    const docRemoveSpy = vi.spyOn(document, "removeEventListener");

    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());

    const addedFns = docAddSpy.mock.calls
      .filter((c) => c[0] === "pointerdown" || c[0] === "keydown")
      .map((c) => ({ event: c[0], fn: c[1] }));

    ctrl.close();

    const removedFns = docRemoveSpy.mock.calls
      .filter((c) => c[0] === "pointerdown" || c[0] === "keydown")
      .map((c) => ({ event: c[0], fn: c[1] }));

    for (const added of addedFns) {
      expect(removedFns.find((r) => r.event === added.event && r.fn === added.fn)).toBeTruthy();
    }

    ctrl.destroy();
  });

  it("window resize listener removed on close (identity check)", () => {
    const winAddSpy = vi.spyOn(window, "addEventListener");
    const winRemoveSpy = vi.spyOn(window, "removeEventListener");

    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());

    const addedResize = winAddSpy.mock.calls.find((c) => c[0] === "resize");
    expect(addedResize).toBeTruthy();

    ctrl.close();

    const removedResize = winRemoveSpy.mock.calls.find(
      (c) => c[0] === "resize" && c[1] === addedResize![1],
    );
    expect(removedResize).toBeTruthy();

    ctrl.destroy();
  });

  it("scroll listener removed on close (identity check)", () => {
    const scrollEl = document.createElement("div");
    const scrollAddSpy = vi.spyOn(scrollEl, "addEventListener");
    const scrollRemoveSpy = vi.spyOn(scrollEl, "removeEventListener");

    const ctrl = new FloatingController(root, scrollEl);
    ctrl.open(makeOptions());

    const addedScroll = scrollAddSpy.mock.calls.find((c) => c[0] === "scroll");
    expect(addedScroll).toBeTruthy();

    ctrl.close();

    const removedScroll = scrollRemoveSpy.mock.calls.find(
      (c) => c[0] === "scroll" && c[1] === addedScroll![1],
    );
    expect(removedScroll).toBeTruthy();

    ctrl.destroy();
  });

  it("destroy removes all listeners even when open", () => {
    const docRemoveSpy = vi.spyOn(document, "removeEventListener");
    const winRemoveSpy = vi.spyOn(window, "removeEventListener");

    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());
    ctrl.destroy();

    expect(docRemoveSpy.mock.calls.some((c) => c[0] === "pointerdown")).toBe(true);
    expect(docRemoveSpy.mock.calls.some((c) => c[0] === "keydown")).toBe(true);
    expect(winRemoveSpy.mock.calls.some((c) => c[0] === "resize")).toBe(true);
  });

  it("repeated open/close cycles do not accumulate listeners", () => {
    const docAddSpy = vi.spyOn(document, "addEventListener");
    const docRemoveSpy = vi.spyOn(document, "removeEventListener");

    const ctrl = new FloatingController(root);

    for (let i = 0; i < 5; i++) {
      ctrl.open(makeOptions());
      ctrl.close();
    }

    const addedPD = docAddSpy.mock.calls.filter((c) => c[0] === "pointerdown");
    const removedPD = docRemoveSpy.mock.calls.filter((c) => c[0] === "pointerdown");
    expect(removedPD.length).toBe(addedPD.length);

    const addedKD = docAddSpy.mock.calls.filter((c) => c[0] === "keydown");
    const removedKD = docRemoveSpy.mock.calls.filter((c) => c[0] === "keydown");
    expect(removedKD.length).toBe(addedKD.length);

    // After all cycles, further events should not throw
    expect(() => {
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      window.dispatchEvent(new Event("resize"));
    }).not.toThrow();

    ctrl.destroy();
  });

  // ─── render cleanup ───

  it("render cleanup called on close", () => {
    const cleanup = vi.fn();
    const render = vi.fn(() => cleanup);
    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions({ render }));

    expect(cleanup).not.toHaveBeenCalled();
    ctrl.close();
    expect(cleanup).toHaveBeenCalledOnce();

    ctrl.destroy();
  });

  it("render cleanup called on destroy", () => {
    const cleanup = vi.fn();
    const render = vi.fn(() => cleanup);
    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions({ render }));

    ctrl.destroy();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cleanup from previous floating called before opening a new one", () => {
    const cleanup1 = vi.fn();
    const render1 = vi.fn(() => cleanup1);
    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions({ render: render1 }));

    const cleanup2 = vi.fn();
    const render2 = vi.fn(() => cleanup2);
    ctrl.open(makeOptions({ render: render2 }));

    expect(cleanup1).toHaveBeenCalledOnce();
    expect(cleanup2).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  it("cleanup not called twice on close then destroy", () => {
    const cleanup = vi.fn();
    const render = vi.fn(() => cleanup);
    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions({ render }));

    ctrl.close();
    ctrl.destroy();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("render returning void still works", () => {
    const render = vi.fn(() => {});
    const ctrl = new FloatingController(root);

    expect(() => {
      ctrl.open(makeOptions({ render }));
      ctrl.close();
      ctrl.destroy();
    }).not.toThrow();
  });

  it("fails closed when rendering throws and permits a later open", () => {
    const error = new Error("render failed");
    const ctrl = new FloatingController(root);

    expect(() =>
      ctrl.open(
        makeOptions({
          render: (host) => {
            host.appendChild(document.createElement("button"));
            throw error;
          },
        }),
      ),
    ).toThrow(error);

    const host = root.querySelector(".lfg-floating") as HTMLElement;
    expect(ctrl.isOpen()).toBe(false);
    expect(host.textContent).toBe("");
    expect(host.style.display).toBe("none");

    ctrl.open(makeOptions());
    expect(ctrl.isOpen()).toBe(true);
    ctrl.destroy();
  });

  it("runs render cleanup and fails closed when positioning throws", () => {
    const error = new Error("position failed");
    const cleanup = vi.fn();
    const anchor = document.createElement("div");
    Object.defineProperty(anchor, "getBoundingClientRect", {
      value: () => {
        throw error;
      },
    });
    const ctrl = new FloatingController(root);

    expect(() =>
      ctrl.open(makeOptions({ anchorEl: anchor, render: () => cleanup })),
    ).toThrow(error);

    const host = root.querySelector(".lfg-floating") as HTMLElement;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(ctrl.isOpen()).toBe(false);
    expect(host.textContent).toBe("");
    expect(host.style.display).toBe("none");
    ctrl.destroy();
  });

  it("closes and notifies the owner when render cleanup throws", () => {
    const error = new Error("cleanup failed");
    const onClose = vi.fn();
    const ctrl = new FloatingController(root);
    ctrl.open(
      makeOptions({
        render: () => () => {
          throw error;
        },
        onClose,
      }),
    );

    expect(() => ctrl.close()).toThrow(error);

    const host = root.querySelector(".lfg-floating") as HTMLElement;
    expect(ctrl.isOpen()).toBe(false);
    expect(host.textContent).toBe("");
    expect(host.style.display).toBe("none");
    expect(onClose).toHaveBeenCalledOnce();
    expect(() => ctrl.destroy()).not.toThrow();
  });

  it("removes the floating layer when cleanup throws during destroy", () => {
    const error = new Error("cleanup failed");
    const ctrl = new FloatingController(root);
    ctrl.open(
      makeOptions({
        render: () => () => {
          throw error;
        },
      }),
    );

    expect(() => ctrl.destroy()).toThrow(error);
    expect(ctrl.isOpen()).toBe(false);
    expect(root.querySelector(".lfg-floating-layer")).toBeNull();
  });

  // ─── anchor visibility ───

  function createMutableAnchor(initial: Partial<DOMRect> = {}): {
    el: HTMLDivElement;
    setRect: (r: Partial<DOMRect>) => void;
  } {
    const defaults = {
      top: 200, left: 100, bottom: 240, right: 300,
      width: 200, height: 40, x: 100, y: 200,
    };
    let current = { ...defaults, ...initial };
    const el = document.createElement("div");
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ ...current }),
    });
    return {
      el,
      setRect: (r) => { current = { ...current, ...r }; },
    };
  }

  it("closeOnScroll:false repositions when anchor intersects boundary", () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 800, right: 900, width: 900, height: 800, x: 0, y: 0 }),
    });
    document.body.appendChild(scrollEl);

    const ctrl = new FloatingController(root, scrollEl);
    const onClose = vi.fn();
    const anchor = createAnchor();
    document.body.appendChild(anchor);
    ctrl.open(makeOptions({ closeOnScroll: false, onClose, anchorEl: anchor }));
    rafCalls.length = 0;

    scrollEl.dispatchEvent(new Event("scroll"));
    expect(rafCalls).toHaveLength(1);
    rafCalls[0]!(0);

    expect(onClose).not.toHaveBeenCalled();
    expect(ctrl.isOpen()).toBe(true);

    ctrl.destroy();
    anchor.remove();
    scrollEl.remove();
  });

  it("closeOnScroll:false closes when anchor is completely outside boundary", () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 100, right: 900, width: 900, height: 100, x: 0, y: 0 }),
    });
    document.body.appendChild(scrollEl);

    const ctrl = new FloatingController(root, scrollEl);
    const onClose = vi.fn();
    // Anchor top=200 is below boundary bottom=100
    const anchor = createAnchor({ top: 200, bottom: 240 });
    document.body.appendChild(anchor);
    ctrl.open(makeOptions({ closeOnScroll: false, onClose, anchorEl: anchor }));
    rafCalls.length = 0;

    scrollEl.dispatchEvent(new Event("scroll"));
    rafCalls[0]!(0);

    expect(onClose).toHaveBeenCalledOnce();
    expect(ctrl.isOpen()).toBe(false);

    ctrl.destroy();
    anchor.remove();
    scrollEl.remove();
  });

  it("anchor-exit close does not auto-reopen when anchor comes back into view", () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 800, right: 900, width: 900, height: 800, x: 0, y: 0 }),
    });
    document.body.appendChild(scrollEl);

    const { el: anchor, setRect } = createMutableAnchor();
    document.body.appendChild(anchor);
    const ctrl = new FloatingController(root, scrollEl);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ closeOnScroll: false, onClose, anchorEl: anchor }));
    rafCalls.length = 0;

    // Move anchor outside boundary
    setRect({ top: 900, bottom: 940 });
    scrollEl.dispatchEvent(new Event("scroll"));
    rafCalls[0]!(0);
    expect(onClose).toHaveBeenCalledOnce();
    expect(ctrl.isOpen()).toBe(false);

    // Move anchor back inside boundary
    setRect({ top: 200, bottom: 240 });
    rafCalls.length = 0;
    scrollEl.dispatchEvent(new Event("scroll"));
    // No rAF scheduled because controller is closed
    expect(rafCalls).toHaveLength(0);
    expect(ctrl.isOpen()).toBe(false);

    ctrl.destroy();
    anchor.remove();
    scrollEl.remove();
  });

  it("resize closes when anchor is outside boundary", () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const ctrl = new FloatingController(root);
    const onClose = vi.fn();
    // Anchor completely below grid root (root bottom=700)
    const anchor = createAnchor({ top: 800, bottom: 840 });
    document.body.appendChild(anchor);
    ctrl.open(makeOptions({ closeOnScroll: false, onClose, anchorEl: anchor }));
    rafCalls.length = 0;

    window.dispatchEvent(new Event("resize"));
    rafCalls[0]!(0);

    expect(onClose).toHaveBeenCalledOnce();
    expect(ctrl.isOpen()).toBe(false);

    ctrl.destroy();
    anchor.remove();
  });

  it("zero-size anchor treated as not visible and closes", () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 800, right: 900, width: 900, height: 800, x: 0, y: 0 }),
    });
    document.body.appendChild(scrollEl);

    const ctrl = new FloatingController(root, scrollEl);
    const onClose = vi.fn();
    const anchor = createAnchor({ width: 0, height: 0 });
    document.body.appendChild(anchor);
    ctrl.open(makeOptions({ closeOnScroll: false, onClose, anchorEl: anchor }));
    rafCalls.length = 0;

    scrollEl.dispatchEvent(new Event("scroll"));
    rafCalls[0]!(0);

    expect(onClose).toHaveBeenCalledOnce();

    ctrl.destroy();
    anchor.remove();
    scrollEl.remove();
  });

  it("disconnected anchor closes on scroll reposition", () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "getBoundingClientRect", {
      value: () => ({ top: 0, left: 0, bottom: 800, right: 900, width: 900, height: 800, x: 0, y: 0 }),
    });
    document.body.appendChild(scrollEl);

    const anchor = createAnchor();
    document.body.appendChild(anchor);
    const ctrl = new FloatingController(root, scrollEl);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ closeOnScroll: false, onClose, anchorEl: anchor }));
    rafCalls.length = 0;

    anchor.remove(); // now disconnected

    scrollEl.dispatchEvent(new Event("scroll"));
    rafCalls[0]!(0);

    expect(onClose).toHaveBeenCalledOnce();

    ctrl.destroy();
    scrollEl.remove();
  });

  it("closeOnScroll:true still closes immediately without visibility checks", () => {
    const scrollEl = document.createElement("div");
    const ctrl = new FloatingController(root, scrollEl);
    const onClose = vi.fn();
    ctrl.open(makeOptions({ closeOnScroll: true, onClose }));

    scrollEl.dispatchEvent(new Event("scroll"));
    expect(onClose).toHaveBeenCalledOnce();

    ctrl.destroy();
  });

  // ─── post-render RAF reposition ───

  it("schedules a post-render RAF that repositions after open", () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const ctrl = new FloatingController(root);
    const repositionSpy = vi.spyOn(ctrl, "reposition");
    ctrl.open(makeOptions());
    repositionSpy.mockClear();

    // One RAF should have been scheduled for post-render reposition
    expect(rafCalls.length).toBeGreaterThanOrEqual(1);
    rafCalls[0]!(0);
    expect(repositionSpy).toHaveBeenCalledOnce();

    ctrl.destroy();
  });

  it("stale post-render RAF does not reposition after close/reopen", () => {
    const rafCalls: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCalls.push(cb);
      return rafCalls.length;
    });

    const ctrl = new FloatingController(root);
    const repositionSpy = vi.spyOn(ctrl, "reposition");
    ctrl.open(makeOptions());
    const firstRaf = rafCalls[0]!;
    repositionSpy.mockClear();

    // Close and reopen — the first RAF is now stale
    ctrl.close();
    ctrl.open(makeOptions());
    repositionSpy.mockClear();

    // Fire the stale RAF from the first open
    firstRaf(0);
    // Should NOT have repositioned (generation mismatch)
    expect(repositionSpy).not.toHaveBeenCalled();

    ctrl.destroy();
  });

  it("close cancels pending post-render RAF", () => {
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());

    ctrl.close();
    expect(cancelSpy).toHaveBeenCalled();

    ctrl.destroy();
  });

  it("destroy cancels pending post-render RAF", () => {
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());

    ctrl.destroy();
    expect(cancelSpy).toHaveBeenCalled();
  });

  // ─── ResizeObserver on host ───

  it("ResizeObserver on host triggers reposition when content grows", () => {
    let roCallback: ResizeObserverCallback | null = null;
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) { roCallback = cb; }
        observe = observeSpy;
        unobserve = vi.fn();
        disconnect = disconnectSpy;
      },
    );

    const ctrl = new FloatingController(root);
    const repositionSpy = vi.spyOn(ctrl, "reposition");
    ctrl.open(makeOptions());
    repositionSpy.mockClear();
    expect(observeSpy).toHaveBeenCalledOnce();

    // Simulate host resize (e.g. React content committed)
    roCallback!([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    expect(repositionSpy).toHaveBeenCalledOnce();

    ctrl.destroy();
    vi.unstubAllGlobals();
  });

  it("ResizeObserver disconnected on close", () => {
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(_cb: ResizeObserverCallback) {}
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = disconnectSpy;
      },
    );

    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());
    expect(disconnectSpy).not.toHaveBeenCalled();

    ctrl.close();
    expect(disconnectSpy).toHaveBeenCalledOnce();

    ctrl.destroy();
    vi.unstubAllGlobals();
  });

  it("ResizeObserver disconnected on destroy", () => {
    const disconnectSpy = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(_cb: ResizeObserverCallback) {}
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = disconnectSpy;
      },
    );

    const ctrl = new FloatingController(root);
    ctrl.open(makeOptions());
    ctrl.destroy();
    expect(disconnectSpy).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});

// ─── FloatingPositioner: viewport-boundary flip ───

describe("FloatingPositioner — viewport-boundary flip", () => {
  it("bottom-start flips to top-start when viewport edge clips even though grid root has more height", () => {
    // Grid root extends from y=0 to y=2000 (plenty of room below)
    const tallRoot = document.createElement("div");
    Object.defineProperty(tallRoot, "getBoundingClientRect", {
      value: () => ({
        top: 0, left: 0, bottom: 2000, right: 800,
        width: 800, height: 2000, x: 0, y: 0,
      }),
    });
    document.body.appendChild(tallRoot);

    // But the browser viewport is only 500px tall
    Object.defineProperty(window, "innerHeight", { value: 500, writable: true });
    Object.defineProperty(window, "innerWidth", { value: 800, writable: true });

    const positioner = new FloatingPositioner(tallRoot);
    // Anchor near the bottom of the viewport
    const anchor = createAnchor({
      top: 440, bottom: 460, left: 100, right: 300, width: 200, height: 20,
    });
    // Host is 80px tall — 460 + 80 = 540 > viewport 500
    const host = makeHost(120, 80);

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "bottom-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    // Should flip: 440 - 80 = 360 >= 0 (viewport top), so top-start works
    expect(result.placement).toBe("top-start");

    tallRoot.remove();
  });

  it("right-start flips to left-start when viewport right edge clips even though grid root is wider", () => {
    const wideRoot = document.createElement("div");
    Object.defineProperty(wideRoot, "getBoundingClientRect", {
      value: () => ({
        top: 0, left: 0, bottom: 600, right: 2000,
        width: 2000, height: 600, x: 0, y: 0,
      }),
    });
    document.body.appendChild(wideRoot);

    Object.defineProperty(window, "innerWidth", { value: 500, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, writable: true });

    const positioner = new FloatingPositioner(wideRoot);
    const anchor = createAnchor({
      top: 200, bottom: 240, left: 380, right: 450, width: 70, height: 40,
    });
    // Host 120px wide — 450 + 120 = 570 > viewport 500
    const host = makeHost(120, 80);

    const result = positioner.position({
      anchorEl: anchor,
      hostEl: host,
      placement: "right-start",
      matchAnchorWidth: false,
      clampToViewport: true,
    });

    // 380 - 120 = 260 >= 0, so left-start works
    expect(result.placement).toBe("left-start");

    wideRoot.remove();
  });

  function makeHost(w = 120, h = 80): HTMLDivElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({
        top: 0, left: 0, bottom: h, right: w,
        width: w, height: h, x: 0, y: 0,
      }),
    });
    return el;
  }
});
