/**
 * ZDR video relay: give xAI a public PUT target, pull the result back local,
 * delete the remote object.
 *
 * Two ways to supply a target:
 *
 * 1. S3-compatible credentials (preferred) — mint a unique presigned PUT per
 *    run via CANVAS_S3_* env vars. Works with Cloudflare R2, Railway buckets,
 *    S3, MinIO, etc.
 *
 * 2. Static CANVAS_UPLOAD_URL — a single pre-minted PUT URL. Fine for one-off
 *    tests; concurrent runs will clobber each other. Optional CANVAS_DOWNLOAD_URL
 *    if GET needs a different signature (defaults to the upload URL).
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteObject,
  getObjectToFile,
  hasS3Config,
  mintRelayPut,
  type S3Config,
} from "./s3.ts";

export interface RelayHandle {
  /** Presigned (or static) URL xAI should PUT the finished video to. */
  uploadUrl: string;
  /**
   * After the tool finishes, fetch the video to a local temp file and return
   * its path. Cleans the remote object when possible.
   */
  collect: () => Promise<string>;
  /** Best-effort cleanup if generation fails mid-flight. */
  abandon: () => Promise<void>;
}

export function relayConfigured(): boolean {
  return hasS3Config() || Boolean(process.env.CANVAS_UPLOAD_URL?.trim());
}

export function createVideoRelay(shotId: string): RelayHandle | null {
  const minted = mintRelayPut(`${shotId}-${randomUUID()}.mp4`);
  if (minted) return s3Relay(minted.config, minted.putUrl, minted.key);

  const staticUrl = process.env.CANVAS_UPLOAD_URL?.trim();
  if (staticUrl) return staticRelay(staticUrl);

  return null;
}

function s3Relay(config: S3Config, putUrl: string, key: string): RelayHandle {
  return {
    uploadUrl: putUrl,
    async collect() {
      const dir = await mkdtemp(join(tmpdir(), "canvas-relay-"));
      const dest = join(dir, "video.mp4");
      try {
        await getObjectToFile(config, key, dest);
      } catch (err) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
      // Delete remote after a successful pull so the bucket stays a relay.
      try {
        await deleteObject(config, key);
      } catch {
        // Local copy is what matters; leave a breadcrumb on stderr.
        console.error(`[canvas] warning: could not delete relay object ${key}`);
      }
      return dest;
    },
    async abandon() {
      try {
        await deleteObject(config, key);
      } catch {
        // ignore
      }
    },
  };
}

function staticRelay(uploadUrl: string): RelayHandle {
  const downloadUrl = process.env.CANVAS_DOWNLOAD_URL?.trim() || uploadUrl;
  return {
    uploadUrl,
    async collect() {
      const dir = await mkdtemp(join(tmpdir(), "canvas-relay-"));
      const dest = join(dir, "video.mp4");
      const res = await fetch(downloadUrl);
      if (!res.ok) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        throw new Error(
          `Failed to download video from CANVAS_UPLOAD_URL (${res.status})`,
        );
      }
      const { writeFile } = await import("node:fs/promises");
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return dest;
    },
    async abandon() {
      // Cannot delete without credentials.
    },
  };
}
