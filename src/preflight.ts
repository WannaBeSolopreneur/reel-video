/**
 * Runtime dependency checks.
 *
 * Scene frames are ffmpeg crops of the strip (see crop.ts) and `canvas stitch`
 * concatenates with ffmpeg too. Without it the core scene path fails partway
 * through — after the user has already paid for a strip generation. Check up
 * front and say exactly how to fix it.
 */

import { spawn } from "node:child_process";

function probe(bin: string, args: string[], timeoutMs = 5_000): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (code: number) => {
      if (!settled) {
        settled = true;
        resolve(code);
      }
    };
    try {
      const child = spawn(bin, args, { stdio: "ignore" });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done(127);
      }, timeoutMs);
      child.on("error", () => {
        clearTimeout(timer);
        done(127);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done(code ?? 127);
      });
    } catch {
      done(127);
    }
  });
}

/** True when the binary is callable on PATH. */
export async function hasBin(bin: string): Promise<boolean> {
  const code = await probe(bin, ["-version"]);
  if (code === 0 || code === 1) return true;
  return (await probe("which", [bin])) === 0;
}

export interface MediaToolReport {
  /** ffmpeg + ffprobe both present. */
  ffmpeg: boolean;
  /** macOS sips fallback present. */
  sips: boolean;
  /** Cropping is possible at all. */
  canCrop: boolean;
  /** `canvas stitch` is possible (ffmpeg only — sips cannot join video). */
  canStitch: boolean;
}

export async function checkMediaTools(): Promise<MediaToolReport> {
  const [ffmpeg, ffprobe, sips] = await Promise.all([
    hasBin("ffmpeg"),
    hasBin("ffprobe"),
    hasBin("sips"),
  ]);
  const haveFfmpeg = ffmpeg && ffprobe;
  return {
    ffmpeg: haveFfmpeg,
    sips,
    canCrop: haveFfmpeg || sips,
    canStitch: haveFfmpeg,
  };
}

/** Per-OS install line for the current platform. */
export function ffmpegInstallHint(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case "darwin":
      return "brew install ffmpeg";
    case "win32":
      return "winget install Gyan.FFmpeg   (or: choco install ffmpeg)";
    default:
      return "sudo apt install ffmpeg   (Debian/Ubuntu)\n  sudo dnf install ffmpeg   (Fedora)\n  sudo pacman -S ffmpeg     (Arch)";
  }
}

/**
 * Human-readable preflight block. Returns null when everything needed is
 * present, otherwise the message to print.
 */
export function describeMediaTools(report: MediaToolReport): string | null {
  if (report.ffmpeg) return null;

  const hint = ffmpegInstallHint();

  if (report.canCrop) {
    // sips can crop stills but cannot concatenate video.
    return [
      "WARNING: ffmpeg not found (using macOS sips for crops).",
      "  Scene frames will work. `canvas stitch` will NOT — it needs ffmpeg.",
      "",
      `  Install:  ${hint}`,
    ].join("\n");
  }

  return [
    "ffmpeg is required and was not found on PATH.",
    "",
    "  Scene frames are ffmpeg crops of the scene strip, so without it a scene",
    "  cannot produce first/middle/last frames or a video.",
    "",
    `  Install:  ${hint}`,
    "",
    "  Then re-run this command. To scaffold anyway, pass --skip-checks.",
  ].join("\n");
}
