/**
 * CSV Export V1 - browser download sink (Stage 3A).
 *
 * Accumulates byte chunks (like the blob sink), then on close creates exactly
 * one Blob, one object URL, and one temporary anchor, clicks it once, removes
 * it, and revokes the URL exactly once. All cleanup runs through `finally`, on
 * success or failure. Browser globals sit behind a small injectable
 * {@link CsvDownloadEnvironment} so tests need no real browser navigation.
 *
 * This is the only sink permitted to touch the DOM, and it does so only through
 * the environment adapter (no `querySelector`, no renderer imports, no layout
 * reads). The final click runs inside Stage 3B's user-visible continuation; the
 * sink adds no scheduler of its own.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 21 (Download), 23.
 */

import { CSV_BLOB_MIME_TYPE } from "./csvBlobSink";
import { CsvExportSinkError } from "./csvExportErrors";
import { AbstractCsvSink, type CsvByteChunk, type CsvSinkResult } from "./csvOutputSink";

/** A temporary anchor used for a single download click. */
export interface CsvDownloadAnchor {
  setHref(url: string): void;
  setDownload(fileName: string): void;
  click(): void;
  remove(): void;
}

/** Injectable browser capability surface for the download sink. */
export interface CsvDownloadEnvironment {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): CsvDownloadAnchor;
}

/**
 * Build the default browser environment. Throws {@link CsvExportSinkError} when
 * the required browser capabilities are missing (e.g. non-DOM runtime).
 */
export function createBrowserDownloadEnvironment(): CsvDownloadEnvironment {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function"
  ) {
    throw new CsvExportSinkError(
      "CSV download requires a browser environment (document + URL object URLs)",
    );
  }
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => {
      const anchor = document.createElement("a");
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      return {
        setHref: (url) => {
          anchor.href = url;
        },
        setDownload: (fileName) => {
          anchor.download = fileName;
        },
        click: () => anchor.click(),
        remove: () => anchor.remove(),
      };
    },
  };
}

export class CsvDownloadSink extends AbstractCsvSink {
  private chunks: CsvByteChunk[] = [];
  private byteLength = 0;

  constructor(
    private readonly environment: CsvDownloadEnvironment,
    private readonly fileName: string,
  ) {
    super();
  }

  protected handleWrite(chunk: CsvByteChunk): void {
    this.chunks.push(chunk);
    this.byteLength += chunk.byteLength;
  }

  protected handleClose(): CsvSinkResult {
    let blob: Blob;
    try {
      blob = new Blob(this.chunks, { type: CSV_BLOB_MIME_TYPE });
    } catch (cause) {
      this.chunks = []; // release retained chunks on every outcome
      throw new CsvExportSinkError("CSV download blob construction failed", {
        cause,
      });
    }
    this.chunks = [];

    let url: string | null = null;
    let anchor: CsvDownloadAnchor | null = null;
    let primaryError: unknown = null;

    // Primary operations. The first failure is the primary error; wrap each.
    try {
      const acquiredUrl = wrapDownloadOp("createObjectURL", () =>
        this.environment.createObjectURL(blob),
      );
      url = acquiredUrl;
      const acquiredAnchor = wrapDownloadOp("createAnchor", () =>
        this.environment.createAnchor(),
      );
      anchor = acquiredAnchor;
      wrapDownloadOp("setHref", () => acquiredAnchor.setHref(acquiredUrl));
      wrapDownloadOp("setDownload", () =>
        acquiredAnchor.setDownload(this.fileName),
      );
      wrapDownloadOp("click", () => acquiredAnchor.click());
    } catch (error) {
      primaryError = error;
    }

    // Cleanup: remove the acquired anchor once, then revoke the acquired URL
    // once. Cleanup runs regardless (revoke still runs if remove fails) and a
    // cleanup failure never replaces an earlier primary failure.
    if (anchor !== null) {
      try {
        anchor.remove();
      } catch (cause) {
        if (primaryError === null) {
          primaryError = new CsvExportSinkError(
            "CSV download anchor removal failed",
            { cause },
          );
        }
      }
    }
    if (url !== null) {
      try {
        this.environment.revokeObjectURL(url);
      } catch (cause) {
        if (primaryError === null) {
          primaryError = new CsvExportSinkError(
            "CSV download URL revoke failed",
            { cause },
          );
        }
      }
    }

    if (primaryError !== null) throw primaryError;

    return {
      outputType: "download",
      byteLength: this.byteLength,
      fileName: this.fileName,
    };
  }

  protected handleAbort(): void {
    this.chunks = [];
  }
}

function wrapDownloadOp<T>(op: string, run: () => T): T {
  try {
    return run();
  } catch (cause) {
    throw new CsvExportSinkError(`CSV download ${op} failed`, { cause });
  }
}
