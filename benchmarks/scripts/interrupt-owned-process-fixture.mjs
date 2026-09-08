#!/usr/bin/env node
import { spawn } from "node:child_process";

import {
  setInterruptStopAllForTest,
  stopAllOwnedProcesses,
  trackChildProcess,
} from "../tests/performance/fixtures/ownedProcess.ts";

const failCleanup = process.argv.includes("--fail-cleanup");

const fixture = spawn(
  "sh",
  ["-c", "trap '' TERM; printf 'fixture-ready\\n'; while true; do sleep 1; done"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    shell: false,
  },
);

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("interrupt fixture did not become ready")), 5_000);
  fixture.stdout?.on("data", (buf) => {
    if (String(buf).includes("fixture-ready")) {
      clearTimeout(timer);
      resolve();
    }
  });
  fixture.once("exit", () => {
    clearTimeout(timer);
    reject(new Error("interrupt fixture exited before ready"));
  });
});

const handle = trackChildProcess(fixture, "interrupt-fixture", process.platform !== "win32");
if (failCleanup) {
  setInterruptStopAllForTest(async () => {
    await stopAllOwnedProcesses();
    throw new Error("forced cleanup failure");
  });
}
process.stdout.write(`harness-ready ${handle.pid}\n`);
setInterval(() => {}, 1 << 30);
