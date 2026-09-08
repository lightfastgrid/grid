import type { Page } from "@playwright/test";

export type PageIssue = {
  readonly kind: "page-error" | "unhandled-rejection" | "console-error";
  readonly message: string;
};

export type PageGuards = {
  drain(): Promise<PageIssue[]>;
  detach(): void;
};

declare global {
  interface Window {
    __LFG_BENCH_UNHANDLED_REJECTIONS__?: string[];
  }
}

export async function attachPageGuards(page: Page): Promise<PageGuards> {
  await page.addInitScript(() => {
    window.__LFG_BENCH_UNHANDLED_REJECTIONS__ = [];
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason as { message?: unknown } | string | undefined;
      const message =
        reason && typeof reason === "object" && "message" in reason
          ? String(reason.message)
          : String(reason ?? "unhandled rejection");
      window.__LFG_BENCH_UNHANDLED_REJECTIONS__ = window.__LFG_BENCH_UNHANDLED_REJECTIONS__ ?? [];
      window.__LFG_BENCH_UNHANDLED_REJECTIONS__.push(message);
    });
  });

  const issues: PageIssue[] = [];
  const onPageError = (error: Error) => {
    issues.push({ kind: "page-error", message: error.message });
  };
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === "error") {
      issues.push({ kind: "console-error", message: message.text() });
    }
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  return {
    async drain() {
      const rejections = await page.evaluate(() => {
        const list = window.__LFG_BENCH_UNHANDLED_REJECTIONS__ ?? [];
        window.__LFG_BENCH_UNHANDLED_REJECTIONS__ = [];
        return list;
      });
      const copy: PageIssue[] = [
        ...issues,
        ...rejections.map((message) => ({
          kind: "unhandled-rejection" as const,
          message,
        })),
      ];
      issues.length = 0;
      return copy;
    },
    detach() {
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
    },
  };
}
