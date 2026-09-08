import { composeAccessibleNameWithVisibleText } from "../../internal/accessibleName";
import { isBooleanCellValue } from "../../internal/booleanCellValue";
import { isCellEditEligible } from "../../internal/cellEditEligibility";
import type { PooledCell } from "../../internal/poolTypes";
import type { ColumnDef, RowData } from "../../types";

import type { CellShellConfig, CellShellKind } from "./cellShellTypes";
import { normalizeCellShell } from "./normalizeCellShell";
import type { ShellValueContext } from "./resolveShellValue";
import { resolveShellTone, resolveShellValue } from "./resolveShellValue";

export interface CellShellBindParams {
  row: RowData;
  rowId: string;
  rowIndex: number;
  column: ColumnDef;
  field: string;
  value: unknown;
  formattedValue: string;
}

export interface CellShellPreviewParams {
  row: RowData;
  rowIndex: number;
  column: ColumnDef;
  field: string;
  value: unknown;
  formattedValue: string;
}

// Shell kinds implemented so far; everything else falls back to text.
const SUPPORTED_KINDS: ReadonlySet<CellShellKind> = new Set([
  "text",
  "badge",
  "checkbox",
  "prefixSuffix",
  "button",
  "iconButton",
  "buttonGroup",
  "link",
  "rating",
  "progress",
  "image",
  "imageText",
  "avatar",
  "avatarText",
  "iconText",
]);

function effectiveKind(kind: CellShellKind): CellShellKind {
  return SUPPORTED_KINDS.has(kind) ? kind : "text";
}

const ACTION_SHELL_KINDS: ReadonlySet<CellShellKind> = new Set([
  "button",
  "iconButton",
  "link",
]);

const PREVIEW_SAFE_KINDS: ReadonlySet<CellShellKind> = new Set([
  "text",
  "badge",
  "prefixSuffix",
  "iconText",
  "image",
  "imageText",
  "avatar",
  "avatarText",
  "rating",
  "progress",
]);

export function isActionShellKind(kind: CellShellKind): boolean {
  return ACTION_SHELL_KINDS.has(kind);
}

// ── Shell DOM builders (called once per physical cell / kind) ─────────

function createTextShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-text";
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  root.appendChild(label);
  return root;
}

function createBadgeShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-badge";
  const dot = document.createElement("span");
  dot.className = "lfg-cell-shell-dot";
  // Icon sits between the dot and the label; hidden until config supplies one.
  const icon = document.createElement("span");
  icon.className = "lfg-cell-shell-icon";
  icon.hidden = true;
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  root.appendChild(dot);
  root.appendChild(icon);
  root.appendChild(label);
  return root;
}

function createCheckboxShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-checkbox";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.tabIndex = -1;
  input.className = "lfg-cell-shell-checkbox-input";
  root.appendChild(input);
  return root;
}

function createPrefixSuffixShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-prefix-suffix";
  const prefix = document.createElement("span");
  prefix.className = "lfg-cell-shell-prefix";
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  const suffix = document.createElement("span");
  suffix.className = "lfg-cell-shell-suffix";
  root.appendChild(prefix);
  root.appendChild(label);
  root.appendChild(suffix);
  return root;
}

function createButtonShell(): HTMLButtonElement {
  const root = document.createElement("button");
  root.type = "button";
  root.tabIndex = -1;
  root.className = "lfg-cell-shell lfg-cell-shell-button";
  const icon = document.createElement("span");
  icon.className = "lfg-cell-shell-icon";
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  root.appendChild(icon);
  root.appendChild(label);
  return root;
}

function createIconButtonShell(): HTMLButtonElement {
  const root = document.createElement("button");
  root.type = "button";
  root.tabIndex = -1;
  root.className = "lfg-cell-shell lfg-cell-shell-icon-button";
  root.setAttribute("aria-label", "");
  const icon = document.createElement("span");
  icon.className = "lfg-cell-shell-icon";
  root.appendChild(icon);
  return root;
}

function createLinkShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-link";
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  root.appendChild(label);
  return root;
}

function createRatingShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-rating";
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  const icon = document.createElement("span");
  icon.className = "lfg-cell-shell-icon";
  root.appendChild(label);
  root.appendChild(icon);
  return root;
}

function createProgressShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-progress";
  const track = document.createElement("span");
  track.className = "lfg-cell-shell-progress-track";
  const fill = document.createElement("span");
  fill.className = "lfg-cell-shell-progress-fill";
  track.appendChild(fill);
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  root.appendChild(track);
  root.appendChild(label);
  return root;
}

// Image element shared by image / avatar shells. Hidden until a src resolves.
function createShellImage(imgClass: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = imgClass;
  img.hidden = true;
  return img;
}

function createImageShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-image";
  root.appendChild(createShellImage("lfg-cell-shell-img"));
  return root;
}

function createImageTextShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-image-text";
  root.appendChild(createShellImage("lfg-cell-shell-img"));
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  root.appendChild(label);
  return root;
}

function createAvatarShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-avatar";
  root.appendChild(createShellImage("lfg-cell-shell-avatar-img"));
  return root;
}

function createAvatarTextShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-avatar-text";
  root.appendChild(createShellImage("lfg-cell-shell-avatar-img"));
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  root.appendChild(label);
  return root;
}

function createIconTextShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-icon-text";
  const icon = document.createElement("span");
  icon.className = "lfg-cell-shell-icon";
  const label = document.createElement("span");
  label.className = "lfg-cell-shell-label";
  root.appendChild(icon);
  root.appendChild(label);
  return root;
}

function createButtonGroupShell(): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "lfg-cell-shell lfg-cell-shell-button-group";
  return root;
}

const GROUP_CHILD_KINDS: ReadonlySet<string> = new Set([
  "button",
  "iconButton",
  "link",
]);

function createGroupChildButton(part: CellShellConfig): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.tabIndex = -1;
  btn.className = "lfg-cell-shell-group-button";
  btn.setAttribute("data-shell-part-kind", part.kind);
  if (part.actionKey !== undefined) {
    btn.setAttribute("data-action", part.actionKey);
  }

  if (part.kind === "iconButton") {
    const icon = document.createElement("span");
    icon.className = "lfg-cell-shell-group-button-icon";
    btn.appendChild(icon);
  } else {
    if (part.icon !== undefined) {
      const icon = document.createElement("span");
      icon.className = "lfg-cell-shell-group-button-icon";
      btn.appendChild(icon);
    }
    const label = document.createElement("span");
    label.className = "lfg-cell-shell-group-button-label";
    btn.appendChild(label);
  }
  return btn;
}

function resolveActionAccessibleName(
  text: string,
  config: CellShellConfig,
  column: ColumnDef | undefined,
): string {
  const resolvedText = text.trim();
  if (resolvedText.length > 0) return resolvedText;

  const header = (column?.headerName ?? column?.field ?? "").trim();
  const actionKey = config.actionKey?.trim() ?? "";
  if (header.length > 0 && actionKey.length > 0) {
    return `${header} ${actionKey}`;
  }
  if (actionKey.length > 0) return actionKey;
  if (header.length > 0) return header;
  return "Cell action";
}

