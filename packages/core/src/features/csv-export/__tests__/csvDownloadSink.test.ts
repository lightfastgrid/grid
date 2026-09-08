import { describe, expect, it } from "vitest";

import {
  createBrowserDownloadEnvironment,
  type CsvDownloadEnvironment,
  CsvDownloadSink,
} from "../csvDownloadSink";
import { CsvExportSinkError } from "../csvExportErrors";

interface FakeCalls {
  createObjectURL: number;
  revokeObjectURL: number;
  revokedUrls: string[];
  anchors: number;
  clicks: number;
  removes: number;
  hrefs: string[];
  downloads: string[];
}

function makeFakeEnv(
  overrides: {
    createObjectURL?: () => string;
    click?: () => void;
    remove?: () => void;
    revokeObjectURL?: () => void;
  } = {},
): { env: CsvDownloadEnvironment; calls: FakeCalls } {
  const calls: FakeCalls = {
    createObjectURL: 0,
    revokeObjectURL: 0,
    revokedUrls: [],
    anchors: 0,
    clicks: 0,
    removes: 0,
    hrefs: [],
    downloads: [],
  };
  const env: CsvDownloadEnvironment = {
    createObjectURL: () => {
      calls.createObjectURL++;
      if (overrides.createObjectURL) return overrides.createObjectURL();
      return "blob:fake-url";
    },
    revokeObjectURL: (url) => {
      calls.revokeObjectURL++;
      calls.revokedUrls.push(url);
      overrides.revokeObjectURL?.();
    },
    createAnchor: () => {
      calls.anchors++;
      return {
        setHref: (url) => calls.hrefs.push(url),
        setDownload: (fileName) => calls.downloads.push(fileName),
        click: () => {
          calls.clicks++;
          overrides.click?.();
        },
        remove: () => {
          calls.removes++;
          overrides.remove?.();
        },
      };
    },
  };
  return { env, calls };
}

describe("CsvDownloadSink - download (test 53)", () => {
  it("creates/clicks/removes one anchor and revokes one URL", () => {
    const { env, calls } = makeFakeEnv();
    const sink = new CsvDownloadSink(env, "orders.csv");
    void sink.write(new Uint8Array([0x61]));
    const result = sink.close();

    expect(calls.createObjectURL).toBe(1);
    expect(calls.anchors).toBe(1);
    expect(calls.clicks).toBe(1);
    expect(calls.removes).toBe(1);
    expect(calls.revokeObjectURL).toBe(1);
    expect(calls.revokedUrls).toEqual(["blob:fake-url"]);
    expect(calls.hrefs).toEqual(["blob:fake-url"]);
    expect(calls.downloads).toEqual(["orders.csv"]);
    expect(result).toMatchObject({ outputType: "download", fileName: "orders.csv" });
  });

  it("cleans up (removes anchor, revokes URL) when click fails", () => {
    const cause = new Error("click boom");
    const { env, calls } = makeFakeEnv({
      click: () => {
        throw cause;
      },
    });
    const sink = new CsvDownloadSink(env, "x.csv");
    void sink.write(new Uint8Array([1]));
    try {
      void sink.close();
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CsvExportSinkError);
      if (error instanceof CsvExportSinkError) expect(error.cause).toBe(cause);
    }
    expect(calls.removes).toBe(1);
    expect(calls.revokeObjectURL).toBe(1);
  });

  it("does not create an anchor or revoke when URL creation fails", () => {
    const cause = new Error("url boom");
    const { env, calls } = makeFakeEnv({
      createObjectURL: () => {
        throw cause;
      },
    });
    const sink = new CsvDownloadSink(env, "x.csv");
    void sink.write(new Uint8Array([1]));
    expect(() => sink.close()).toThrow(CsvExportSinkError);
    expect(calls.anchors).toBe(0);
    expect(calls.removes).toBe(0);
    expect(calls.revokeObjectURL).toBe(0);
  });

  it("aborting drops retained chunks and blocks close", () => {
    const { env } = makeFakeEnv();
    const sink = new CsvDownloadSink(env, "x.csv");
    void sink.write(new Uint8Array([1]));
    void sink.abort("stop");
    expect(() => sink.close()).toThrow(CsvExportSinkError);
  });

  it("keeps a reentrant click cancellation authoritative and still cleans up", () => {
    const reason = new Error("cancel from download click");
    const sinkOwner: { sink: CsvDownloadSink | null } = { sink: null };
    const { env, calls } = makeFakeEnv({
      click: () => {
        void sinkOwner.sink?.abort(reason);
      },
    });
    const sink = new CsvDownloadSink(env, "cancelled.csv");
    sinkOwner.sink = sink;
    void sink.write(new Uint8Array([1]));

    let closeError: unknown;
    try {
      void sink.close();
    } catch (error) {
      closeError = error;
    }

    expect(closeError).toBeInstanceOf(CsvExportSinkError);
    if (closeError instanceof CsvExportSinkError) {
      expect(closeError.cause).toBe(reason);
    }
    expect(calls.clicks).toBe(1);
    expect(calls.removes).toBe(1);
    expect(calls.revokeObjectURL).toBe(1);
    let repeatedCloseError: unknown;
    try {
      void sink.close();
    } catch (error) {
      repeatedCloseError = error;
    }
    expect(repeatedCloseError).toBe(closeError);
    expect(calls.clicks).toBe(1);
    expect(calls.removes).toBe(1);
    expect(calls.revokeObjectURL).toBe(1);
  });
});

