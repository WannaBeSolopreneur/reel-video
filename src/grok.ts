/**
 * A deliberately narrow doorway to Grok Build.
 *
 * The rule this module enforces: the agent generates, and nothing else. It gets
 * exactly one tool, no web access, no terminal, and no permission bypass. It
 * cannot move a file, open a port, or install anything, because it is never
 * given the means.
 *
 * That is not paranoia. The previous implementation of this project invoked
 * `grok -p <english instructions> --yolo --max-turns 12` and asked the agent to
 * please make a file appear at a path. When the video API refused a request,
 * the agent did what it was told to do — accomplish the goal — and improvised:
 * it stood up a local PUT receiver and a public tunnel to satisfy the API, then
 * ran out of turns. An unauthenticated upload endpoint was left listening on
 * every interface of the developer's machine.
 *
 * Same account, same failing API call, measured:
 *
 *   --yolo --max-turns 12       12 turns, ~$0.50, a public tunnel, no video
 *   --tools image_to_video      2 turns,  $0.054, a verbatim error, no side effects
 *
 * The narrow version could not improvise, so it reported the truth and stopped.
 */

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { sessionDirFor, newestSessionMedia } from "./session-paths.ts";

export const GROK_BIN = process.env.CANVAS_GROK_BIN ?? "grok";

/** Grok's own wording when a Zero Data Retention team hits video generation. */
const ZDR_MARKER = "Zero Data Retention teams must provide output.upload_url";

export interface GrokRunResult {
  ok: boolean;
  /** Absolute path to the media the run produced, if any. */
  mediaPath: string | null;
  text: string;
  /** True when the account forbids this operation; retrying will not help. */
  blocked: boolean;
  message: string | null;
  costUsd: number;
  turns: number;
}

interface GrokJson {
  text?: string;
  stopReason?: string;
  num_turns?: number;
  total_cost_usd?: number;
}

/**
 * Grok prints a JSON object and may then append plain text such as
 * "Error: max turns reached", so JSON.parse on the whole stream fails. Take the
 * first balanced object instead.
 */