function updateGroupChildButton(
  btn: HTMLButtonElement,
  part: CellShellConfig,
  ctx: ShellValueContext,
  column: ColumnDef | undefined,
): void {
  const actionKey = part.actionKey;
  const oldAction = btn.getAttribute("data-action");
  if ((actionKey ?? null) !== oldAction) {
    if (actionKey !== undefined) {
      btn.setAttribute("data-action", actionKey);
    } else {
      btn.removeAttribute("data-action");
    }
  }

  const text = resolveShellValue(part.text, ctx);
  const accessibleName = resolveActionAccessibleName(text, part, column);
  if (btn.getAttribute("aria-label") !== accessibleName) {
    btn.setAttribute("aria-label", accessibleName);
  }

  if (part.kind === "iconButton") {
    const icon = btn.querySelector(".lfg-cell-shell-group-button-icon");
    if (icon) {
      const iv = part.icon ?? text;
      if (icon.textContent !== iv) icon.textContent = iv;
    }
  } else {
    let icon = btn.querySelector(".lfg-cell-shell-group-button-icon") as HTMLElement | null;
    if (part.icon !== undefined) {
      if (!icon) {
        icon = document.createElement("span");
        icon.className = "lfg-cell-shell-group-button-icon";
        const label = btn.querySelector(".lfg-cell-shell-group-button-label");
        btn.insertBefore(icon, label);
      }
      if (icon.textContent !== part.icon) icon.textContent = part.icon;
      icon.hidden = false;
    } else if (icon) {
      if (icon.textContent !== "") icon.textContent = "";
      icon.hidden = true;
    }

    const label = btn.querySelector(".lfg-cell-shell-group-button-label");
    if (label && label.textContent !== text) label.textContent = text;
  }
}

function updateButtonGroupShell(
  root: HTMLElement,
  _text: string,
  config: CellShellConfig,
  ctx: ShellValueContext,
  column: ColumnDef | undefined,
): void {
  const parts = config.parts;
  if (!parts || parts.length === 0) {
    while (root.firstChild) root.removeChild(root.firstChild);
    return;
  }

  const actionParts: CellShellConfig[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (GROUP_CHILD_KINDS.has(parts[i]!.kind)) {
      actionParts.push(parts[i]!);
    }
  }

  const existing = root.children;
  const existingCount = existing.length;
  const targetCount = actionParts.length;

  // Remove excess children from the end.
  for (let i = existingCount - 1; i >= targetCount; i--) {
    root.removeChild(existing[i]!);
  }

  // Update existing children in place, add new ones at the end.
  // If the part kind at an index changed, replace that child so the
  // inner DOM structure (icon-only vs icon+label) is correct.
  for (let i = 0; i < targetCount; i++) {
    const part = actionParts[i]!;
    let btn: HTMLButtonElement;
    if (i < existingCount) {
      const old = existing[i] as HTMLButtonElement;
      if (old.getAttribute("data-shell-part-kind") === part.kind) {
        btn = old;
      } else {
        btn = createGroupChildButton(part);
        root.replaceChild(btn, old);
      }
    } else {
      btn = createGroupChildButton(part);
      root.appendChild(btn);
    }
    updateGroupChildButton(btn, part, ctx, column);
  }
}

function createShellRoot(kind: CellShellKind): HTMLElement {
  switch (kind) {
    case "badge": return createBadgeShell();
    case "checkbox": return createCheckboxShell();
    case "prefixSuffix": return createPrefixSuffixShell();
    case "button": return createButtonShell();
    case "iconButton": return createIconButtonShell();
    case "link": return createLinkShell();
    case "rating": return createRatingShell();
    case "progress": return createProgressShell();
    case "image": return createImageShell();
    case "imageText": return createImageTextShell();
    case "avatar": return createAvatarShell();
    case "avatarText": return createAvatarTextShell();
    case "iconText": return createIconTextShell();
    case "buttonGroup": return createButtonGroupShell();
    default: return createTextShell();
  }
}

// ── Shell DOM updaters (called on every bind) ────────────────────────

function getChild(root: HTMLElement, cls: string): HTMLElement | null {
  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    const el = children[i] as HTMLElement;
    if (el.classList.contains(cls)) return el;
  }
  return null;
}

function updateTextShell(root: HTMLElement, text: string): void {
  const label = getChild(root, "lfg-cell-shell-label");
  if (label && label.textContent !== text) label.textContent = text;
}

