/**
 * Direct xAI Imagine API client for canvas stills and video.
 *
 * Auth (in order):
 *   1. `XAI_API_KEY` / `CANVAS_XAI_API_KEY` if set
 *   2. Grok Build session from `~/.grok/auth.json` (`grok login` OIDC token)
 *
 * Models (same as Grok Build CLI hardcodes):
 *   image → grok-imagine-image-quality
 *   video → grok-imagine-video-1.5  (reference_images path; 720p max for multi-ref)
 *
 * We intentionally do NOT shell out to `grok -p`. That path spun an agent loop
 * for a single tool call, hid model/duration control, and once improvised a
 * public tunnel when the API failed. Direct HTTP keeps side effects at zero.
 */

import { createWriteStream, readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createVideoRelay, relayConfigured } from "./relay.ts";

export const GROK_BIN = process.env.CANVAS_GROK_BIN ?? "grok";

const API_BASE = (process.env.CANVAS_XAI_API_BASE ?? "https://api.x.ai/v1").replace(
  /\/$/,
  "",
);
const IMAGE_MODEL = "grok-imagine-image-quality";
const VIDEO_MODEL = "grok-imagine-video-1.5";
/** xAI reports cost as integer ticks; 1e10 ticks = $1.00 (observed). */
const USD_TICKS_PER_DOLLAR = 10_000_000_000;
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
 * Legacy helper: Grok CLI used to print a JSON object then append plain text.
 * Kept for tests and any residual log parsing.
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

export interface GrokAuth {
  token: string;
  source: "api_key" | "session";
}

/** Resolve a bearer token for api.x.ai. */
export function loadGrokAuth(authPath?: string): GrokAuth {
  const apiKey =
    process.env.CANVAS_XAI_API_KEY?.trim() || process.env.XAI_API_KEY?.trim();
  if (apiKey) return { token: apiKey, source: "api_key" };

  const path = authPath ?? join(homedir(), ".grok", "auth.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `No xAI credentials. Run \`grok login\` (writes ~/.grok/auth.json) ` +
        `or set XAI_API_KEY / CANVAS_XAI_API_KEY.`,
    );
  }
  return parseGrokAuthFile(raw, path);
}

function parseGrokAuthFile(raw: string, path: string): GrokAuth {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Grok auth file is not valid JSON: ${path}`);
  }
  if (!data || typeof data !== "object") {
    throw new Error(`Grok auth file has unexpected shape: ${path}`);
  }
  // Shape: { "https://auth.x.ai::clientId": { key, refresh_token, ... } }
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.key === "string" && entry.key.trim()) {
      return { token: entry.key.trim(), source: "session" };
    }
    const tokens = entry.tokens;
    if (tokens && typeof tokens === "object") {
      const access = (tokens as Record<string, unknown>).access_token;
      if (typeof access === "string" && access.trim()) {
        return { token: access.trim(), source: "session" };
      }
    }
  }
  throw new Error(
    `No access token in ${path}. Run \`grok login\` again, or set XAI_API_KEY.`,
  );
}

async function loadGrokAuthAsync(authPath?: string): Promise<GrokAuth> {
  const apiKey =
    process.env.CANVAS_XAI_API_KEY?.trim() || process.env.XAI_API_KEY?.trim();
  if (apiKey) return { token: apiKey, source: "api_key" };

  const path = authPath ?? join(homedir(), ".grok", "auth.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `No xAI credentials. Run \`grok login\` (writes ~/.grok/auth.json) ` +
        `or set XAI_API_KEY / CANVAS_XAI_API_KEY.`,
    );
  }
  return parseGrokAuthFile(raw, path);
}

function ticksToUsd(ticks: unknown): number {
  if (typeof ticks !== "number" || !Number.isFinite(ticks)) return 0;
  return ticks / USD_TICKS_PER_DOLLAR;
}

function mimeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function fileToDataUrl(path: string): Promise<string> {
  const buf = await readFile(path);
  const mime = mimeForPath(path);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function apiJson(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  timeoutMs = 120_000,
): Promise<{ status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "User-Agent": "reel-video-canvas/0.1",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== "object") return fallback;
  const o = json as Record<string, unknown>;
  if (typeof o.error === "string") return o.error;
  if (o.error && typeof o.error === "object") {
    const e = o.error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  if (typeof o.message === "string") return o.message;
  return fallback;
}

function isZdrError(message: string): boolean {
  return message.includes(ZDR_MARKER) || message.toLowerCase().includes("upload_url");
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download media (${res.status}) from xAI URL`);
  }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    return;
  }
  // Node fetch body is a web ReadableStream
  const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(dest));
}

async function writeTempMedia(
  prefix: string,
  extension: string,
  data: Buffer,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const path = join(dir, `out${extension}`);
  await writeFile(path, data);
  return path;
}

export interface GenerateImageInput {
  prompt: string;
  aspect: string;
  cwd: string;
  /** Optional local stills for multi-image edit (up to 3). */
  referenceImagePaths?: string[];
}

/**
 * Text-to-image (or multi-image edit when refs are provided) via Imagine API.
 */
export async function generateImage(input: GenerateImageInput): Promise<GrokRunResult> {
  try {
    const auth = await loadGrokAuthAsync();
    const refs = (input.referenceImagePaths ?? []).filter(Boolean).slice(0, 3);
    const useEdit = refs.length > 0;

    const body: Record<string, unknown> = {
      model: IMAGE_MODEL,
      prompt: input.prompt,
      aspect_ratio: input.aspect || "1:1",
      n: 1,
      response_format: "b64_json",
    };

    if (useEdit) {
      // API accepts either `image` (single) or `images` (multi) — not both.
      const dataUrls = await Promise.all(refs.map(fileToDataUrl));
      if (dataUrls.length === 1) {
        body.image = { url: dataUrls[0], type: "image_url" };
      } else {
        body.images = dataUrls.map((url) => ({ url, type: "image_url" }));
      }
    }

    const path = useEdit ? "/images/edits" : "/images/generations";
    const { status, json, text } = await apiJson("POST", path, auth.token, body, 5 * 60_000);

    if (status >= 400) {
      const message = errorMessage(json, text.slice(0, 400) || `HTTP ${status}`);
      return {
        ok: false,
        mediaPath: null,
        text: message,
        blocked: isZdrError(message) || status === 403,
        message,
        costUsd: 0,
        turns: 0,
      };
    }

    const payload = json as {
      data?: Array<{ b64_json?: string; url?: string; mime_type?: string }>;
      usage?: { cost_in_usd_ticks?: number };
    } | null;
    const item = payload?.data?.[0];
    const costUsd = ticksToUsd(payload?.usage?.cost_in_usd_ticks);

    if (item?.b64_json) {
      const mime = item.mime_type ?? "image/jpeg";
      const ext = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : ".jpg";
      const mediaPath = await writeTempMedia("canvas-grok-img-", ext, Buffer.from(item.b64_json, "base64"));
      return {
        ok: true,
        mediaPath,
        text: `image via ${IMAGE_MODEL} (${auth.source})`,
        blocked: false,
        message: null,
        costUsd,
        turns: 0,
      };
    }

    if (item?.url) {
      const ext = ".jpg";
      const dir = await mkdtemp(join(tmpdir(), "canvas-grok-img-"));
      const mediaPath = join(dir, `out${ext}`);
      await downloadToFile(item.url, mediaPath);
      return {
        ok: true,
        mediaPath,
        text: `image via ${IMAGE_MODEL} (${auth.source})`,
        blocked: false,
        message: null,
        costUsd,
        turns: 0,
      };
    }

    return {
      ok: false,
      mediaPath: null,
      text: text.slice(0, 400),
      blocked: false,
      message: `Image API returned no image data. Response: ${text.slice(0, 300)}`,
      costUsd,
      turns: 0,
    };
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
}

export interface AnimateInput {
  prompt: string;
  /**
   * Absolute path(s) to local reference images. reference-to-video needs 2–7;
   * a single path is duplicated so one-frame boards still work.
   */
  sourcePath: string;
  referencePaths?: string[];
  aspect?: string;
  duration: 6 | 10;
  /** reference-to-video is capped at 720p on the API. */
  resolution?: "480p" | "720p";
  cwd: string;
}

/**
 * Multi-still video via POST /videos/generations (reference_images mode).
 * Model: grok-imagine-video-1.5.
 */
export async function animateImage(input: AnimateInput): Promise<GrokRunResult> {
  let relay: ReturnType<typeof createVideoRelay> = null;
  try {
    const auth = await loadGrokAuthAsync();
    const paths = [input.sourcePath, ...(input.referencePaths ?? [])]
      .filter(Boolean)
      .slice(0, 7);
    while (paths.length < 2) paths.push(input.sourcePath);

    const aspect = input.aspect ?? "9:16";
    const resolution = input.resolution ?? "720p";
    // API caps reference-to-video at 720p; never send 1080p on this path.
    const safeResolution = resolution === "480p" ? "480p" : "720p";

    const dataUrls = await Promise.all(paths.map(fileToDataUrl));
    const duration = input.duration;
    const motion = [
      `PRIMARY: Continuous ${duration}-second performance using reference stills IN ORDER (first → middle → last).`,
      `Fill the FULL ${duration}s — do not rush the action into the opening seconds; leave room for anticipation, peak, and aftermath.`,
      "Morph smoothly between stills; stills lock identity and set — do not redesign people, wardrobe, faces, or location.",
      "Prioritize clear physical ACTION: hands, body mechanics, prop contact, facial reaction, weight shifts, holds, follow-through.",
      "Camera stays motivated and secondary to the action. No new characters.",
      "NO on-screen text means no captions, subtitles, or titles burned into frame — it does NOT mean silence.",
      "AUDIO: generate a full soundtrack. If the brief specifies narration, dialogue, or spoken lines, SPEAK them aloud as real voice-over/character dialogue, lip-synced to the named character, in the order and timing given. Also render the requested score, sound effects, and ambience.",
      `Director brief (already timed for ${duration}s if ranges are given — honor every action AND audio instruction): ${input.prompt}`,
    ].join(" ");

    const body: Record<string, unknown> = {
      model: VIDEO_MODEL,
      prompt: motion,
      reference_images: dataUrls.map((url) => ({ url })),
      duration: input.duration,
      aspect_ratio: aspect,
      resolution: safeResolution,
    };

    // ZDR teams need a customer upload target. Prefer our S3/R2 relay when set.
    if (relayConfigured()) {
      relay = createVideoRelay(`vid-${Date.now()}`);
      if (relay) {
        body.output = { upload_url: relay.uploadUrl };
      }
    }

    const started = await apiJson(
      "POST",
      "/videos/generations",
      auth.token,
      body,
      120_000,
    );

    if (started.status >= 400) {
      const message = errorMessage(
        started.json,
        started.text.slice(0, 400) || `HTTP ${started.status}`,
      );
      if (relay) await relay.abandon().catch(() => {});
      return {
        ok: false,
        mediaPath: null,
        text: message,
        blocked: isZdrError(message) || started.status === 403,
        message: isZdrError(message)
          ? `${message} Set CANVAS_S3_* (Cloudflare R2) env vars — see docs/zdr.md.`
          : message,
        costUsd: 0,
        turns: 0,
      };
    }

    const requestId = (started.json as { request_id?: string } | null)?.request_id;
    if (!requestId) {
      if (relay) await relay.abandon().catch(() => {});
      return {
        ok: false,
        mediaPath: null,
        text: started.text.slice(0, 400),
        blocked: false,
        message: `Video API returned no request_id. Response: ${started.text.slice(0, 300)}`,
        costUsd: 0,
        turns: 0,
      };
    }

    // Poll until done / failed / expired (up to ~12 minutes).
    const deadline = Date.now() + 12 * 60_000;
    let lastText = "";
    while (Date.now() < deadline) {
      const poll = await apiJson(
        "GET",
        `/videos/${requestId}`,
        auth.token,
        undefined,
        60_000,
      );
      lastText = poll.text;
      const data = poll.json as {
        status?: string;
        model?: string;
        error?: { message?: string; code?: string } | string;
        video?: { url?: string; duration?: number };
        usage?: { cost_in_usd_ticks?: number };
      } | null;

      const status = data?.status ?? (poll.status >= 400 ? "error" : "pending");
      if (status === "pending" || status === "processing" || status === "queued") {
        await sleep(4_000);
        continue;
      }

      if (status === "failed" || status === "expired" || status === "error" || poll.status >= 400) {
        const message =
          (typeof data?.error === "string"
            ? data.error
            : data?.error?.message) ||
          errorMessage(data, lastText.slice(0, 400) || `Video ${status}`);
        if (relay) await relay.abandon().catch(() => {});
        return {
          ok: false,
          mediaPath: null,
          text: message,
          blocked: isZdrError(message),
          message,
          costUsd: ticksToUsd(data?.usage?.cost_in_usd_ticks),
          turns: 0,
        };
      }

      if (status === "done") {
        const costUsd = ticksToUsd(data?.usage?.cost_in_usd_ticks);
        let mediaPath: string | null = null;

        if (relay) {
          try {
            mediaPath = await relay.collect();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Fall through to URL download if the API also returned a URL.
            if (!data?.video?.url) {
              return {
                ok: false,
                mediaPath: null,
                text: message,
                blocked: false,
                message: `Video finished but relay download failed: ${message}`,
                costUsd,
                turns: 0,
              };
            }
          }
        }

        if (!mediaPath && data?.video?.url) {
          const dir = await mkdtemp(join(tmpdir(), "canvas-grok-vid-"));
          mediaPath = join(dir, "out.mp4");
          await downloadToFile(data.video.url, mediaPath);
        }

        if (!mediaPath) {
          return {
            ok: false,
            mediaPath: null,
            text: lastText.slice(0, 400),
            blocked: false,
            message:
              "Video status=done but no video URL and no relay payload. " +
              "If this is a ZDR team, configure CANVAS_S3_* — see docs/zdr.md.",
            costUsd,
            turns: 0,
          };
        }

        return {
          ok: true,
          mediaPath,
          text: `video via ${data?.model ?? VIDEO_MODEL} (${auth.source})`,
          blocked: false,
          message: null,
          costUsd,
          turns: 0,
        };
      }

      await sleep(4_000);
    }

    if (relay) await relay.abandon().catch(() => {});
    return {
      ok: false,
      mediaPath: null,
      text: lastText.slice(0, 400),
      blocked: false,
      message: `Video generation timed out after 12 minutes (request_id=${requestId}).`,
      costUsd: 0,
      turns: 0,
    };
  } catch (err) {
    if (relay) await relay.abandon().catch(() => {});
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when session auth or an API key is available for Imagine. */
export async function grokAvailable(): Promise<boolean> {
  try {
    await loadGrokAuthAsync();
    return true;
  } catch {
    return false;
  }
}
