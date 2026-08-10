/**
 * Image generation via the Codex CLI (`codex login` — no API keys).
 *
 * Codex does not expose a one-tool-only mode like Grok Build, so this path is
 * wider than grok.ts: it runs `codex exec` with workspace-write against a
 * scratch directory we control, then collects the image it wrote.
 *
 * Video stays on Grok (`reference_to_video`). Codex is image-only here.
 */

import { spawn } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { GrokRunResult } from "./grok.ts";

export const CODEX_BIN = process.env.CANVAS_CODEX_BIN ?? "codex";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function execCodex(
  args: string[],
  cwd: string,
  timeoutMs: number,
  /** When set, written to stdin (use with prompt arg `-`). */
  stdinText?: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_BIN, args, {
      cwd,
      env: process.env,
      // Long prompts with spaces/newlines are unreliable as argv; feed via stdin.
      stdio: [stdinText !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    if (stdinText !== undefined) {
      child.stdin?.write(stdinText);
      child.stdin?.end();
    }

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Codex timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ENOENT")) {
        reject(
          new Error(
            `Codex CLI not found ("${CODEX_BIN}"). Install Codex, put it on PATH, ` +
              `then run \`codex login\`. Override the binary with CANVAS_CODEX_BIN.`,
          ),
        );
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

async function newestImageInDir(dir: string, afterMs: number): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  let best: { path: string; mtime: number } | null = null;
  for (const name of entries) {
    const lower = name.toLowerCase();
    const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
    if (!IMAGE_EXTS.has(ext)) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (info.mtimeMs + 5 < afterMs) continue; // only files written this run
      if (!best || info.mtimeMs > best.mtime) {
        best = { path, mtime: info.mtimeMs };
      }
    } catch {
      // skip
    }
  }
  return best?.path ?? null;
}

export interface CodexGenerateInput {
  prompt: string;
  aspect: string;
  /** Scratch directory Codex may write into (created if needed). */
  workDir: string;
  /** Preferred absolute output path — asked for in the prompt. */
  outPath: string;
  /**
   * Absolute paths to prior boards / frames. Passed with `codex exec -i` so the
   * model can lock character and style for storyboard continuations.
   */
  referenceImagePaths?: string[];
}

/**
 * Generate one image with Codex. Returns a GrokRunResult-shaped object so the
 * runner can treat providers uniformly.
 */
export async function generateImageWithCodex(
  input: CodexGenerateInput,
): Promise<GrokRunResult> {
  await mkdir(input.workDir, { recursive: true });
  const started = Date.now();
  const refs = (input.referenceImagePaths ?? []).filter(Boolean);

  const continuity =
    refs.length > 0
      ? [
          "You are attached reference image(s) of the previous storyboard board(s).",
          "Match the SAME character design, proportions, palette, lighting, and world from those refs.",
          "This is a CONTINUATION or keyframe — hold visual continuity; do not redesign the cast or style.",
        ].join(" ")
      : "";

  const prompt = [
    "Generate exactly one still image. Do not only describe it.",
    "Use the imagegen / image_gen tool with GPT Image 2 at the highest quality setting available (quality: high).",
    "Prefer high-fidelity, detailed output over drafts or low/medium quality.",
    `Aspect ratio: ${input.aspect}.`,
    `Save the finished image to this absolute path (create parent dirs if needed): ${input.outPath}`,
    "Prefer JPEG or PNG.",
    continuity,
    `Subject: ${input.prompt}`,
    "When finished, ensure the file exists at that path. Reply with the path only.",
  ]
    .filter(Boolean)
    .join("\n");

  // Non-interactive: bypass approvals; workspace-write with cwd=workDir.
  // -i attaches prior boards. Prompt goes on stdin via `-` so long multi-line
  // subjects (and paths with spaces) are not lost as argv.
  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "-s",
    "workspace-write",
    ...refs.flatMap((path) => ["-i", path]),
    "-", // read prompt from stdin
  ];

  let output = "";
  let code = 1;
  try {
    const result = await execCodex(args, input.workDir, 8 * 60_000, prompt);
    code = result.code;
    output = result.output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      mediaPath: null,
      text: message,
      blocked: false,
      message,
      costUsd: 0,
      turns: 0,
    };
  }

  // Prefer the exact path we asked for; fall back to newest image in workDir.
  let mediaPath: string | null = null;
  try {
    const info = await stat(input.outPath);
    if (info.isFile() && info.size > 0) mediaPath = input.outPath;
  } catch {
    // missing
  }
  if (!mediaPath) {
    mediaPath = await newestImageInDir(input.workDir, started);
  }

  if (!mediaPath) {
    return {
      ok: false,
      mediaPath: null,
      text: output.slice(0, 2000),
      blocked: false,
      message:
        `Codex finished (exit ${code}) but wrote no image. ` +
        `Run \`codex login\` if needed. Output: ${output.slice(0, 400) || "(empty)"}`,
      costUsd: 0,
      turns: 1,
    };
  }

  return {
    ok: true,
    mediaPath,
    text: output.slice(0, 500),
    blocked: false,
    message: null,
    costUsd: 0,
    turns: 1,
  };
}

export async function codexAvailable(): Promise<boolean> {
  try {
    const { code } = await execCodex(["--version"], process.cwd(), 15_000);
    return code === 0;
  } catch {
    try {
      const { code } = await execCodex(["--help"], process.cwd(), 15_000);
      return code === 0;
    } catch {
      return false;
    }
  }
}