function updateBadgeShell(
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
  ctx: ShellValueContext,
): void {
  const label = getChild(root, "lfg-cell-shell-label");
  if (label && label.textContent !== text) label.textContent = text;

  const dot = getChild(root, "lfg-cell-shell-dot");
  if (dot) {
    dot.hidden = config.dot === false;
  }

  const icon = getChild(root, "lfg-cell-shell-icon");
  if (icon) {
    if (config.icon !== undefined && config.icon !== "") {
      if (icon.textContent !== config.icon) icon.textContent = config.icon;
      icon.hidden = false;
    } else {
      if (icon.textContent !== "") icon.textContent = "";
      icon.hidden = true;
    }
  }

  if (config.tone !== undefined) {
    const tone = resolveShellTone(config.tone, ctx);
    if (tone) {
      root.setAttribute("data-tone", tone);
    } else {
      root.removeAttribute("data-tone");
    }
  } else {
    root.removeAttribute("data-tone");
  }
}

function updatePrefixSuffixShell(
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
): void {
  const label = getChild(root, "lfg-cell-shell-label");
  if (label && label.textContent !== text) label.textContent = text;

  const prefix = getChild(root, "lfg-cell-shell-prefix");
  if (prefix) {
    const pv = config.prefix ?? "";
    if (prefix.textContent !== pv) prefix.textContent = pv;
  }
  const suffix = getChild(root, "lfg-cell-shell-suffix");
  if (suffix) {
    const sv = config.suffix ?? "";
    if (suffix.textContent !== sv) suffix.textContent = sv;
  }
}

function updateButtonShell(
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
  column: ColumnDef | undefined,
): void {
  const accessibleName = resolveActionAccessibleName(text, config, column);
  if (root.getAttribute("aria-label") !== accessibleName) {
    root.setAttribute("aria-label", accessibleName);
  }
  const label = getChild(root, "lfg-cell-shell-label");
  if (label && label.textContent !== text) label.textContent = text;

  const icon = getChild(root, "lfg-cell-shell-icon");
  if (icon) {
    const iv = config.icon ?? "";
    if (icon.textContent !== iv) icon.textContent = iv;
  }
}

function updateIconButtonShell(
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
  column: ColumnDef | undefined,
): void {
  const icon = getChild(root, "lfg-cell-shell-icon");
  if (icon) {
    const iv = config.icon ?? text;
    if (icon.textContent !== iv) icon.textContent = iv;
  }
  const accessibleName = resolveActionAccessibleName(text, config, column);
  if (root.getAttribute("aria-label") !== accessibleName) {
    root.setAttribute("aria-label", accessibleName);
  }
}

function updateLinkShell(
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
  column: ColumnDef | undefined,
): void {
  const label = getChild(root, "lfg-cell-shell-label");
  if (label && label.textContent !== text) label.textContent = text;

  const interactive =
    config.actionKey !== undefined || config.overlay !== undefined;
  if (interactive) {
    if (root.getAttribute("role") !== "link") {
      root.setAttribute("role", "link");
    }
    if (root.getAttribute("tabindex") !== "-1") {
      root.tabIndex = -1;
    }
    const accessibleName = resolveActionAccessibleName(text, config, column);
    if (root.getAttribute("aria-label") !== accessibleName) {
      root.setAttribute("aria-label", accessibleName);
    }
    return;
  }

  if (root.hasAttribute("role")) root.removeAttribute("role");
  if (root.hasAttribute("tabindex")) root.removeAttribute("tabindex");
  if (root.hasAttribute("aria-label")) root.removeAttribute("aria-label");
}

function updateRatingShell(
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
  ctx: ShellValueContext,
): void {
  const label = getChild(root, "lfg-cell-shell-label");
  if (label && label.textContent !== text) label.textContent = text;

  const icon = getChild(root, "lfg-cell-shell-icon");
  if (icon) {
    const iv = config.icon ?? "★";
    if (icon.textContent !== iv) icon.textContent = iv;
  }

  const rawVal = ctx.value;
  const numVal = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
  root.setAttribute("data-rating", isNaN(numVal) ? "0" : String(numVal));
}

