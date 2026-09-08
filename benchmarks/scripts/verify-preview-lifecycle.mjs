#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { appDir, appDistDir } from "./lib/paths.mjs";
import {
  handleHarnessInterrupt,
  interruptCleanupRunCount,
  INTERRUPT_STATUS,
  isPidAlive,
  ownedProcessCount,
  ownedProcessPids,
  resetInterruptStateForTest,
  stopOwnedProcess,
  TERM_WAIT_MS,
  trackChildProcess,
} from "../tests/performance/fixtures/ownedProcess.ts";
import {
  isBenchmarkRuntimePreviewCommand,
  portAcceptsConnections,
  resolveViteCli,
  startRuntimePreview,
  stopAllOwnedProcesses,
  throwPreviewStartFailure,
} from "../tests/performance/fixtures/previewServer.ts";
import { runOwnedSlot } from "../tests/performance/fixtures/slotLifecycle.ts";

const APPS_ROOT = join(appDir("lightfastgrid"), "..");
const INTERRUPT_FIXTURE = fileURLToPath(
  new URL("./interrupt-owned-process-fixture.mjs", import.meta.url),
);

function parsePs(output) {
  const rows = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
    });
  }
  return rows;
}

function listProcesses() {
  return parsePs(
    execFileSync("ps", ["-ax", "-o", "pid=", "-o", "ppid=", "-o", "args="], {
      encoding: "utf8",
    }),
  );
}