export function parseFirstJsonObject(raw: string): GrokJson | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1)) as GrokJson;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function execGrok(
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(GROK_BIN, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Grok timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ENOENT")) {
        reject(
          new Error(
            `Grok CLI not found ("${GROK_BIN}"). Install Grok Build, put it on PATH, ` +
              `then run \`grok login\`. Override the binary with CANVAS_GROK_BIN.`,
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

interface RunOptions {
  prompt: string;
  /** Exactly the tools this run may use. Never include a shell or file tool. */
  tools: string[];
  maxTurns: number;
  cwd: string;
  timeoutMs: number;
  /**
   * When true, a run with no session media still counts as ok if the tool did
   * not report an error — used when video is delivered via upload_url instead.
   */
  allowMissingSessionMedia?: boolean;
}

async function runNarrowly(options: RunOptions): Promise<GrokRunResult> {
  const sessionId = randomUUID();
  const sessionDir = sessionDirFor(options.cwd, sessionId);

  const args = [
    "-p",
    options.prompt,
    "--session-id",
    sessionId,
    // The allowlist. Everything not named here is unavailable, including the
    // terminal, file writes, and web fetch.
    "--tools",
    options.tools.join(","),
    "--disable-web-search",
    "--max-turns",
    String(options.maxTurns),
    "--output-format",
    "json",
  ];

  const { output } = await execGrok(args, options.cwd, options.timeoutMs);
  const parsed = parseFirstJsonObject(output);
  const text = parsed?.text ?? output.slice(0, 2000);
  const costUsd = parsed?.total_cost_usd ?? 0;
  const turns = parsed?.num_turns ?? 0;

  if (text.includes(ZDR_MARKER) || output.includes(ZDR_MARKER)) {
    return {
      ok: false,
      mediaPath: null,
      text,
      blocked: true,
      message:
        "Zero Data Retention teams must provide output.upload_url for video generation. " +
        "Set CANVAS_S3_* (Cloudflare R2) env vars — see docs/zdr.md.",
      costUsd,
      turns,
    };
  }

  // We never asked the agent to place a file, so success is decided by whether
  // media exists in the session directory we named — unless the caller is
  // collecting the file from a relay upload_url instead.
  const media = await newestSessionMedia(sessionDir);
  if (!media) {
    if (options.allowMissingSessionMedia) {
      return {
        ok: true,
        mediaPath: null,
        text,
        blocked: false,
        message: null,
        costUsd,
        turns,
      };
    }
    return {
      ok: false,
      mediaPath: null,
      text,
      blocked: false,
      message: `Grok produced no media. Response: ${text.slice(0, 400) || "(empty)"}`,
      costUsd,
      turns,
    };
  }

  return { ok: true, mediaPath: media.path, text, blocked: false, message: null, costUsd, turns };
}

export interface GenerateImageInput {
  prompt: string;
  aspect: string;
  cwd: string;
}

export function generateImage(input: GenerateImageInput): Promise<GrokRunResult> {
  // One turn is enough: generate, stop. There is nothing else it may do.
  return runNarrowly({
    prompt:
      `Generate one image with the image_gen tool. ` +
      `Aspect ratio: ${input.aspect}. ` +
      `Do not describe the image in words; call the tool. ` +
      `Subject: ${input.prompt}`,
    tools: ["image_gen"],
    maxTurns: 1,
    cwd: input.cwd,
    timeoutMs: 5 * 60_000,
  });
}

export interface AnimateInput {
  prompt: string;
  /**
   * Absolute path(s) to local reference images. `reference_to_video` requires
   * 2–7 entries; when a single path is given we pass it twice so a one-frame
   * storyboard still works.
   */
  sourcePath: string;
  /** Extra absolute paths (optional). Combined with sourcePath, capped at 7. */
  referencePaths?: string[];
  /** Aspect ratio for the finished video (matches the source image when known). */
  aspect?: string;
  duration: 6 | 10;
  cwd: string;
}

/**
 * Animate via Grok Build's `reference_to_video` tool (not `image_to_video`).
 * That path is what this project uses end-to-end for short ads.
 */
export function animateImage(input: AnimateInput): Promise<GrokRunResult> {
  // Primary board first — this is the storyboard to animate. Extra paths are
  // prior boards for style/character lock only (reference_to_video needs 2–7).
  const paths = [input.sourcePath, ...(input.referencePaths ?? [])]
    .filter(Boolean)
    .slice(0, 7);
  while (paths.length < 2) paths.push(input.sourcePath);
  const imagesJson = JSON.stringify(paths);
  const aspect = input.aspect ?? "9:16";
  const motion = input.prompt;

  // Two turns: the tool call, plus room to surface an API error as text.
  return runNarrowly({
    prompt:
      `Call reference_to_video exactly once. ` +
      `images=${imagesJson} ` +
      `aspect_ratio=${JSON.stringify(aspect)} ` +
      `duration=${input.duration} ` +
      `prompt=${JSON.stringify(
        [
          "PRIMARY: The FIRST image is the multi-panel storyboard board to animate — follow ITS panels and layout only.",
          "Any later images are style/character references from earlier boards; match that cat and world, do not animate those boards.",
          "Do not invent a different scene or switch to a single non-storyboard shot.",
          `Motion / story: ${motion}`,
        ].join(" "),
      )}. ` +
      `Do not describe the video in words; call the tool only. ` +
      `If the tool returns an error, report the error text verbatim and stop.`,
    tools: ["reference_to_video"],
    maxTurns: 2,
    cwd: input.cwd,
    timeoutMs: 10 * 60_000,
  });
}

export async function grokAvailable(): Promise<boolean> {
  try {
    const { code } = await execGrok(["--version"], process.cwd(), 20_000);
    return code === 0;
  } catch {
    return false;
  }
}