function updateProgressShell(
  root: HTMLElement,
  text: string,
  ctx: ShellValueContext,
): void {
  const label = getChild(root, "lfg-cell-shell-label");
  if (label && label.textContent !== text) label.textContent = text;

  const rawVal = ctx.value;
  const numVal = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
  const clamped = isNaN(numVal) ? 0 : Math.max(0, Math.min(100, numVal));
  root.setAttribute("data-value", String(clamped));

  const ratio = String(clamped / 100);
  if (root.style.getPropertyValue("--lfg-cell-shell-progress-ratio") !== ratio) {
    root.style.setProperty("--lfg-cell-shell-progress-ratio", ratio);
  }
}

function getCheckboxInput(root: HTMLElement): HTMLInputElement | null {
  const inputs = root.getElementsByTagName("input");
  return inputs.length > 0 ? inputs[0]! : null;
}

function resolveCheckboxAccessibleName(
  config: CellShellConfig,
  ctx: ShellValueContext,
  column: ColumnDef,
  visibleLabel: string | undefined,
): string {
  const configured = config.checkbox?.ariaLabel;
  if (configured !== undefined) {
    const resolved = resolveShellValue(configured, ctx);
    if (resolved.trim().length > 0) {
      return composeAccessibleNameWithVisibleText(visibleLabel, resolved);
    }
  }

  const header = column.headerName ?? column.field;
  const defaultName = ctx.formattedValue.trim().length > 0
    ? `${header}, ${ctx.formattedValue}`
    : header;
  return composeAccessibleNameWithVisibleText(visibleLabel, defaultName);
}

function syncCheckboxLabel(
  root: HTMLElement,
  input: HTMLInputElement,
  visibleLabel: string | undefined,
): void {
  const existing = getChild(root, "lfg-cell-shell-checkbox-label");
  if (visibleLabel === undefined) {
    if (existing !== null) {
      root.insertBefore(input, existing);
      existing.remove();
    }
    return;
  }

  let label = existing;
  if (label === null) {
    label = document.createElement("label");
    label.className = "lfg-cell-shell-checkbox-label";
    const text = document.createElement("span");
    text.className = "lfg-cell-shell-checkbox-label-text";
    label.appendChild(input);
    label.appendChild(text);
    root.appendChild(label);
  }
  const text = getChild(label, "lfg-cell-shell-checkbox-label-text");
  if (text !== null && text.textContent !== visibleLabel) {
    text.textContent = visibleLabel;
  }
}

function updateCheckboxShell(
  root: HTMLElement,
  input: HTMLInputElement,
  config: CellShellConfig,
  ctx: ShellValueContext,
  params: CellShellBindParams,
): void {
  const valid = isBooleanCellValue(params.value);
  const labelSource = config.checkbox?.label;
  const visibleLabel =
    labelSource === undefined ? undefined : resolveShellValue(labelSource, ctx);
  const editable = isCellEditEligible(params);
  const checked = params.value === true;
  const disabled = !valid || !editable;
  const accessibleName = resolveCheckboxAccessibleName(
    config,
    ctx,
    params.column,
    visibleLabel,
  );
  if (input.checked !== checked) input.checked = checked;
  if (input.disabled !== disabled) input.disabled = disabled;
  if (input.tabIndex !== -1) input.tabIndex = -1;
  if (input.getAttribute("aria-label") !== accessibleName) {
    input.setAttribute("aria-label", accessibleName);
  }
  if (input.hasAttribute("aria-checked")) input.removeAttribute("aria-checked");
  syncCheckboxLabel(root, input, visibleLabel);
}

