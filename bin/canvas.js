#!/usr/bin/env node
/**
 * Thin launcher so `canvas ...` works without a build step. The CLI is
 * TypeScript run through tsx; this shim just forwards argv and the exit code.
 *
 * tsx is resolved relative to THIS FILE, not the working directory. Passing the
 * bare specifier (`--import tsx`) makes Node resolve it from process.cwd(),
 * which only works when the user happens to be sitting in a directory that has
 * tsx installed — so `npx reel-video` and global installs both failed with
 * ERR_MODULE_NOT_FOUND.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "cli.ts");

const require = createRequire(import.meta.url);
let tsxLoader;
try {
  tsxLoader = pathToFileURL(require.resolve("tsx")).href;
} catch {
  console.error(
    "Reel Video could not load its TypeScript loader (tsx).\n" +
      "If you are working from a clone, run: npm install",
  );
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", tsxLoader, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