function processCwd(pid) {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
    });
    const line = output.split("\n").find((entry) => entry.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

function listBenchmarkPreviewProcesses() {
  return listProcesses()
    .filter((row) => isBenchmarkRuntimePreviewCommand(row.command))
    .map((row) => ({
      ...row,
      cwd: processCwd(row.pid),
    }));
}

if (process.argv.includes("--list-only")) {
  const rows = listBenchmarkPreviewProcesses();
  console.log(JSON.stringify(rows, null, 2));
  console.log(`count=${rows.length}`);
  process.exit(0);
}

{
  const fixture = spawn(
    "sh",
    ["-c", "trap '' TERM; printf 'ready\\n'; while true; do sleep 1; done"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      shell: false,
    },
  );
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sigterm-ignore fixture did not become ready")), 5_000);
    fixture.stdout?.on("data", (buf) => {
      if (String(buf).includes("ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    fixture.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("sigterm-ignore fixture exited before ready"));
    });
  });
  const handle = trackChildProcess(fixture, "sigterm-ignore fixture", process.platform !== "win32");
  assert.equal(isPidAlive(handle.pid), true);
  await ready;
  const started = Date.now();
  await stopOwnedProcess(handle);
  const elapsed = Date.now() - started;
  assert.equal(isPidAlive(handle.pid), false);
  assert.ok(handle.exitResult, "forced-kill stop must wait for a confirmed exit record");
  assert.ok(
    elapsed >= TERM_WAIT_MS,
    `SIGKILL fallback must wait for SIGTERM timeout (${elapsed}ms < ${TERM_WAIT_MS}ms)`,
  );
  assert.ok(!ownedProcessPids().includes(handle.pid));
  await stopOwnedProcess(handle);
}

{
  const htmlPath = join(appDistDir("lightfastgrid", "runtime"), "index.html");
  if (!existsSync(htmlPath)) {
    throw new Error(
      "lightfastgrid missing dist/runtime/index.html. Run pnpm benchmark:build runtime first.",
    );
  }
  assert.ok(resolveViteCli("lightfastgrid").endsWith(`${join("vite", "bin", "vite.js")}`));

  const before = listBenchmarkPreviewProcesses();
  const preview = await startRuntimePreview("lightfastgrid");
  try {
    assert.equal(isPidAlive(preview.pid), true);
    const response = await fetch(`${preview.origin}/`, { signal: AbortSignal.timeout(2_000) });
    assert.equal(response.ok, true);
    assert.equal(await portAcceptsConnections(preview.port), true);
    const cwd = processCwd(preview.pid);
    if (cwd) {
      assert.ok(
        cwd.startsWith(appDir("lightfastgrid")) || cwd.startsWith(APPS_ROOT),
        `preview cwd ${cwd} is not under benchmarks/apps`,
      );
    }
  } finally {
    await preview.stop();
  }
  await preview.stop();
  assert.equal(isPidAlive(preview.pid), false);
  assert.equal(await portAcceptsConnections(preview.port), false);
  assert.equal(
    listBenchmarkPreviewProcesses().some((row) => row.pid === preview.pid),
    false,
  );
  assert.deepEqual(
    listBenchmarkPreviewProcesses().map((row) => row.pid).sort(),
    before.map((row) => row.pid).sort(),
  );
}

{
  const beforePids = ownedProcessPids().slice();
  let failed = false;
  try {
    await startRuntimePreview("lightfastgrid", { port: 1 });
  } catch (error) {
    failed = true;
    assert.match(
      String(error instanceof Error ? error.message : error),
      /exited before HTTP readiness|runtime preview failed/,
    );
  }
  assert.equal(failed, true);
  assert.deepEqual(ownedProcessPids().sort(), beforePids.sort());
  assert.equal(
    listBenchmarkPreviewProcesses().filter((row) => /--port 1\b/.test(row.command)).length,
    0,
  );
}

{
  const startup = new Error("not ready");
  const cleanup = new Error("cleanup boom");
  let caught;
  try {
    throwPreviewStartFailure("lightfastgrid", startup, cleanup, "stderr-tail");
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AggregateError);
  assert.match(String(caught.message), /runtime preview failed: not ready/);
  assert.match(String(caught.message), /cleanup boom/);
  assert.match(String(caught.message), /stderr-tail/);
  assert.equal(caught.errors.length, 2);
}

{
  const live = spawn(
    "sh",
    ["-c", "trap '' TERM; printf 'ready\\n'; while true; do sleep 1; done"],
    { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", shell: false },
  );
  const handle = trackChildProcess(live, "dual-failure live fixture", process.platform !== "win32");
  const pids = ownedProcessPids().slice();
  let caught;
  try {
    await startRuntimePreview("lightfastgrid", {
      port: 1,
      stopOwnedProcess: async () => {
        throw new Error("cleanup boom");
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AggregateError);
  assert.match(String(caught.message), /runtime preview failed/);
  assert.match(String(caught.message), /cleanup boom/);
  assert.ok(
    pids.every((pid) => ownedProcessPids().includes(pid) || pid === handle.pid),
    "failed cleanup must not silently drop unrelated owned PIDs",
  );
  assert.equal(isPidAlive(handle.pid), true);
  assert.ok(ownedProcessPids().includes(handle.pid), "live owned process must remain registered");
  await stopOwnedProcess(handle);
}

{
  resetInterruptStateForTest();
  const exits = [];
  const stderr = [];
  let cleanupRuns = 0;
  const stopAll = () =>
    new Promise((resolve) => {
      cleanupRuns += 1;
      setTimeout(resolve, 40);
    });
  handleHarnessInterrupt("SIGINT", {
    stopAll,
    exit: (code) => {
      exits.push(code);
    },
    writeStderr: (text) => {
      stderr.push(text);
    },
  });
  handleHarnessInterrupt("SIGINT", {
    stopAll,
    exit: (code) => {
      exits.push(code);
    },
    writeStderr: (text) => {
      stderr.push(text);
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(cleanupRuns, 1);
  assert.equal(interruptCleanupRunCount(), 1);
  assert.ok(exits.includes(INTERRUPT_STATUS.SIGINT));
  resetInterruptStateForTest();
  handleHarnessInterrupt("SIGTERM", {
    stopAll: async () => {
      throw new Error("forced cleanup failure");
    },
    exit: (code) => {
      exits.push(code);
    },
    writeStderr: (text) => {
      stderr.push(text);
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(stderr.join(""), /forced cleanup failure/);
  assert.ok(exits.includes(INTERRUPT_STATUS.SIGTERM));
  resetInterruptStateForTest();
}

async function runInterruptChild(signal, extraArgs = []) {
  const child = spawn(process.execPath, ["--experimental-strip-types", INTERRUPT_FIXTURE, ...extraArgs], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (buf) => {
    stdout += String(buf);
  });
  child.stderr?.on("data", (buf) => {
    stderr += String(buf);
  });
  const fixturePid = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`interrupt child did not start\n${stdout}\n${stderr}`)),
      8_000,
    );
    const consider = () => {
      const match = stdout.match(/harness-ready (\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    };
    child.stdout?.on("data", consider);
    child.once("exit", (code, sig) => {
      clearTimeout(timer);
      reject(new Error(`interrupt child exited before ready code=${code} signal=${sig}\n${stdout}\n${stderr}`));
    });
  });
  child.kill(signal);
  const exit = await new Promise((resolve) => {
    child.once("exit", (code, sig) => resolve({ code, signal: sig }));
  });
  if (isPidAlive(fixturePid)) {
    try {
      process.kill(-fixturePid, "SIGKILL");
    } catch {
      try {
        process.kill(fixturePid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  return { fixturePid, exit, stdout, stderr };
}

{
  const interrupted = await runInterruptChild("SIGINT");
  assert.equal(interrupted.exit.code, INTERRUPT_STATUS.SIGINT);
  assert.equal(isPidAlive(interrupted.fixturePid), false);
  assert.equal(
    listBenchmarkPreviewProcesses().some((row) => row.pid === interrupted.fixturePid),
    false,
  );
}

{
  const interrupted = await runInterruptChild("SIGTERM");
  assert.equal(interrupted.exit.code, INTERRUPT_STATUS.SIGTERM);
  assert.equal(isPidAlive(interrupted.fixturePid), false);
}

{
  const interrupted = await runInterruptChild("SIGINT", ["--fail-cleanup"]);
  assert.equal(interrupted.exit.code, INTERRUPT_STATUS.SIGINT);
  assert.match(interrupted.stderr, /forced cleanup failure/);
  assert.equal(isPidAlive(interrupted.fixturePid), false);
}

{
  const before = listBenchmarkPreviewProcesses();
  const failures = [];
  await runOwnedSlot({
    startPreview: () => startRuntimePreview("lightfastgrid"),
    createPage: async () => ({ close: async () => {} }),
    attachGuards: async () => ({ detach: () => {} }),
    recordFailure: (phase, error) => {
      failures.push({ phase, error });
    },
    work: async ({ preview }) => {
      const response = await fetch(`${preview.origin}/`, { signal: AbortSignal.timeout(2_000) });
      assert.equal(response.ok, true);
      assert.equal(isPidAlive(preview.pid), true);
    },
  });
  assert.deepEqual(failures, []);
  assert.equal(ownedProcessCount(), 0);
  assert.deepEqual(
    listBenchmarkPreviewProcesses().map((row) => row.pid).sort(),
    before.map((row) => row.pid).sort(),
  );
}

await stopAllOwnedProcesses();
assert.equal(ownedProcessCount(), 0);

console.log(
  "Preview lifecycle tests passed: confirmed-exit stop, SIGKILL fallback, SIGINT/SIGTERM 130/143, dual startup/cleanup errors, real preview start/stop, completed slot leaves no descendants.",
);
