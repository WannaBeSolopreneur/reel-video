/**
 * Concatenate ready scene videos (in scene order) into one file via ffmpeg.
 * Uses filter_complex concat so video + audio both survive the join.
 */

import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { assetsDir, findShot, projectDir } from "./project.ts";
import type { Project } from "./types.ts";

export const STITCHED_FILENAME = "stitched.mp4";

export function stitchedAssetPath(root: string): string {
  return join(assetsDir(root), STITCHED_FILENAME);
}

export function stitchedPublicUrl(mtimeMs?: number): string {
  const v = mtimeMs != null ? String(Math.floor(mtimeMs)) : "0";
  return `/assets/${STITCHED_FILENAME}?v=${encodeURIComponent(v)}`;
}

function runFfmpeg(args: string[], timeoutMs = 5 * 60_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg stitch timed out"));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          err instanceof Error && err.message.includes("ENOENT")
            ? "ffmpeg not found on PATH (required to stitch scenes)."
            : err instanceof Error
              ? err.message
              : String(err),
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

export interface SceneVideoClip {
  sceneId: string;
  sceneName: string;
  videoId: string;
  absolutePath: string;
}

/** Scene videos that are ready, in project.scenes order. */
export function readySceneVideos(project: Project, root: string): SceneVideoClip[] {
  const clips: SceneVideoClip[] = [];
  for (const scene of project.scenes) {
    const shot = findShot(project, scene.videoId);
    if (!shot || shot.kind !== "video" || shot.status !== "ready" || !shot.asset) {
      continue;
    }
    clips.push({
      sceneId: scene.id,
      sceneName: scene.name,
      videoId: shot.id,
      absolutePath: join(projectDir(root), shot.asset),
    });
  }
  return clips;
}

export interface StitchResult {
  ok: boolean;
  path: string | null;
  relativeAsset: string | null;
  clips: SceneVideoClip[];
  missing: { sceneId: string; sceneName: string; videoId: string; reason: string }[];
  message: string | null;
}

/**
 * Stitch all ready scene videos into canvas/assets/stitched.mp4.
 * Requires at least 2 ready scene videos. Re-encodes video + audio.
 */
export async function stitchScenes(project: Project, root: string): Promise<StitchResult> {
  const missing: StitchResult["missing"] = [];
  for (const scene of project.scenes) {
    const shot = findShot(project, scene.videoId);
    if (!shot || shot.kind !== "video") {
      missing.push({
        sceneId: scene.id,
        sceneName: scene.name,
        videoId: scene.videoId,
        reason: "video shot missing",
      });
      continue;
    }
    if (shot.status !== "ready" || !shot.asset) {
      missing.push({
        sceneId: scene.id,
        sceneName: scene.name,
        videoId: shot.id,
        reason: `video is ${shot.status}, not ready`,
      });
    }
  }

  const clips = readySceneVideos(project, root);
  if (clips.length < 2) {
    return {
      ok: false,
      path: null,
      relativeAsset: null,
      clips,
      missing,
      message:
        clips.length === 0
          ? "No ready scene videos to stitch. Finish scene videos first."
          : "Need at least 2 ready scene videos to stitch (only 1 is ready).",
    };
  }

  for (const clip of clips) {
    try {
      await access(clip.absolutePath);
    } catch {
      return {
        ok: false,
        path: null,
        relativeAsset: null,
        clips,
        missing,
        message: `Missing file for ${clip.videoId}: ${clip.absolutePath}`,
      };
    }
  }

  await mkdir(assetsDir(root), { recursive: true });
  const outPath = stitchedAssetPath(root);
  const n = clips.length;

  // [0:v][0:a][1:v][1:a]...concat=n:v=1:a=1[v][a]
  const labels = clips.map((_, i) => `[${i}:v][${i}:a]`).join("");
  const filter = `${labels}concat=n=${n}:v=1:a=1[v][a]`;
  const inputArgs = clips.flatMap((c) => ["-i", c.absolutePath]);

  const { code, output } = await runFfmpeg([
    "-y",
    ...inputArgs,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outPath,
  ]);

  if (code !== 0) {
    return {
      ok: false,
      path: null,
      relativeAsset: null,
      clips,
      missing,
      message: `ffmpeg failed (exit ${code}): ${output.slice(-500)}`,
    };
  }

  return {
    ok: true,
    path: outPath,
    relativeAsset: `assets/${STITCHED_FILENAME}`,
    clips,
    missing,
    message: null,
  };
}