describe("CsvDownloadSink - cleanup precedence", () => {
  it("still revokes the URL when anchor removal fails", () => {
    const { env, calls } = makeFakeEnv({
      remove: () => {
        throw new Error("remove boom");
      },
    });
    const sink = new CsvDownloadSink(env, "x.csv");
    void sink.write(new Uint8Array([1]));
    expect(() => sink.close()).toThrow(CsvExportSinkError);
    expect(calls.removes).toBe(1);
    expect(calls.revokeObjectURL).toBe(1); // revoke still runs
  });

  it("wraps a revoke failure as a sink error", () => {
    const cause = new Error("revoke boom");
    const { env } = makeFakeEnv({
      revokeObjectURL: () => {
        throw cause;
      },
    });
    const sink = new CsvDownloadSink(env, "x.csv");
    void sink.write(new Uint8Array([1]));
    try {
      void sink.close();
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CsvExportSinkError);
      if (error instanceof CsvExportSinkError) expect(error.cause).toBe(cause);
    }
  });

  it("keeps the click failure primary when cleanup also fails", () => {
    const clickCause = new Error("click boom");
    const { env } = makeFakeEnv({
      click: () => {
        throw clickCause;
      },
      remove: () => {
        throw new Error("remove boom");
      },
    });
    const sink = new CsvDownloadSink(env, "x.csv");
    void sink.write(new Uint8Array([1]));
    try {
      void sink.close();
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CsvExportSinkError);
      if (error instanceof CsvExportSinkError) expect(error.cause).toBe(clickCause);
    }
  });

  it("performs no duplicate browser side effects on repeated close after failure", () => {
    const { env, calls } = makeFakeEnv({
      click: () => {
        throw new Error("click boom");
      },
    });
    const sink = new CsvDownloadSink(env, "x.csv");
    void sink.write(new Uint8Array([1]));
    expect(() => sink.close()).toThrow(CsvExportSinkError);
    expect(() => sink.close()).toThrow(CsvExportSinkError); // reproduces failure
    expect(calls.clicks).toBe(1);
    expect(calls.removes).toBe(1);
    expect(calls.revokeObjectURL).toBe(1);
  });
});

describe("createBrowserDownloadEnvironment - capability", () => {
  it("throws CsvExportSinkError when no browser capability is present", () => {
    expect(() => createBrowserDownloadEnvironment()).toThrow(CsvExportSinkError);
  });
});
