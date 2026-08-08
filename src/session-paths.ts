/**
 * Where Grok Build puts generated media, and how we get it back.
 *
 * This module exists because of one observed fact: `image_gen` does not take an
 * output path. It generates into the session's own directory and leaves it
 * there. Getting the file to a chosen location therefore requires a shell, and
 * handing an agent a shell is exactly how this project previously ended up
 * spawning a public tunnel (see docs/zdr.md).
 *
 * The way out is to stop asking the agent to move files. Grok accepts
 * `--session-id`, and lays sessions out at a derivable path, so we pick the id,
 * let the agent do nothing but generate, and collect the bytes ourselves.
 *
 *   ~/.grok/sessions/<encodeURIComponent(cwd)>/<sessionId>/images/1.jpg
 *
 * Verified against grok 0.2.112: the directory key is exactly
 * `encodeURIComponent(cwd)`, and generated media lands under the session dir.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";

/** Extensions Grok is known to emit. Images arrive as .jpg even when asked for PNG. */
const MEDIA_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm"]);

export function grokSessionsRoot(): string {
  return join(homedir(), ".grok", "sessions");
}

/**
 * The per-directory session bucket. Grok scopes sessions to the working
 * directory, URL-encoding the absolute path into a single path segment.
 */
export function sessionDirFor(cwd: string, sessionId: string): string {
  return join(grokSessionsRoot(), encodeURIComponent(cwd), sessionId);
}

export interface CollectedMedia {
  path: string;
  bytes: number;
  modifiedMs: number;
}

/**
 * Recursively gather media written during a session, newest last.
 *
 * We scan rather than hardcode `images/1.jpg` because video output has not been
 * observed to land in the same subdirectory, and guessing wrong would surface
 * as a confusing "generation succeeded but no file" error. Scanning is cheap:
 * a fresh session directory holds a handful of files.
 */
export async function collectSessionMedia(sessionDir: string): Promise<CollectedMedia[]> {
  const found: CollectedMedia[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // Session directory may not exist if grok failed before writing.
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      if (!MEDIA_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) continue;
      const info = await stat(full);
      found.push({ path: full, bytes: info.size, modifiedMs: info.mtimeMs });
    }
  }

  await walk(sessionDir);
  found.sort((a, b) => a.modifiedMs - b.modifiedMs);
  return found;
}

/** The file a single-generation run produced, or null if it produced none. */
export async function newestSessionMedia(sessionDir: string): Promise<CollectedMedia | null> {
  const media = await collectSessionMedia(sessionDir);
  return media.length > 0 ? media[media.length - 1]! : null;
}