// Resolve + apply src/alt onto a shell's <img>. Hides and clears stale
// attributes when no src resolves, so a same-kind rebind from image → no
// image leaves nothing behind.
function applyShellImage(
  root: HTMLElement,
  config: CellShellConfig,
  ctx: ShellValueContext,
  text: string,
): void {
  const imgs = root.getElementsByTagName("img");
  const img = imgs.length > 0 ? imgs[0]! : null;
  if (!img) return;

  const src =
    config.image?.src !== undefined
      ? resolveShellValue(config.image.src, ctx)
      : "";

  if (src) {
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    const alt =
      config.image?.alt !== undefined
        ? resolveShellValue(config.image.alt, ctx)
        : text;
    if (img.getAttribute("alt") !== alt) img.setAttribute("alt", alt);
    img.hidden = false;
  } else {
    if (img.hasAttribute("src")) img.removeAttribute("src");
    if (img.hasAttribute("alt")) img.removeAttribute("alt");
    img.hidden = true;
  }
}

function updateImageShell(
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
  ctx: ShellValueContext,
): void {
  applyShellImage(root, config, ctx, text);
}

function updateImageTextShell(
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
  ctx: ShellValueContext,
): void {
  applyShellImage(root, config, ctx, text);
  const label = getChild(root, "lfg-cell-shell-label");
  if (label && label.textContent !== text) label.textContent = text;
}

function updateIconTextShell(
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
): void {
  const icon = getChild(root, "lfg-cell-shell-icon");
  if (icon) {
    const iv = config.icon ?? "";
    if (icon.textContent !== iv) icon.textContent = iv;
  }
  const label = getChild(root, "lfg-cell-shell-label");
  if (label && label.textContent !== text) label.textContent = text;
}

function updateShellRoot(
  kind: CellShellKind,
  root: HTMLElement,
  text: string,
  config: CellShellConfig,
  ctx: ShellValueContext,
  params?: CellShellBindParams,
  checkboxInput?: HTMLInputElement | null,
): void {
  switch (kind) {
    case "badge":
      updateBadgeShell(root, text, config, ctx);
      break;
    case "checkbox":
      if (
        params !== undefined &&
        checkboxInput !== null &&
        checkboxInput !== undefined
      ) {
        updateCheckboxShell(root, checkboxInput, config, ctx, params);
      }
      break;
    case "prefixSuffix":
      updatePrefixSuffixShell(root, text, config);
      break;
    case "button":
      updateButtonShell(root, text, config, params?.column);
      break;
    case "iconButton":
      updateIconButtonShell(root, text, config, params?.column);
      break;
    case "link":
      updateLinkShell(root, text, config, params?.column);
      break;
    case "rating":
      updateRatingShell(root, text, config, ctx);
      break;
    case "progress":
      updateProgressShell(root, text, ctx);
      break;
    case "image":
    case "avatar":
      updateImageShell(root, text, config, ctx);
      break;
    case "imageText":
    case "avatarText":
      updateImageTextShell(root, text, config, ctx);
      break;
    case "iconText":
      updateIconTextShell(root, text, config);
      break;
    case "buttonGroup":
      updateButtonGroupShell(root, text, config, ctx, params?.column);
      break;
    default:
      updateTextShell(root, text);
      break;
  }
}

