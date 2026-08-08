#!/usr/bin/env node
/**
 * Thin launcher so `canvas ...` works without a build step. The CLI is
 * TypeScript run through tsx; this shim just forwards argv and the exit code.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "cli.ts");

const child = spawn(process.execPath, ["--import", "tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
