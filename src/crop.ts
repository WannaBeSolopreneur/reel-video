/**
 * Crop a horizontal 3-panel strip into left / middle / right panels.
 * Uses ffmpeg (preferred) or macOS sips — no npm image deps.
 */

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { StripPanel } from "./types.ts";

function run(
  bin: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out`));
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

async function binExists(bin: string): Promise<boolean> {
  try {
    const { code } = await run(bin, ["-version"], 5_000);
    return code === 0 || code === 1; // sips -version may differ; try which-style
  } catch {
    try {
      const { code } = await run("which", [bin], 5_000);
      return code === 0;
    } catch {
      return false;
    }
  }
}

async function probeSize(
  path: string,
): Promise<{ width: number; height: number }> {
  // ffprobe
  try {
    const { code, output } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0:s=x",
        path,
      ],
      15_000,
    );
    if (code === 0) {
      const m = /(\d+)x(\d+)/.exec(output.trim());
      if (m) return { width: Number(m[1]), height: Number(m[2]) };
    }
  } catch {
    // fall through
  }
  // sips (macOS)
  const { code, output } = await run(
    "sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", path],
    15_000,
  );
  if (code !== 0) {
    throw new Error(`Could not read image size for ${path}: ${output.slice(0, 200)}`);
  }
  const w = /pixelWidth:\s*(\d+)/.exec(output);
  const h = /pixelHeight:\s*(\d+)/.exec(output);
  if (!w || !h) {
    throw new Error(`Could not parse image size for ${path}`);
  }
  return { width: Number(w[1]), height: Number(h[1]) };
}

function panelRect(
  width: number,
  height: number,
  panel: StripPanel,
): { x: number; y: number; w: number; h: number } {
  // Equal thirds with a small gutter inset so panel borders don't dominate.
  const third = Math.floor(width / 3);
  const gutter = Math.max(2, Math.floor(third * 0.02));
  const index = panel === "left" ? 0 : panel === "middle" ? 1 : 2;
  const x = index * third + gutter;
  const w = third - gutter * 2;
  const y = gutter;
  const h = height - gutter * 2;
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    w: Math.max(1, w),
    h: Math.max(1, h),
  };
}

/**
 * Crop `sourcePath` to the given strip panel and write PNG/JPEG to `outPath`.
 */
export async function cropStripPanel(
  sourcePath: string,
  panel: StripPanel,
  outPath: string,
): Promise<void> {
  await access(sourcePath);
  await mkdir(dirname(outPath), { recursive: true });
  const { width, height } = await probeSize(sourcePath);
  if (width < 30 || height < 10) {
    throw new Error(`Source image too small to crop into thirds (${width}x${height})`);
  }
  const { x, y, w, h } = panelRect(width, height, panel);

  // Prefer ffmpeg crop filter.
  try {
    const { code, output } = await run(
      "ffmpeg",
      [
        "-y",
        "-i",
        sourcePath,
        "-vf",
        `crop=${w}:${h}:${x}:${y}`,
        "-frames:v",
        "1",
        outPath,
      ],
      60_000,
    );
    if (code === 0) return;
    throw new Error(output.slice(0, 400) || `ffmpeg exit ${code}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // macOS sips: cropToHeightWidth from top-left is awkward; try cropOffset path.
    // sips --cropOffset offsetY offsetX --cropToHeightWidth H W
    try {
      const { code, output } = await run(
        "sips",
        [
          "--cropOffset",
          String(y),
          String(x),
          "--cropToHeightWidth",
          String(h),
          String(w),
          sourcePath,
          "--out",
          outPath,
        ],
        60_000,
      );
      if (code === 0) return;
      throw new Error(
        `Crop failed (ffmpeg: ${msg}; sips: ${output.slice(0, 200)})`,
      );
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(
        `Could not crop strip panel "${panel}". Install ffmpeg or use macOS sips. ${msg2}`,
      );
    }
  }
}
