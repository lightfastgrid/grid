// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { PooledCell } from "../../../internal/poolTypes";
import { bindCellShell, clearCellShell, createCellShellPreview } from "../CellShellManager";
import type { CellShellConfig } from "../cellShellTypes";

function makeCell(): PooledCell {
  return {
    element: document.createElement("div"),
    value: "",
  };
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    row: { name: "Alice", status: "active", score: 75 },
    rowId: "r1",
    rowIndex: 0,
    column: { field: "name" },
    field: "name",
    value: "Alice",
    formattedValue: "Alice",
    ...overrides,
  };
}

describe("CellShellManager", () => {
  // ── text ────────────────────────────────────────────────────────────

  it("mounts text shell with label", () => {
    const cell = makeCell();
    const config: CellShellConfig = { kind: "text" };
    bindCellShell(cell, baseParams(), config);

    expect(cell.shellKind).toBe("text");
    expect(cell.shellRoot).toBeDefined();
    expect(cell.shellRoot!.className).toContain("lfg-cell-shell-text");
    const label = cell.shellRoot!.querySelector(".lfg-cell-shell-label");
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("Alice");
  });

  // ── badge ───────────────────────────────────────────────────────────

  it("mounts badge shell with label, dot, and tone", () => {
    const cell = makeCell();
    const config: CellShellConfig = {
      kind: "badge",
      dot: true,
      tone: { map: { active: "green" }, fallback: "gray" },
    };
    bindCellShell(
      cell,
      baseParams({ field: "status", value: "active", formattedValue: "active" }),
      config,
    );

    expect(cell.shellKind).toBe("badge");
    const root = cell.shellRoot!;
    expect(root.className).toContain("lfg-cell-shell-badge");
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("active");
    expect(root.querySelector(".lfg-cell-shell-dot")).not.toBeNull();
    expect(root.getAttribute("data-tone")).toBe("green");
  });

  it("creates a display-safe badge preview", () => {
    const preview = createCellShellPreview({
      row: { status: "active" },
      rowIndex: 0,
      column: {
        field: "status",
        cellShell: {
          kind: "badge",
          icon: "A",
          tone: { map: { active: "success" } },
        },
      },
      field: "status",
      value: "active",
      formattedValue: "active",
    });

    expect(preview).not.toBeNull();
    expect(preview!.classList.contains("lfg-cell-shell-preview")).toBe(true);
    expect(preview!.classList.contains("lfg-cell-shell-badge")).toBe(true);
    expect(preview!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("active");
    expect(preview!.querySelector(".lfg-cell-shell-icon")!.textContent).toBe("A");
    expect(preview!.getAttribute("data-tone")).toBe("success");
  });

  it("creates a display-safe iconText preview", () => {
    const preview = createCellShellPreview({
      row: { status: "pending" },
      rowIndex: 0,
      column: { field: "status", cellShell: { kind: "iconText", icon: "P" } },
      field: "status",
      value: "pending",
      formattedValue: "Pending",
    });

    expect(preview).not.toBeNull();
    expect(preview!.classList.contains("lfg-cell-shell-icon-text")).toBe(true);
    expect(preview!.querySelector(".lfg-cell-shell-icon")!.textContent).toBe("P");
    expect(preview!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Pending");
  });

  it("returns null for interactive preview shells", () => {
    expect(createCellShellPreview({
      row: { status: "active" },
      rowIndex: 0,
      column: { field: "status", cellShell: { kind: "button", actionKey: "edit" } },
      field: "status",
      value: "active",
      formattedValue: "active",
    })).toBeNull();

    expect(createCellShellPreview({
      row: { status: "active" },
      rowIndex: 0,
      column: { field: "status", cellShell: { kind: "badge", overlay: { key: "details" } } },
      field: "status",
      value: "active",
      formattedValue: "active",
    })).toBeNull();
  });

  it("preview resolves field-based shell text from the sample row", () => {
    const preview = createCellShellPreview({
      row: { status: "active", statusLabel: "Ready" },
      rowIndex: 2,
      column: {
        field: "status",
        cellShell: { kind: "badge", text: { field: "statusLabel" } },
      },
      field: "status",
      value: "active",
      formattedValue: "active",
    });

    expect(preview).not.toBeNull();
    expect(preview!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Ready");
  });

  it("badge uses fallback tone when value not in map", () => {
    const cell = makeCell();
    const config: CellShellConfig = {
      kind: "badge",
      tone: { map: { active: "green" }, fallback: "gray" },
    };
    bindCellShell(
      cell,
      baseParams({ value: "unknown", formattedValue: "unknown" }),
      config,
    );
    expect(cell.shellRoot!.getAttribute("data-tone")).toBe("gray");
  });

  it("badge renders icon when icon is configured", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "badge", icon: "✔" });

    const icon = cell.shellRoot!.querySelector(
      ".lfg-cell-shell-icon",
    ) as HTMLElement;
    expect(icon).not.toBeNull();
    expect(icon.textContent).toBe("✔");
    expect(icon.hidden).toBe(false);
  });

  it("badge icon appears/disappears without stale content on pooled rebind", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "badge", icon: "✔" });
    const rootRef = cell.shellRoot;
    const icon = cell.shellRoot!.querySelector(
      ".lfg-cell-shell-icon",
    ) as HTMLElement;
    expect(icon.textContent).toBe("✔");
    expect(icon.hidden).toBe(false);

    bindCellShell(cell, baseParams(), { kind: "badge" });

    // Same pooled root — not recreated on rebind.
    expect(cell.shellRoot).toBe(rootRef);
    expect(icon.textContent).toBe("");
    expect(icon.hidden).toBe(true);

    bindCellShell(cell, baseParams(), { kind: "badge", icon: "★" });
    expect(cell.shellRoot).toBe(rootRef);
    expect(icon.textContent).toBe("★");
    expect(icon.hidden).toBe(false);
  });

  it("badge can render icon while dot hides and unhides", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "badge", icon: "★", dot: false });

    const root = cell.shellRoot!;
    const icon = root.querySelector(".lfg-cell-shell-icon") as HTMLElement;
    const dot = root.querySelector(".lfg-cell-shell-dot") as HTMLElement;
    expect(icon.textContent).toBe("★");
    expect(icon.hidden).toBe(false);
    expect(dot.hidden).toBe(true);

    bindCellShell(cell, baseParams(), { kind: "badge", icon: "★", dot: true });
    expect(cell.shellRoot).toBe(root);
    expect(dot.hidden).toBe(false);
  });

  // ── update without replacing root ───────────────────────────────────

  it("updates existing shell without replacing root when same kind", () => {
    const cell = makeCell();
    const config: CellShellConfig = { kind: "text" };
    bindCellShell(cell, baseParams(), config);

    const rootRef = cell.shellRoot;

    bindCellShell(
      cell,
      baseParams({ value: "Bob", formattedValue: "Bob" }),
      config,
    );

    expect(cell.shellRoot).toBe(rootRef);
    expect(rootRef!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Bob");
  });

  // ── kind change ─────────────────────────────────────────────────────

  it("changes shell kind by clearing old shell DOM", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "text" });
    expect(cell.shellKind).toBe("text");
    const oldRoot = cell.shellRoot;

    bindCellShell(cell, baseParams(), { kind: "badge" });
    expect(cell.shellKind).toBe("badge");
    expect(cell.shellRoot).not.toBe(oldRoot);
    expect(cell.shellRoot!.className).toContain("lfg-cell-shell-badge");
    expect(cell.element.contains(oldRoot!)).toBe(false);
  });

  // ── clear ───────────────────────────────────────────────────────────

  it("clear returns cell to empty text-ready state", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "badge" });
    expect(cell.shellRoot).toBeDefined();

    clearCellShell(cell);

    expect(cell.shellKind).toBeUndefined();
    expect(cell.shellKey).toBeUndefined();
    expect(cell.shellRoot).toBeUndefined();
    expect(cell.element.children.length).toBe(0);
  });

  // ── prefixSuffix ────────────────────────────────────────────────────

  it("prefix/suffix renders and updates", () => {
    const cell = makeCell();
    const config: CellShellConfig = { kind: "prefixSuffix", prefix: "$", suffix: "USD" };
    bindCellShell(cell, baseParams({ value: 100, formattedValue: "100" }), config);

    const root = cell.shellRoot!;
    expect(root.querySelector(".lfg-cell-shell-prefix")!.textContent).toBe("$");
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("100");
    expect(root.querySelector(".lfg-cell-shell-suffix")!.textContent).toBe("USD");

    const config2: CellShellConfig = { kind: "prefixSuffix", prefix: "€", suffix: "EUR" };
    bindCellShell(cell, baseParams({ value: 200, formattedValue: "200" }), config2);
    expect(root.querySelector(".lfg-cell-shell-prefix")!.textContent).toBe("€");
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("200");
    expect(root.querySelector(".lfg-cell-shell-suffix")!.textContent).toBe("EUR");
  });

  // ── progress ────────────────────────────────────────────────────────

  it("progress clamps value and updates ratio without setting fill width", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams({ value: 75, formattedValue: "75%" }), { kind: "progress" });

    const root = cell.shellRoot!;
    expect(root.getAttribute("data-value")).toBe("75");
    const fill = root.querySelector(".lfg-cell-shell-progress-fill") as HTMLElement;
    expect(root.style.getPropertyValue("--lfg-cell-shell-progress-ratio")).toBe("0.75");
    expect(fill.style.width).toBe("");

    // Clamp above 100
    bindCellShell(cell, baseParams({ value: 150, formattedValue: "150%" }), { kind: "progress" });
    expect(root.getAttribute("data-value")).toBe("100");
    expect(root.style.getPropertyValue("--lfg-cell-shell-progress-ratio")).toBe("1");
    expect(fill.style.width).toBe("");

    // Clamp below 0
    bindCellShell(cell, baseParams({ value: -10, formattedValue: "-10%" }), { kind: "progress" });
    expect(root.getAttribute("data-value")).toBe("0");
    expect(root.style.getPropertyValue("--lfg-cell-shell-progress-ratio")).toBe("0");
    expect(fill.style.width).toBe("");
  });

  // ── rating ──────────────────────────────────────────────────────────

  it("rating sets data-rating and icon", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams({ value: 4.5, formattedValue: "4.5" }), { kind: "rating" });

    const root = cell.shellRoot!;
    expect(root.getAttribute("data-rating")).toBe("4.5");
    expect(root.querySelector(".lfg-cell-shell-icon")!.textContent).toBe("★");
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("4.5");
  });

  // ── button ──────────────────────────────────────────────────────────

  it("button renders icon and label", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "button", icon: "✏️" });

    const root = cell.shellRoot!;
    expect(root.tagName).toBe("BUTTON");
    expect((root as HTMLButtonElement).type).toBe("button");
    expect((root as HTMLButtonElement).tabIndex).toBe(-1);
    expect(root.getAttribute("aria-label")).toBe("Alice");
    expect(root.getAttribute("role")).toBeNull();
    expect(root.querySelector(".lfg-cell-shell-icon")!.textContent).toBe("✏️");
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Alice");
  });

  // ── iconButton ──────────────────────────────────────────────────────

  it("iconButton renders icon and aria-label", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams({ formattedValue: "Edit" }), { kind: "iconButton", icon: "✏️" });

    const root = cell.shellRoot!;
    expect(root.tagName).toBe("BUTTON");
    expect((root as HTMLButtonElement).tabIndex).toBe(-1);
    expect(root.querySelector(".lfg-cell-shell-icon")!.textContent).toBe("✏️");
    expect(root.getAttribute("aria-label")).toBe("Edit");
  });

  // ── link ────────────────────────────────────────────────────────────

  it("link renders label", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams({ formattedValue: "Click here" }), { kind: "link" });

    const root = cell.shellRoot!;
    expect(root.className).toContain("lfg-cell-shell-link");
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Click here");
  });

  // ── media / text shells ─────────────────────────────────────────────

  const imgConfig = (
    src: string | undefined,
    alt?: string,
  ): CellShellConfig => ({
    kind: "image",
    image:
      src === undefined
        ? undefined
        : { src: { literal: src }, ...(alt ? { alt: { literal: alt } } : {}) },
  });

  it("image renders src and alt", () => {
    const cell = makeCell();
    bindCellShell(
      cell,
      baseParams(),
      imgConfig("https://x/a.png", "Avatar A"),
    );

    const root = cell.shellRoot!;
    expect(root.className).toContain("lfg-cell-shell-image");
    const img = root.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://x/a.png");
    expect(img.getAttribute("alt")).toBe("Avatar A");
    expect(img.hidden).toBe(false);
  });

  it("image alt falls back to text label when alt not configured", () => {
    const cell = makeCell();
    bindCellShell(
      cell,
      baseParams({ formattedValue: "Alice" }),
      imgConfig("https://x/a.png"),
    );
    const img = cell.shellRoot!.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("Alice");
  });

  it("image hides and clears src/alt when rebound without src", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), imgConfig("https://x/a.png", "Avatar A"));
    const root = cell.shellRoot!;
    const img = root.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://x/a.png");

    // Same kind, same pooled root, but no src this time.
    bindCellShell(cell, baseParams(), { kind: "image" });
    expect(cell.shellRoot).toBe(root);
    expect(img.getAttribute("src")).toBeNull();
    expect(img.getAttribute("alt")).toBeNull();
    expect(img.hidden).toBe(true);

    bindCellShell(cell, baseParams(), imgConfig("https://x/b.png", "Avatar B"));
    expect(cell.shellRoot).toBe(root);
    expect(img.getAttribute("src")).toBe("https://x/b.png");
    expect(img.getAttribute("alt")).toBe("Avatar B");
    expect(img.hidden).toBe(false);
  });

  it("imageText renders image and label", () => {
    const cell = makeCell();
    bindCellShell(
      cell,
      baseParams({ formattedValue: "Alice" }),
      {
        kind: "imageText",
        image: { src: { literal: "https://x/a.png" } },
      },
    );

    const root = cell.shellRoot!;
    expect(root.className).toContain("lfg-cell-shell-image-text");
    expect((root.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe(
      "https://x/a.png",
    );
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Alice");
  });

  it("avatar uses circular avatar class and clears stale src", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "avatar",
      image: { src: { literal: "https://x/a.png" } },
    });

    const root = cell.shellRoot!;
    expect(root.className).toContain("lfg-cell-shell-avatar");
    const img = root.querySelector("img") as HTMLImageElement;
    expect(img.className).toContain("lfg-cell-shell-avatar-img");
    expect(img.getAttribute("src")).toBe("https://x/a.png");

    bindCellShell(cell, baseParams(), { kind: "avatar" });
    expect(cell.shellRoot).toBe(root);
    expect(img.getAttribute("src")).toBeNull();
    expect(img.hidden).toBe(true);
  });

  it("avatarText renders avatar image and label", () => {
    const cell = makeCell();
    bindCellShell(
      cell,
      baseParams({ formattedValue: "Alice" }),
      {
        kind: "avatarText",
        image: { src: { literal: "https://x/a.png" } },
      },
    );

    const root = cell.shellRoot!;
    expect(root.className).toContain("lfg-cell-shell-avatar-text");
    const img = root.querySelector("img") as HTMLImageElement;
    expect(img.className).toContain("lfg-cell-shell-avatar-img");
    expect(img.getAttribute("src")).toBe("https://x/a.png");
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Alice");
  });

  it("iconText renders icon + label and updates icon on pooled rebind", () => {
    const cell = makeCell();
    bindCellShell(
      cell,
      baseParams({ formattedValue: "Alice" }),
      { kind: "iconText", icon: "🔵" },
    );

    const root = cell.shellRoot!;
    expect(root.className).toContain("lfg-cell-shell-icon-text");
    expect(root.querySelector(".lfg-cell-shell-icon")!.textContent).toBe("🔵");
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Alice");

    bindCellShell(
      cell,
      baseParams({ formattedValue: "Bob" }),
      { kind: "iconText", icon: "🔴" },
    );
    expect(cell.shellRoot).toBe(root);
    expect(root.querySelector(".lfg-cell-shell-icon")!.textContent).toBe("🔴");
    expect(root.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Bob");
  });

  it("same-kind rebind keeps the same root node (image)", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), imgConfig("https://x/a.png"));
    const root = cell.shellRoot;
    bindCellShell(cell, baseParams(), imgConfig("https://x/b.png"));
    expect(cell.shellRoot).toBe(root);
    expect((cell.shellRoot!.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe(
      "https://x/b.png",
    );
  });

  // ── buttonGroup ─────────────────────────────────────────────────────

  it("buttonGroup creates child buttons from parts", () => {
    const cell = makeCell();
    const config: CellShellConfig = {
      kind: "buttonGroup",
      parts: [
        { kind: "iconButton", icon: "👁", text: { literal: "View" }, actionKey: "view" },
        { kind: "iconButton", icon: "✏️", text: { literal: "Edit" }, actionKey: "edit" },
        { kind: "button", text: { literal: "Delete" }, actionKey: "delete" },
      ],
    };
    bindCellShell(cell, baseParams(), config);

    expect(cell.shellKind).toBe("buttonGroup");
    const root = cell.shellRoot!;
    expect(root.className).toContain("lfg-cell-shell-button-group");
    expect(root.children.length).toBe(3);

    const btn0 = root.children[0] as HTMLButtonElement;
    expect(btn0.tagName).toBe("BUTTON");
    expect(btn0.type).toBe("button");
    expect(btn0.tabIndex).toBe(-1);
    expect(btn0.getAttribute("data-action")).toBe("view");
    expect(btn0.getAttribute("aria-label")).toBe("View");
    expect(btn0.querySelector(".lfg-cell-shell-group-button-icon")!.textContent).toBe("👁");

    const btn2 = root.children[2] as HTMLButtonElement;
    expect(btn2.tabIndex).toBe(-1);
    expect(btn2.getAttribute("aria-label")).toBe("Delete");
    expect(btn2.getAttribute("data-action")).toBe("delete");
    expect(btn2.querySelector(".lfg-cell-shell-group-button-label")!.textContent).toBe("Delete");
  });

  it("buttonGroup same-kind rebind reuses root and updates children", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "A" }, actionKey: "a" },
        { kind: "button", text: { literal: "B" }, actionKey: "b" },
      ],
    });
    const root = cell.shellRoot!;
    const firstChild = root.children[0];

    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "X" }, actionKey: "x" },
        { kind: "button", text: { literal: "Y" }, actionKey: "y" },
      ],
    });

    expect(cell.shellRoot).toBe(root);
    expect(root.children[0]).toBe(firstChild);
    expect(root.children.length).toBe(2);
    expect((root.children[0] as HTMLElement).getAttribute("data-action")).toBe("x");
    expect(root.children[0]!.querySelector(".lfg-cell-shell-group-button-label")!.textContent).toBe("X");
    expect((root.children[1] as HTMLElement).getAttribute("data-action")).toBe("y");
  });

  it("buttonGroup adds/removes children when part count changes without replacing root", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "A" }, actionKey: "a" },
      ],
    });
    const root = cell.shellRoot!;
    expect(root.children.length).toBe(1);

    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "A" }, actionKey: "a" },
        { kind: "button", text: { literal: "B" }, actionKey: "b" },
        { kind: "button", text: { literal: "C" }, actionKey: "c" },
      ],
    });
    expect(cell.shellRoot).toBe(root);
    expect(root.children.length).toBe(3);

    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "X" }, actionKey: "x" },
      ],
    });
    expect(cell.shellRoot).toBe(root);
    expect(root.children.length).toBe(1);
    expect((root.children[0] as HTMLElement).getAttribute("data-action")).toBe("x");
  });

  it("buttonGroup iconButton->button at same index replaces child with correct label", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "iconButton", icon: "👁", text: { literal: "View" }, actionKey: "view" },
      ],
    });
    const root = cell.shellRoot!;
    const oldChild = root.children[0]!;
    expect(oldChild.getAttribute("data-shell-part-kind")).toBe("iconButton");
    expect(oldChild.querySelector(".lfg-cell-shell-group-button-label")).toBeNull();

    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "View" }, actionKey: "view" },
      ],
    });
    expect(cell.shellRoot).toBe(root);
    const newChild = root.children[0]!;
    expect(newChild).not.toBe(oldChild);
    expect(newChild.getAttribute("data-shell-part-kind")).toBe("button");
    expect(newChild.querySelector(".lfg-cell-shell-group-button-label")!.textContent).toBe("View");
    expect(newChild.getAttribute("data-action")).toBe("view");
  });

  it("buttonGroup button->iconButton at same index replaces child with icon and aria-label", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "Edit" }, actionKey: "edit" },
      ],
    });
    const root = cell.shellRoot!;
    const oldChild = root.children[0]!;
    expect(oldChild.getAttribute("data-shell-part-kind")).toBe("button");
    expect(oldChild.querySelector(".lfg-cell-shell-group-button-label")).not.toBeNull();

    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "iconButton", icon: "✏️", text: { literal: "Edit" }, actionKey: "edit" },
      ],
    });
    expect(cell.shellRoot).toBe(root);
    const newChild = root.children[0] as HTMLElement;
    expect(newChild).not.toBe(oldChild);
    expect(newChild.getAttribute("data-shell-part-kind")).toBe("iconButton");
    expect(newChild.querySelector(".lfg-cell-shell-group-button-label")).toBeNull();
    expect(newChild.querySelector(".lfg-cell-shell-group-button-icon")!.textContent).toBe("✏️");
    expect(newChild.getAttribute("aria-label")).toBe("Edit");
    expect(newChild.getAttribute("data-action")).toBe("edit");
  });

  it("buttonGroup same-kind child at same index reuses that child element", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "A" }, actionKey: "a" },
      ],
    });
    const root = cell.shellRoot!;
    const child = root.children[0]!;

    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "B" }, actionKey: "b" },
      ],
    });
    expect(cell.shellRoot).toBe(root);
    expect(root.children[0]).toBe(child);
    expect((root.children[0] as HTMLElement).getAttribute("data-action")).toBe("b");
  });

  it("buttonGroup same-kind button child no icon -> icon adds icon without replacing child", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "Go" }, actionKey: "go" },
      ],
    });
    const root = cell.shellRoot!;
    const child = root.children[0]!;
    expect(child.querySelector(".lfg-cell-shell-group-button-icon")).toBeNull();

    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", icon: "🚀", text: { literal: "Go" }, actionKey: "go" },
      ],
    });
    expect(cell.shellRoot).toBe(root);
    expect(root.children[0]).toBe(child);
    const icon = child.querySelector(".lfg-cell-shell-group-button-icon") as HTMLElement;
    expect(icon).not.toBeNull();
    expect(icon.textContent).toBe("🚀");
    expect(icon.hidden).toBe(false);
    expect(child.querySelector(".lfg-cell-shell-group-button-label")!.textContent).toBe("Go");
  });

  it("buttonGroup same-kind button child icon -> no icon hides/clears icon without replacing child", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", icon: "🚀", text: { literal: "Go" }, actionKey: "go" },
      ],
    });
    const root = cell.shellRoot!;
    const child = root.children[0]!;
    const icon = child.querySelector(".lfg-cell-shell-group-button-icon") as HTMLElement;
    expect(icon.textContent).toBe("🚀");

    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "Go" }, actionKey: "go" },
      ],
    });
    expect(cell.shellRoot).toBe(root);
    expect(root.children[0]).toBe(child);
    expect(icon.textContent).toBe("");
    expect(icon.hidden).toBe(true);
    expect(child.querySelector(".lfg-cell-shell-group-button-label")!.textContent).toBe("Go");
  });

  it("buttonGroup ignores unsupported child part kinds", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "badge", text: { literal: "Nope" } },
        { kind: "button", text: { literal: "OK" }, actionKey: "ok" },
        { kind: "progress" },
      ],
    });
    expect(cell.shellRoot!.children.length).toBe(1);
    expect((cell.shellRoot!.children[0] as HTMLElement).getAttribute("data-action")).toBe("ok");
  });

  it("buttonGroup child without actionKey has no data-action", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "Plain" } },
      ],
    });
    expect(cell.shellRoot!.children[0]!.hasAttribute("data-action")).toBe(false);
  });

  it("no per-cell listeners are added during buttonGroup shell build", () => {
    const cellEl = document.createElement("div");
    const addSpy = vi.spyOn(cellEl, "addEventListener");
    const cell: PooledCell = { element: cellEl, value: "" };

    bindCellShell(cell, baseParams(), {
      kind: "buttonGroup",
      parts: [
        { kind: "button", text: { literal: "Go" }, actionKey: "go" },
      ],
    });

    expect(addSpy).not.toHaveBeenCalled();
  });

  // ── unsupported kind fallback ───────────────────────────────────────

  it("unsupported kind falls back to text", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "inline" });

    expect(cell.shellKind).toBe("text");
    expect(cell.shellRoot!.className).toContain("lfg-cell-shell-text");
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Alice");
  });

  // ── value source resolution ─────────────────────────────────────────

  it("resolves text from { field } source", () => {
    const cell = makeCell();
    const config: CellShellConfig = { kind: "text", text: { field: "status" } };
    bindCellShell(
      cell,
      baseParams({ row: { name: "Alice", status: "active" } }),
      config,
    );
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("active");
  });

  it("resolves text from { literal } source", () => {
    const cell = makeCell();
    const config: CellShellConfig = { kind: "text", text: { literal: "Hello" } };
    bindCellShell(cell, baseParams(), config);
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Hello");
  });

  it('resolves text from "value" source', () => {
    const cell = makeCell();
    const config: CellShellConfig = { kind: "text", text: "value" };
    bindCellShell(cell, baseParams({ value: 42, formattedValue: "forty-two" }), config);
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("42");
  });

  // ── className (multi-token) ──────────────────────────────────────────

  it("applies single className token to shell root", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "text", className: "my-custom" });
    expect(cell.shellRoot!.classList.contains("my-custom")).toBe(true);
    expect(cell.shellClassNames).toEqual(["my-custom"]);
  });

  it("applies multiple className tokens from a space-separated string", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "text", className: "a b" });
    expect(cell.shellRoot!.classList.contains("a")).toBe(true);
    expect(cell.shellRoot!.classList.contains("b")).toBe(true);
    expect(cell.shellClassNames).toEqual(["a", "b"]);
  });

  it("deduplicates repeated className tokens", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "text", className: "x y x" });
    expect(cell.shellClassNames).toEqual(["x", "y"]);
    expect(cell.shellRoot!.classList.contains("x")).toBe(true);
    expect(cell.shellRoot!.classList.contains("y")).toBe(true);
  });

  it("skips class diff when content-equal tokens are re-applied", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "text", className: "a b" });
    const root = cell.shellRoot!;
    const snapshot = cell.shellClassNames;

    bindCellShell(cell, baseParams({ value: "Bob", formattedValue: "Bob" }), { kind: "text", className: "a b" });
    // Token array reference stays the same — content-equal skip worked.
    expect(cell.shellClassNames).toBe(snapshot);
    expect(root.classList.contains("a")).toBe(true);
    expect(root.classList.contains("b")).toBe(true);
  });

  // ── actionKey (only action-capable kinds) ────────────────────────────

  it("button with actionKey writes data-action", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "button", actionKey: "edit" });
    expect(cell.shellRoot!.getAttribute("data-action")).toBe("edit");
  });

  it("iconButton with actionKey writes data-action", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "iconButton", actionKey: "remove", icon: "🗑" });
    expect(cell.shellRoot!.getAttribute("data-action")).toBe("remove");
  });

  it("link with actionKey writes data-action", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "link", actionKey: "open" });
    expect(cell.shellRoot!.getAttribute("data-action")).toBe("open");
  });

  it("badge with actionKey does NOT write data-action", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "badge", actionKey: "nope" });
    expect(cell.shellRoot!.hasAttribute("data-action")).toBe(false);
    expect(cell.shellActionKey).toBeUndefined();
  });

  it("progress with actionKey does NOT write data-action", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams({ value: 50, formattedValue: "50%" }), { kind: "progress", actionKey: "nope" });
    expect(cell.shellRoot!.hasAttribute("data-action")).toBe(false);
  });

  it("imageText with actionKey does NOT write data-action", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "imageText",
      actionKey: "nope",
      image: { src: { literal: "https://x/a.png" } },
    });
    expect(cell.shellRoot!.hasAttribute("data-action")).toBe(false);
  });

  it("rebinding from button+actionKey to badge+same actionKey removes stale data-action", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "button", actionKey: "edit" });
    expect(cell.shellRoot!.getAttribute("data-action")).toBe("edit");
    expect(cell.shellActionKey).toBe("edit");

    bindCellShell(cell, baseParams(), { kind: "badge", actionKey: "edit" });
    expect(cell.shellRoot!.hasAttribute("data-action")).toBe(false);
    expect(cell.shellActionKey).toBeUndefined();
  });

  // ── Bug 1: horizontal recycle across fields with same shell kind ────

  it("recycles same shell kind between different fields", () => {
    const cell = makeCell();
    const row = { name: "Alice", status: "active" };

    // Bind field A with badge
    bindCellShell(
      cell,
      baseParams({ row, field: "name", value: "Alice", formattedValue: "Alice" }),
      { kind: "badge" },
    );
    expect(cell.shellKind).toBe("badge");
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("Alice");

    // Simulate horizontal recycle: clear shell (as populateRow does on field change)
    clearCellShell(cell);
    cell.value = "";
    cell.element.textContent = "";

    // Re-bind same kind for field B
    bindCellShell(
      cell,
      baseParams({ row, field: "status", value: "active", formattedValue: "active" }),
      { kind: "badge" },
    );
    expect(cell.shellKind).toBe("badge");
    expect(cell.element.querySelector(".lfg-cell-shell-badge")).not.toBeNull();
    expect(cell.shellRoot!.querySelector(".lfg-cell-shell-label")!.textContent).toBe("active");
  });

  // ── stale className removal on same-kind update ─────────────────────

  it("removes old className and adds new one on same-kind update", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "text", className: "a" });
    expect(cell.shellRoot!.classList.contains("a")).toBe(true);
    expect(cell.shellClassNames).toEqual(["a"]);

    bindCellShell(cell, baseParams(), { kind: "text", className: "b" });
    expect(cell.shellRoot!.classList.contains("a")).toBe(false);
    expect(cell.shellRoot!.classList.contains("b")).toBe(true);
    expect(cell.shellClassNames).toEqual(["b"]);
  });

  it("diffs multi-token className: removes dropped, keeps shared, adds new", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "text", className: "a b" });
    expect(cell.shellRoot!.classList.contains("a")).toBe(true);
    expect(cell.shellRoot!.classList.contains("b")).toBe(true);

    bindCellShell(cell, baseParams(), { kind: "text", className: "b c" });
    expect(cell.shellRoot!.classList.contains("a")).toBe(false);
    expect(cell.shellRoot!.classList.contains("b")).toBe(true);
    expect(cell.shellRoot!.classList.contains("c")).toBe(true);
    expect(cell.shellClassNames).toEqual(["b", "c"]);
  });

  it("removes all className tokens when config drops className", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "text", className: "x y" });
    expect(cell.shellRoot!.classList.contains("x")).toBe(true);
    expect(cell.shellRoot!.classList.contains("y")).toBe(true);

    bindCellShell(cell, baseParams(), { kind: "text" });
    expect(cell.shellRoot!.classList.contains("x")).toBe(false);
    expect(cell.shellRoot!.classList.contains("y")).toBe(false);
    expect(cell.shellClassNames).toBeUndefined();
  });

  // ── Bug 2: stale actionKey removal on same-kind update ─────────────

  it("removes data-action when actionKey is dropped on same-kind update", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "button", actionKey: "edit" });
    expect(cell.shellRoot!.getAttribute("data-action")).toBe("edit");
    expect(cell.shellActionKey).toBe("edit");

    bindCellShell(cell, baseParams(), { kind: "button" });
    expect(cell.shellRoot!.hasAttribute("data-action")).toBe(false);
    expect(cell.shellActionKey).toBeUndefined();
  });

  it("updates data-action when actionKey changes on same-kind update", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "button", actionKey: "edit" });
    expect(cell.shellRoot!.getAttribute("data-action")).toBe("edit");

    bindCellShell(cell, baseParams(), { kind: "button", actionKey: "delete" });
    expect(cell.shellRoot!.getAttribute("data-action")).toBe("delete");
    expect(cell.shellActionKey).toBe("delete");
  });

  // ── overlay attrs on pooled rebind ──────────────────────────────────

  it("button with overlay writes data-overlay-key and data-overlay-trigger", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "button",
      overlay: { key: "info" },
      text: { literal: "Open" },
    });
    expect(cell.shellRoot!.getAttribute("data-overlay-key")).toBe("info");
    expect(cell.shellRoot!.getAttribute("data-overlay-trigger")).toBe("click");
  });

  it("same-kind rebind updates data-overlay-trigger when key stays the same", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "button",
      overlay: { key: "info", trigger: "click" },
      text: { literal: "Open" },
    });
    const root = cell.shellRoot!;
    expect(root.getAttribute("data-overlay-trigger")).toBe("click");

    bindCellShell(cell, baseParams(), {
      kind: "button",
      overlay: { key: "info" },
      text: { literal: "Open" },
    });
    expect(cell.shellRoot).toBe(root);
    expect(root.getAttribute("data-overlay-trigger")).toBe("click");
  });

  it("removing overlay on same-kind rebind clears stale overlay attrs", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), {
      kind: "button",
      overlay: { key: "info" },
      text: { literal: "Open" },
    });
    const root = cell.shellRoot!;
    expect(root.hasAttribute("data-overlay-key")).toBe(true);

    bindCellShell(cell, baseParams(), {
      kind: "button",
      text: { literal: "Open" },
    });
    expect(cell.shellRoot).toBe(root);
    expect(root.hasAttribute("data-overlay-key")).toBe(false);
    expect(root.hasAttribute("data-overlay-trigger")).toBe(false);
  });

  // ── clearCellShell resets bookkeeping fields ────────────────────────

  it("clearCellShell resets shellClassNames and shellActionKey", () => {
    const cell = makeCell();
    bindCellShell(cell, baseParams(), { kind: "button", className: "my-cls extra", actionKey: "save" });
    expect(cell.shellClassNames).toEqual(["my-cls", "extra"]);
    expect(cell.shellActionKey).toBe("save");

    clearCellShell(cell);
    expect(cell.shellClassNames).toBeUndefined();
    expect(cell.shellActionKey).toBeUndefined();
  });
});
