import type { DemoGridGetter } from "../../runtime/types.ts";
import { el } from "../../shell/dom.ts";
import { preventToolbarFocusSteal } from "../../shell/preventToolbarFocusSteal.ts";
import { bindFocusStealGuard } from "../../shell/ToolbarIcons.ts";
import {
  mountPanelInfoFooter,
  mountPanelRadioRow,
  mountPanelToggleRow,
} from "../../shell/ui/panelPrimitives.ts";

import {
  ADVANCED_EXPORT_DELIMITER_OPTIONS,
  ADVANCED_EXPORT_LINE_ENDING_OPTIONS,
  ADVANCED_EXPORT_SCOPE_OPTIONS,
  type AdvancedExportDelimiter,
  type AdvancedExportOptions,
  type AdvancedExportScope,
  DEFAULT_ADVANCED_EXPORT_OPTIONS,
} from "./advancedExportModel.ts";
import {
  copyAdvancedExportText,
  downloadAdvancedExportCsv,
} from "./exportDemoCsv.ts";

type AdvancedExportPanelProps = {
  getGrid: DemoGridGetter;
  onClose: () => void;
  onCloseAdvanced: () => void;
  onStatus?: (message: string) => void;
};

/**
 * Right-side Advanced export flyout — customize scope/content/encoding/output.
 * Vanilla DOM port of React AdvancedExportPanel.tsx.
 */