function splitClassTokens(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const parts = raw.split(/\s+/);
  let tokens: string[] | undefined;
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i]!;
    if (t === "") continue;
    if (tokens === undefined) {
      tokens = [t];
    } else if (tokens.indexOf(t) === -1) {
      tokens.push(t);
    }
  }
  return tokens;
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function syncShellExtras(
  cell: PooledCell,
  root: HTMLElement,
  config: CellShellConfig,
  kind: CellShellKind,
): void {
  const oldTokens = cell.shellClassNames;
  const newTokens = splitClassTokens(config.className);

  if (!arraysEqual(oldTokens, newTokens)) {
    if (oldTokens) {
      for (let i = 0; i < oldTokens.length; i++) {
        if (!newTokens || newTokens.indexOf(oldTokens[i]!) === -1) {
          root.classList.remove(oldTokens[i]!);
        }
      }
    }
    if (newTokens) {
      for (let i = 0; i < newTokens.length; i++) {
        if (!oldTokens || oldTokens.indexOf(newTokens[i]!) === -1) {
          root.classList.add(newTokens[i]!);
        }
      }
    }
    cell.shellClassNames = newTokens;
  }

  const oldAction = cell.shellActionKey;
  const newAction = isActionShellKind(kind) ? config.actionKey : undefined;
  if (oldAction !== newAction) {
    if (newAction !== undefined) {
      root.setAttribute("data-action", newAction);
    } else {
      root.removeAttribute("data-action");
    }
    cell.shellActionKey = newAction;
  }

  const actionCapable = isActionShellKind(kind);
  const newOverlayKey = actionCapable ? config.overlay?.key : undefined;
  const newOverlayTrigger = newOverlayKey !== undefined
    ? (config.overlay?.trigger ?? "click")
    : undefined;
  const oldOverlayKey = root.getAttribute("data-overlay-key");
  const oldOverlayTrigger = root.getAttribute("data-overlay-trigger");
  if (
    (newOverlayKey ?? null) !== oldOverlayKey ||
    (newOverlayTrigger ?? null) !== oldOverlayTrigger
  ) {
    if (newOverlayKey !== undefined) {
      root.setAttribute("data-overlay-key", newOverlayKey);
      root.setAttribute("data-overlay-trigger", newOverlayTrigger!);
    } else {
      root.removeAttribute("data-overlay-key");
      root.removeAttribute("data-overlay-trigger");
    }
  }
}

function applyPreviewClassNames(root: HTMLElement, config: CellShellConfig): void {
  const tokens = splitClassTokens(config.className);
  if (!tokens) return;
  for (let i = 0; i < tokens.length; i++) root.classList.add(tokens[i]!);
}

// ── Public API ───────────────────────────────────────────────────────

export function createCellShellPreview(
  params: CellShellPreviewParams,
): HTMLElement | null {
  const config = normalizeCellShell(params.column.cellShell);
  if (!config) return null;

  if (!PREVIEW_SAFE_KINDS.has(config.kind)) return null;
  const kind = effectiveKind(config.kind);
  if (config.actionKey !== undefined || config.overlay !== undefined) return null;

  const ctx: ShellValueContext = {
    value: params.value,
    formattedValue: params.formattedValue,
    row: params.row,
  };
  const text = resolveShellValue(config.text, ctx);
  const root = createShellRoot(kind);
  root.classList.add("lfg-cell-shell-preview");

  updateShellRoot(kind, root, text, config, ctx);
  applyPreviewClassNames(root, config);

  return root;
}

export function bindCellShell(
  cell: PooledCell,
  params: CellShellBindParams,
  config: CellShellConfig,
): void {
  const kind = effectiveKind(config.kind);
  const ctx: ShellValueContext = {
    value: params.value,
    formattedValue: params.formattedValue,
    row: params.row,
  };
  const text = resolveShellValue(config.text, ctx);

  if (cell.shellKind === kind && cell.shellRoot) {
    const checkboxInput = kind === "checkbox"
      ? getCheckboxInput(cell.shellRoot)
      : null;
    updateShellRoot(
      kind,
      cell.shellRoot,
      text,
      config,
      ctx,
      params,
      checkboxInput,
    );
    syncShellExtras(cell, cell.shellRoot, config, kind);
    return;
  }

  // Kind changed or first mount — clear old shell and build new one.
  clearCellShell(cell);

  const root = createShellRoot(kind);
  cell.element.appendChild(root);
  cell.shellKind = kind;
  cell.shellRoot = root;

  const checkboxInput = kind === "checkbox"
    ? getCheckboxInput(root)
    : null;
  updateShellRoot(kind, root, text, config, ctx, params, checkboxInput);
  syncShellExtras(cell, root, config, kind);
}

export function clearCellShell(cell: PooledCell): void {
  if (cell.shellRoot) {
    cell.shellRoot.remove();
    cell.shellRoot = undefined;
  }
  cell.shellKind = undefined;
  cell.shellKey = undefined;
  cell.shellClassNames = undefined;
  cell.shellActionKey = undefined;
}
