import { useState } from "react";

import type { DemoGridGetter } from "../../runtime/types.ts";
import { preventToolbarFocusSteal } from "../../shell/preventToolbarFocusSteal.ts";
import { PanelInfoFooter } from "../../shell/ui/PanelInfoFooter.tsx";
import { PanelRadioRow } from "../../shell/ui/PanelRadioRow.tsx";
import { PanelToggleRow } from "../../shell/ui/PanelToggleRow.tsx";

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
import {
  IconExportCopy,
  IconExportDownload,
  IconExportGear,
  IconExportHeaders,
  IconExportRows,
} from "./exportPanelIcons.tsx";

type AdvancedExportPanelProps = {
  getGrid: DemoGridGetter;
  onClose: () => void;
  onCloseAdvanced: () => void;
  onStatus?: (message: string) => void;
};

/**
 * Right-side Advanced export flyout — customize scope/content/encoding/output.
 */
export function AdvancedExportPanel({
  getGrid,
  onClose,
  onCloseAdvanced,
  onStatus,
}: AdvancedExportPanelProps) {
  const [options, setOptions] = useState<AdvancedExportOptions>(
    DEFAULT_ADVANCED_EXPORT_OPTIONS,
  );
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const patch = (partial: Partial<AdvancedExportOptions>) => {
    setOptions((current) => ({ ...current, ...partial }));
  };

  const finish = () => {
    onCloseAdvanced();
    onClose();
  };

  const onDownload = () => {
    downloadAdvancedExportCsv(getGrid, options, () =>
      onStatus?.("CSV exported"),
    );
    finish();
  };

  const onCopy = () => {
    void copyAdvancedExportText(getGrid, options)
      .then((ok) => {
        if (!ok) {
          setCopyStatus("Grid is not ready.");
          return;
        }
        setCopyStatus("Copied to clipboard.");
        window.setTimeout(() => finish(), 350);
      })
      .catch(() => {
        setCopyStatus("Clipboard permission denied.");
      });
  };

  return (
    <div className="interactive-demo-export-advanced-panel">
      <div className="interactive-demo-export-advanced-header">
        <div className="interactive-demo-export-advanced-header-text">
          <strong className="interactive-demo-export-advanced-title">
            Advanced export
          </strong>
          <p className="interactive-demo-export-advanced-subtitle">
            Customize what and how your data is exported.
          </p>
        </div>
        <button
          type="button"
          className="interactive-demo-panel-heading-close"
          aria-label="Close advanced export"
          onMouseDown={preventToolbarFocusSteal}
          onClick={onCloseAdvanced}
        >
          ×
        </button>
      </div>

      <div className="interactive-demo-export-advanced-grid">
        <section className="interactive-demo-export-section">
          <h3 className="interactive-demo-export-section-title">Scope</h3>
          <div
            className="interactive-demo-density-list"
            role="radiogroup"
            aria-label="Export scope"
          >
            {ADVANCED_EXPORT_SCOPE_OPTIONS.map((option) => (
              <PanelRadioRow
                key={option.value}
                title={option.label}
                description={option.description}
                badge={
                  option.value === "visibleColumns" ? "Recommended" : undefined
                }
                selected={options.scope === option.value}
                onSelect={() =>
                  patch({ scope: option.value as AdvancedExportScope })
                }
              />
            ))}
          </div>
        </section>

        <section className="interactive-demo-export-section">
          <h3 className="interactive-demo-export-section-title">
            Content toggles
          </h3>
          <div className="interactive-demo-export-toggles">
            <PanelToggleRow
              icon={<IconExportHeaders />}
              label="Include column headers"
              checked={options.includeColumnHeaders}
              onChange={(includeColumnHeaders) =>
                patch({ includeColumnHeaders })
              }
            />
            <PanelToggleRow
              icon={<IconExportRows />}
              label="Include row numbers"
              description="Include the ID column."
              checked={options.includeRowNumbers}
              onChange={(includeRowNumbers) => patch({ includeRowNumbers })}
            />
            <PanelToggleRow
              icon={<IconExportGear />}
              label="Include utility / action columns"
              description="This demo has Actions."
              checked={options.includeUtilityColumns}
              onChange={(includeUtilityColumns) =>
                patch({ includeUtilityColumns })
              }
            />
            <PanelToggleRow
              icon={<IconExportGear />}
              label="Use formatted values"
              description="Currency, dates, etc."
              checked={options.useValueFormatter}
              onChange={(useValueFormatter) => patch({ useValueFormatter })}
            />
          </div>
        </section>

        <section className="interactive-demo-export-section">
          <h3 className="interactive-demo-export-section-title">Encoding</h3>
          <div className="interactive-demo-export-field">
            <span className="interactive-demo-export-field-label">Delimiter</span>
            <div
              className="interactive-demo-export-segmented"
              role="group"
              aria-label="CSV delimiter"
            >
              {ADVANCED_EXPORT_DELIMITER_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`interactive-demo-export-segment${
                    options.delimiter === option.value ? " is-selected" : ""
                  }`}
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={() =>
                    patch({ delimiter: option.value as AdvancedExportDelimiter })
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <PanelToggleRow
            label="UTF-8 BOM"
            description="Excel-friendly."
            checked={options.utf8Bom}
            onChange={(utf8Bom) => patch({ utf8Bom })}
          />

          <label className="interactive-demo-export-field">
            <span className="interactive-demo-export-field-label">
              Line ending
            </span>
            <select
              className="interactive-demo-export-select"
              value={options.lineEnding}
              onChange={(event) =>
                patch({
                  lineEnding: event.target.value as AdvancedExportOptions["lineEnding"],
                })
              }
            >
              {ADVANCED_EXPORT_LINE_ENDING_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="interactive-demo-export-section">
          <h3 className="interactive-demo-export-section-title">Output</h3>
          <div
            className="interactive-demo-density-list"
            role="radiogroup"
            aria-label="Export output"
          >
            <PanelRadioRow
              title="Download CSV"
              description="Save as a .csv file."
              selected={options.output === "download"}
              onSelect={() => patch({ output: "download" })}
            />
            <PanelRadioRow
              title="Copy as text"
              description="Copy to clipboard as plain text."
              selected={options.output === "copy"}
              onSelect={() => patch({ output: "copy" })}
            />
          </div>
        </section>
      </div>

      <div className="interactive-demo-export-advanced-footer">
        <label className="interactive-demo-export-field interactive-demo-export-filename">
          <span className="interactive-demo-export-field-label">File name</span>
          <input
            className="interactive-demo-export-input"
            value={options.fileName}
            onChange={(event) => patch({ fileName: event.target.value })}
            spellCheck={false}
          />
        </label>
        <PanelInfoFooter>
          Advanced export applies the selected scope and content options to
          generate your file.
        </PanelInfoFooter>
      </div>

      {copyStatus ? (
        <p className="interactive-demo-export-status" role="status">
          {copyStatus}
        </p>
      ) : null}

      <div className="interactive-demo-export-advanced-actions">
        <button
          type="button"
          className={`interactive-demo-export-cta${
            options.output === "copy" ? " is-primary" : ""
          }`}
          onMouseDown={preventToolbarFocusSteal}
          onClick={onCopy}
        >
          <IconExportCopy />
          <span className="interactive-demo-export-cta-text">
            <span className="interactive-demo-export-cta-title">Copy as text</span>
            <span className="interactive-demo-export-cta-desc">
              Copies to clipboard
            </span>
          </span>
        </button>
        <button
          type="button"
          className={`interactive-demo-export-cta${
            options.output === "download" ? " is-primary" : ""
          }`}
          onMouseDown={preventToolbarFocusSteal}
          onClick={onDownload}
        >
          <IconExportDownload />
          <span className="interactive-demo-export-cta-text">
            <span className="interactive-demo-export-cta-title">Download CSV</span>
            <span className="interactive-demo-export-cta-desc">Primary action</span>
          </span>
        </button>
      </div>
    </div>
  );
}