export function mountAdvancedExportPanel(
  host: HTMLElement,
  props: AdvancedExportPanelProps,
): () => void {
  const { getGrid, onClose, onCloseAdvanced, onStatus } = props;
  const cleanups: (() => void)[] = [];
  let options: AdvancedExportOptions = {
    ...DEFAULT_ADVANCED_EXPORT_OPTIONS,
  };

  const root = el("div", "interactive-demo-export-advanced-panel");

  // --- Header ---
  const header = el("div", "interactive-demo-export-advanced-header");
  const headerText = el("div", "interactive-demo-export-advanced-header-text");
  const title = el(
    "strong",
    "interactive-demo-export-advanced-title",
    "Advanced export",
  );
  const subtitle = el(
    "p",
    "interactive-demo-export-advanced-subtitle",
    "Customize what and how your data is exported.",
  );
  headerText.append(title, subtitle);
  const closeBtn = el(
    "button",
    "interactive-demo-panel-heading-close",
    "×",
  );
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close advanced export");
  closeBtn.addEventListener("mousedown", preventToolbarFocusSteal);
  const onCloseAdv = () => onCloseAdvanced();
  closeBtn.addEventListener("click", onCloseAdv);
  cleanups.push(
    () => closeBtn.removeEventListener("mousedown", preventToolbarFocusSteal),
    () => closeBtn.removeEventListener("click", onCloseAdv),
  );
  header.append(headerText, closeBtn);
  root.append(header);

  // --- Grid layout ---
  const grid = el("div", "interactive-demo-export-advanced-grid");

  // -- Scope section --
  const scopeSection = el("section", "interactive-demo-export-section");
  scopeSection.append(
    el("h3", "interactive-demo-export-section-title", "Scope"),
  );
  const scopeRadioGroup = el("div", "interactive-demo-density-list");
  scopeRadioGroup.setAttribute("role", "radiogroup");
  scopeRadioGroup.setAttribute("aria-label", "Export scope");
  for (const opt of ADVANCED_EXPORT_SCOPE_OPTIONS) {
    cleanups.push(
      mountPanelRadioRow(scopeRadioGroup, {
        name: "advanced-export-scope",
        value: opt.value,
        label: opt.label,
        description: opt.description,
        checked: options.scope === opt.value,
        onSelect: (value) => {
          options = { ...options, scope: value as AdvancedExportScope };
          rerender();
        },
      }),
    );
  }
  scopeSection.append(scopeRadioGroup);
  grid.append(scopeSection);

  // -- Content toggles section --
  const contentSection = el("section", "interactive-demo-export-section");
  contentSection.append(
    el("h3", "interactive-demo-export-section-title", "Content toggles"),
  );
  const togglesContainer = el("div", "interactive-demo-export-toggles");

  function renderToggles() {
    togglesContainer.innerHTML = "";
    mountPanelToggleRow(togglesContainer, {
      label: "Include column headers",
      checked: options.includeColumnHeaders,
      onChange: (v) => {
        options = { ...options, includeColumnHeaders: v };
      },
    });
    mountPanelToggleRow(togglesContainer, {
      label: "Include row numbers",
      checked: options.includeRowNumbers,
      onChange: (v) => {
        options = { ...options, includeRowNumbers: v };
      },
    });
    mountPanelToggleRow(togglesContainer, {
      label: "Include utility / action columns",
      checked: options.includeUtilityColumns,
      onChange: (v) => {
        options = { ...options, includeUtilityColumns: v };
      },
    });
    mountPanelToggleRow(togglesContainer, {
      label: "Use formatted values",
      checked: options.useValueFormatter,
      onChange: (v) => {
        options = { ...options, useValueFormatter: v };
      },
    });
  }
  renderToggles();
  contentSection.append(togglesContainer);
  grid.append(contentSection);

  // -- Encoding section --
  const encodingSection = el("section", "interactive-demo-export-section");
  encodingSection.append(
    el("h3", "interactive-demo-export-section-title", "Encoding"),
  );

  // Delimiter segmented control
  const delimiterField = el("div", "interactive-demo-export-field");
  delimiterField.append(
    el("span", "interactive-demo-export-field-label", "Delimiter"),
  );
  const delimiterGroup = el("div", "interactive-demo-export-segmented");
  delimiterGroup.setAttribute("role", "group");
  delimiterGroup.setAttribute("aria-label", "CSV delimiter");

  function renderDelimiterButtons() {
    delimiterGroup.innerHTML = "";
    for (const opt of ADVANCED_EXPORT_DELIMITER_OPTIONS) {
      const btn = el("button", "interactive-demo-export-segment", opt.label);
      btn.type = "button";
      if (options.delimiter === opt.value) btn.classList.add("is-selected");
      btn.addEventListener("mousedown", preventToolbarFocusSteal);
      const onClick = () => {
        options = {
          ...options,
          delimiter: opt.value as AdvancedExportDelimiter,
        };
        renderDelimiterButtons();
      };
      btn.addEventListener("click", onClick);
      cleanups.push(
        () => btn.removeEventListener("mousedown", preventToolbarFocusSteal),
        () => btn.removeEventListener("click", onClick),
      );
      delimiterGroup.append(btn);
    }
  }
  renderDelimiterButtons();
  delimiterField.append(delimiterGroup);
  encodingSection.append(delimiterField);

  // UTF-8 BOM toggle
  mountPanelToggleRow(encodingSection, {
    label: "UTF-8 BOM",
    checked: options.utf8Bom,
    onChange: (v) => {
      options = { ...options, utf8Bom: v };
    },
  });

  // Line ending select
  const lineEndingLabel = el("label", "interactive-demo-export-field");
  lineEndingLabel.append(
    el("span", "interactive-demo-export-field-label", "Line ending"),
  );
  const lineEndingSelect = el("select", "interactive-demo-export-select");
  for (const opt of ADVANCED_EXPORT_LINE_ENDING_OPTIONS) {
    const optEl = el("option", undefined, opt.label);
    optEl.value = opt.value;
    if (opt.value === options.lineEnding) optEl.selected = true;
    lineEndingSelect.append(optEl);
  }
  const unguardLE = bindFocusStealGuard(lineEndingSelect);
  cleanups.push(unguardLE);
  const onLineEndingChange = () => {
    options = {
      ...options,
      lineEnding: lineEndingSelect.value as AdvancedExportOptions["lineEnding"],
    };
  };
  lineEndingSelect.addEventListener("change", onLineEndingChange);
  cleanups.push(() =>
    lineEndingSelect.removeEventListener("change", onLineEndingChange),
  );
  lineEndingLabel.append(lineEndingSelect);
  encodingSection.append(lineEndingLabel);
  grid.append(encodingSection);

  // -- Output section --
  const outputSection = el("section", "interactive-demo-export-section");
  outputSection.append(
    el("h3", "interactive-demo-export-section-title", "Output"),
  );
  const outputRadioGroup = el("div", "interactive-demo-density-list");
  outputRadioGroup.setAttribute("role", "radiogroup");
  outputRadioGroup.setAttribute("aria-label", "Export output");

  function renderOutputRadios() {
    outputRadioGroup.innerHTML = "";
    mountPanelRadioRow(outputRadioGroup, {
      name: "advanced-export-output",
      value: "download",
      label: "Download CSV",
      description: "Save as a .csv file.",
      checked: options.output === "download",
      onSelect: () => {
        options = { ...options, output: "download" };
        renderOutputRadios();
        renderActions();
      },
    });
    mountPanelRadioRow(outputRadioGroup, {
      name: "advanced-export-output",
      value: "copy",
      label: "Copy as text",
      description: "Copy to clipboard as plain text.",
      checked: options.output === "copy",
      onSelect: () => {
        options = { ...options, output: "copy" };
        renderOutputRadios();
        renderActions();
      },
    });
  }
  renderOutputRadios();
  outputSection.append(outputRadioGroup);
  grid.append(outputSection);
  root.append(grid);

  // --- Footer ---
  const footer = el("div", "interactive-demo-export-advanced-footer");
  const fileNameLabel = el(
    "label",
    "interactive-demo-export-field interactive-demo-export-filename",
  );
  fileNameLabel.append(
    el("span", "interactive-demo-export-field-label", "File name"),
  );
  const fileNameInput = el("input", "interactive-demo-export-input");
  fileNameInput.value = options.fileName;
  fileNameInput.spellcheck = false;
  const unguardFN = bindFocusStealGuard(fileNameInput);
  cleanups.push(unguardFN);
  const onFileNameInput = () => {
    options = { ...options, fileName: fileNameInput.value };
  };
  fileNameInput.addEventListener("input", onFileNameInput);
  cleanups.push(() =>
    fileNameInput.removeEventListener("input", onFileNameInput),
  );
  fileNameLabel.append(fileNameInput);
  footer.append(fileNameLabel);
  mountPanelInfoFooter(
    footer,
    "Advanced export applies the selected scope and content options to generate your file.",
  );
  root.append(footer);

  // --- Status ---
  const statusEl = el("p", "interactive-demo-export-status");
  statusEl.setAttribute("role", "status");
  statusEl.style.display = "none";
  root.append(statusEl);

  // --- Actions ---
  const actionsContainer = el(
    "div",
    "interactive-demo-export-advanced-actions",
  );

  function finish() {
    onCloseAdvanced();
    onClose();
  }

  function renderActions() {
    actionsContainer.innerHTML = "";

    const copyBtn = el("button", "interactive-demo-export-cta");
    copyBtn.type = "button";
    if (options.output === "copy") copyBtn.classList.add("is-primary");
    copyBtn.addEventListener("mousedown", preventToolbarFocusSteal);
    const copyText = el("span", "interactive-demo-export-cta-text");
    copyText.append(
      el("span", "interactive-demo-export-cta-title", "Copy as text"),
      el(
        "span",
        "interactive-demo-export-cta-desc",
        "Copies to clipboard",
      ),
    );
    copyBtn.append(copyText);
    const onCopy = () => {
      void copyAdvancedExportText(getGrid, options)
        .then((ok) => {
          if (!ok) {
            statusEl.textContent = "Grid is not ready.";
            statusEl.style.display = "";
            return;
          }
          statusEl.textContent = "Copied to clipboard.";
          statusEl.style.display = "";
          window.setTimeout(() => finish(), 350);
        })
        .catch(() => {
          statusEl.textContent = "Clipboard permission denied.";
          statusEl.style.display = "";
        });
    };
    copyBtn.addEventListener("click", onCopy);
    cleanups.push(
      () =>
        copyBtn.removeEventListener("mousedown", preventToolbarFocusSteal),
      () => copyBtn.removeEventListener("click", onCopy),
    );
    actionsContainer.append(copyBtn);

    const downloadBtn = el("button", "interactive-demo-export-cta");
    downloadBtn.type = "button";
    if (options.output === "download") downloadBtn.classList.add("is-primary");
    downloadBtn.addEventListener("mousedown", preventToolbarFocusSteal);
    const dlText = el("span", "interactive-demo-export-cta-text");
    dlText.append(
      el("span", "interactive-demo-export-cta-title", "Download CSV"),
      el(
        "span",
        "interactive-demo-export-cta-desc",
        "Primary action",
      ),
    );
    downloadBtn.append(dlText);
    const onDownload = () => {
      downloadAdvancedExportCsv(getGrid, options, () =>
        onStatus?.("CSV exported"),
      );
      finish();
    };
    downloadBtn.addEventListener("click", onDownload);
    cleanups.push(
      () =>
        downloadBtn.removeEventListener(
          "mousedown",
          preventToolbarFocusSteal,
        ),
      () => downloadBtn.removeEventListener("click", onDownload),
    );
    actionsContainer.append(downloadBtn);
  }
  renderActions();
  root.append(actionsContainer);

  function rerender() {
    renderDelimiterButtons();
    renderToggles();
    renderOutputRadios();
    renderActions();
  }

  host.append(root);

  return () => {
    for (const fn of cleanups) fn();
    root.remove();
  };
}
