import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { join, dirname } from "node:path";

import { appDir, appDistDir } from "../../../scripts/lib/paths.mjs";
import {
  SIGKILL_CANNOT_BE_HANDLED,
  appendBounded,
  isPidAlive,
  ownedProcessCount,
  stopAllOwnedProcesses,
  stopOwnedProcess,
  trackChildProcess,
  type OwnedProcess,
} from "./ownedProcess.ts";

export {
  SIGKILL_CANNOT_BE_HANDLED,
  isPidAlive,
  ownedProcessCount,
  stopAllOwnedProcesses,
};

export type PreviewServer = {
  readonly appId: string;
  readonly origin: string;
  readonly pid: number;
  readonly port: number;
  stop(): Promise<void>;
};

export function resolveViteCli(appId: string): string {
  const require = createRequire(join(appDir(appId), "package.json"));
  const vitePackageJson = require.resolve("vite/package.json");
  const viteCli = join(dirname(vitePackageJson), "bin/vite.js");
  if (!existsSync(viteCli)) {
    throw new Error(`Vite CLI not found at ${viteCli}`);
  }
  return viteCli;
}

export function isBenchmarkRuntimePreviewCommand(command: string): boolean {
  if (!command.includes("preview") || !command.includes("dist/runtime")) return false;
  if (command.includes("pnpm exec")) return true;
  return /vite(\.js)?\b/.test(command) && command.includes("--strictPort");
}

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
    server.on("error", reject);
  });
}

export function portAcceptsConnections(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

function formatExit(exit: { code: number | null; signal: NodeJS.Signals | null } | null): string {
  if (!exit) return "still running";
  if (exit.signal) return `signal ${exit.signal}`;
  return `exit code ${exit.code ?? "null"}`;
}

async function waitUntilReady(
  origin: string,
  handle: OwnedProcess,
  stderr: { text: string },
): Promise<void> {
  const url = `${origin}/`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (handle.exitResult || !isPidAlive(handle.pid)) {
      const exit =
        handle.exitResult ??
        (await Promise.race([
          handle.exit,
          new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            const timer = setTimeout(() => resolve({ code: null, signal: null }), 250);
            timer.unref?.();
          }),
        ]));
      throw new Error(
        `${handle.label} exited before HTTP readiness (${formatExit(exit)})${stderr.text ? `\n${stderr.text}` : ""}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = new Error(`${url} -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function throwPreviewStartFailure(
  appId: string,
  readinessError: unknown,
  cleanupError: unknown,
  stderr: string,
): never {
  const extra = stderr ? `\n${stderr}` : "";
  const readiness =
    readinessError instanceof Error ? readinessError : new Error(String(readinessError));
  const startup = new Error(`${appId} runtime preview failed: ${readiness.message}${extra}`, {
    cause: readinessError,
  });
  if (cleanupError == null) {
    throw startup;
  }
  const cleanup = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
  throw new AggregateError(
    [startup, cleanup],
    `${startup.message}; also failed to stop owned preview process: ${cleanup.message}`,
  );
}

export async function startRuntimePreview(
  appId: string,
  options?: {
    readonly port?: number;
    readonly stopOwnedProcess?: (handle: OwnedProcess) => Promise<void>;
  },
): Promise<PreviewServer> {
  const distDir = appDistDir(appId, "runtime");
  const htmlPath = join(distDir, "index.html");
  if (!existsSync(htmlPath)) {
    throw new Error(
      `${appId} missing dist/runtime/index.html. Run pnpm benchmark:build runtime first.`,
    );
  }
  const viteCli = resolveViteCli(appId);
  const port = options?.port ?? (await getFreePort());
  const child = spawn(
    process.execPath,
    [viteCli, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--outDir", "dist/runtime"],
    {
      cwd: appDir(appId),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      shell: false,
      env: process.env,
    },
  );
  const stdout = { text: "" };
  const stderr = { text: "" };
  child.stdout?.on("data", (buf) => {
    stdout.text = appendBounded(stdout.text, buf);
  });
  child.stderr?.on("data", (buf) => {
    stderr.text = appendBounded(stderr.text, buf);
  });
  let handle: OwnedProcess;
  try {
    handle = trackChildProcess(child, `${appId} runtime preview`, process.platform !== "win32");
  } catch (error) {
    if (typeof child.pid === "number" && child.pid > 0) {
      try {
        process.kill(process.platform !== "win32" ? -child.pid : child.pid, "SIGKILL");
      } catch {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
    throw error;
  }
  const origin = `http://127.0.0.1:${port}`;
  const stopProcess = options?.stopOwnedProcess ?? stopOwnedProcess;
  try {
    await waitUntilReady(origin, handle, stderr);
  } catch (error) {
    let cleanupError: unknown = null;
    try {
      await stopProcess(handle);
    } catch (stopError) {
      cleanupError = stopError;
    }
    throwPreviewStartFailure(appId, error, cleanupError, stderr.text);
  }
  let stopOnce: Promise<void> | null = null;
  return {
    appId,
    origin,
    pid: handle.pid,
    port,
    stop: () => {
      if (!stopOnce) stopOnce = stopOwnedProcess(handle);
      return stopOnce;
    },
  };
}
