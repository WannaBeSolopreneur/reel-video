/**
 * After a scene strip (or its three crops) exists, review the stills and write
 * a duration-aware motion prompt that matches what is actually drawn — not the
 * generic placeholder from scene scaffold.
 *
 * Uses Codex with attached images (vision). No new image is generated.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CODEX_BIN } from "./codex.ts";
import { sceneTiming } from "./scene-prompts.ts";

export interface MotionFromStripInput {
  /** Absolute paths: prefer [first, mid, last] crops; strip alone is ok. */
  imagePaths: string[];
  duration: 6 | 10;
  sceneName?: string;
  /** Scratch dir for Codex cwd. */
  workDir: string;
  /** Optional seed line (scene panels note) — model may refine from stills. */
  seedAction?: string;
}

export interface MotionFromStripResult {
  ok: boolean;
  prompt: string | null;
  /** Raw model text for debugging. */
  raw: string;
  message: string | null;
}

function execCodex(
  args: string[],
  cwd: string,
  timeoutMs: number,
  stdinText?: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_BIN, args, {
      cwd,
      env: process.env,
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
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

function isUsefulMotionBody(body: string): boolean {
  const t = body.trim();
  if (t.length < 120) return false;
  if (/^\.{1,6}$/.test(t)) return false; // placeholder "..."
  if (!/CORE ACTION|SETUP note|SCENE VIDEO TEMPLATE|Continuous \d+-second/i.test(t)) {
    return false;
  }
  return true;
}

/**
 * Pull the model-written motion prompt from Codex stdout.
 * Prefer the *last* useful <<<MOTION_PROMPT>>> block (instruction text may
 * contain an earlier example block that must be ignored).
 */
export function extractMotionPrompt(raw: string): string | null {
  // Preferred markers (instruction text must not include a filled example).
  const beginEnd = [
    ...raw.matchAll(/BEGIN_MOTION\s*([\s\S]*?)\s*END_MOTION/gi),
  ];
  for (let i = beginEnd.length - 1; i >= 0; i -= 1) {
    const body = (beginEnd[i]?.[1] ?? "").trim();
    if (isUsefulMotionBody(body)) return body;
  }

  // Legacy markers — skip empty / "..." placeholders.
  const legacy = [
    ...raw.matchAll(/<<<MOTION_PROMPT\s*([\s\S]*?)\s*>>>MOTION_PROMPT/gi),
  ];
  for (let i = legacy.length - 1; i >= 0; i -= 1) {
    const body = (legacy[i]?.[1] ?? "").trim();
    if (isUsefulMotionBody(body)) return body;
  }

  // Fallback: last useful "=== SCENE VIDEO TEMPLATE" block.
  let searchFrom = 0;
  let lastGood: string | null = null;
  while (searchFrom < raw.length) {
    const idx = raw.slice(searchFrom).search(/===\s*SCENE VIDEO TEMPLATE/i);
    if (idx < 0) break;
    const abs = searchFrom + idx;
    let body = raw.slice(abs).trim();
    const cut = body.search(
      /\n(?:tokens used|OpenAI Codex|workdir:|BEGIN_MOTION|END_MOTION)/i,
    );
    if (cut > 80) body = body.slice(0, cut).trim();
    // Prefer blocks that filled in real CORE ACTION (not leftover [brackets]).
    if (
      isUsefulMotionBody(body) &&
      !/CORE ACTION[^\n]*\[one concrete/i.test(body)
    ) {
      lastGood = body;
    }
    searchFrom = abs + 4;
  }
  return lastGood;
}

function buildReviewPrompt(input: MotionFromStripInput): string {
  const t = sceneTiming(input.duration);
  const name = input.sceneName ?? "scene";
  const seed = input.seedAction?.trim()
    ? `Scaffold note (may refine from stills): ${input.seedAction.trim()}`
    : "No scaffold note — derive action only from the stills.";

  return [
    "You are a storyboard-to-motion director. You can SEE the attached stills.",
    "The images are either a 3-panel strip LEFT|MIDDLE|RIGHT or three keyframes in order: first, middle, last.",
    "Do NOT generate or edit any images. Text only. Do NOT call image tools.",
    "",
    `Scene name: ${name}`,
    `Target video length: ${input.duration} seconds (full take — not a 2s gag).`,
    `Timeline: SETUP ${t.setupRange} (~${t.setupSec}s) · PEAK ${t.peakRange} (~${t.peakSec}s) · AFTERMATH ${t.afterRange} (~${t.afterSec}s).`,
    seed,
    "",
    "TASK:",
    "1) Silently note what each panel/keyframe actually shows (who, pose, hands, prop, location).",
    "2) Write a COMPLETE motion prompt for reference-to-video that morphs first→middle→last.",
    "   Base motion on the visual change BETWEEN stills. Do not invent new characters, props, or locations.",
    "",
    "OUTPUT RULES:",
    "- Put the finished motion prompt between BEGIN_MOTION and END_MOTION lines (those exact words alone on a line).",
    "- No preamble before BEGIN_MOTION. No tools. No image generation.",
    "- Fill every angle-bracket field with concrete action from the stills (not the words left/middle/right alone).",
    "",
    "Template to fill (keep headings; replace bracketed fields):",
    `=== SCENE VIDEO TEMPLATE (${input.duration}s) — from strip review ===`,
    "",
    `Continuous ${input.duration}-second SINGLE TAKE of scene "${name}".`,
    `Total runtime = ${input.duration}s. Use the FULL length — do not rush action into the first 2 seconds.`,
    "",
    "PRIMARY: Morph three reference stills IN ORDER (first→middle→last).",
    "Stills lock identity + set. Motion is continuous between them.",
    "Match characters, wardrobe, faces, location EXACTLY — no redesign, no new props, no on-screen text.",
    "",
    "--- ACTION (from reviewed stills) ---",
    `CORE ACTION (must read across full ${input.duration}s): [one concrete line from what you see]`,
    `SETUP note ${t.setupRange}: [physical action in first keyframe — holds ~${t.setupSec}s]`,
    `PEAK note ${t.peakRange}: [physical action in middle keyframe — ~${t.peakSec}s]`,
    `AFTERMATH note ${t.afterRange}: [physical action in last keyframe — ~${t.afterSec}s]`,
    "CAMERA: [motivated move that fits the stills]",
    "--- END ACTION ---",
    "",
    "PACING / TIMECODE (fixed — honor exactly):",
    `${t.setupRange} SETUP (~${t.setupSec}s): establish from first still — slow, hold readable poses.`,
    `${t.peakRange} PEAK (~${t.peakSec}s): main action through middle still — contact, weight, effort.`,
    `${t.afterRange} AFTERMATH (~${t.afterSec}s): land on last still — settle until end; do not cut early.`,
    "",
    "Animate: body mechanics, hands, head turns, eyes, weight shifts, prop contact, facial reaction, holds, follow-through.",
    "Smooth morph between stills; no freeze-frames; no speed-ramping the whole clip into a blink.",
    "",
    "Now output BEGIN_MOTION, then the filled template, then END_MOTION.",
  ].join("\n");
}

/**
 * Vision-review strip/frames via Codex and return a timed motion prompt.
 */
export async function generateMotionPromptFromStrip(
  input: MotionFromStripInput,
): Promise<MotionFromStripResult> {
  const paths = input.imagePaths.filter(Boolean);
  if (paths.length < 1) {
    return {
      ok: false,
      prompt: null,
      raw: "",
      message: "No strip/frame images to review.",
    };
  }

  await mkdir(input.workDir, { recursive: true });
  const reviewPrompt = buildReviewPrompt(input);
  const args = [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "-s",
    "read-only",
    ...paths.flatMap((p) => ["-i", p]),
    "-",
  ];

  let output = "";
  try {
    const result = await execCodex(args, input.workDir, 4 * 60_000, reviewPrompt);
    output = result.output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, prompt: null, raw: message, message };
  }

  const prompt = extractMotionPrompt(output);
  if (!prompt) {
    return {
      ok: false,
      prompt: null,
      raw: output.slice(0, 3000),
      message:
        "Codex reviewed the strip but returned no parseable motion prompt. " +
        `Output: ${output.slice(0, 400) || "(empty)"}`,
    };
  }

  return { ok: true, prompt, raw: output.slice(-4000), message: null };
}

/** Prefer first/mid/last crop paths; fall back to strip alone. */
export function pickReviewImagePaths(options: {
  stripPath?: string | null;
  firstPath?: string | null;
  middlePath?: string | null;
  lastPath?: string | null;
}): string[] {
  const frames = [options.firstPath, options.middlePath, options.lastPath].filter(
    (p): p is string => Boolean(p),
  );
  if (frames.length >= 2) return frames;
  if (options.stripPath) return [options.stripPath];
  return frames;
}
