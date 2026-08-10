/**
 * `canvas serve` — the human's window into a canvas an agent is building.
 *
 * Built on node:http with no framework and no dependencies. Every response is
 * either rendered HTML, a media file, or JSON; there is no client-side state to
 * get out of sync and nothing to leak.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, extname, join, normalize, relative, resolve, sep } from "node:path";
import { assetsDir, findScene, loadProject, saveProject, updateShot } from "./project.ts";
import {
  refreshMotionPromptFromStrip,
  restoreHistoryAsset,
  runProject,
} from "./runner.ts";
import { stitchScenes } from "./stitch.ts";
import type { ImageProvider, Project, Shot } from "./types.ts";
import { renderPage } from "./views.ts";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

/** One run at a time. A second click while a run is in flight is a no-op. */
let running = false;

async function readBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Prompts are text; anything larger than this is not a prompt.
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function redirectHome(res: ServerResponse): void {
  res.writeHead(303, { Location: "/" });
  res.end();
}

/**
 * Kick a run off without holding the request open. The page shows `running`
 * and refreshes itself until the runner is done.
 */
function startRun(root: string, shotIds?: string[], force = false): void {
  if (running) return;
  running = true;
  void (async () => {
    try {
      const project = await loadProject(root);
      // Explicit shot lists (Re-animate / Run scene) always force so a ready
      // shot is not skipped as "unchanged".
      const shouldForce = force || Boolean(shotIds?.length);
      await runProject(project, { root, shotIds, force: shouldForce });
    } catch (err) {
      console.error("[canvas] run failed:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
      // If anything is still marked running after the loop, clear it so the UI
      // does not auto-refresh forever after a crash/interrupt.
      try {
        await clearStuckRunning(root);
      } catch {
        // ignore
      }
    }
  })();
}

/**
 * Shots left as `running` after serve restarts or a crashed generation would
 * otherwise trigger infinite page refresh. Reset them to pending when no live
 * run is in flight.
 */
async function clearStuckRunning(root: string): Promise<Project> {
  let project = await loadProject(root);
  if (running) return project;
  let dirty = false;
  for (const shot of project.shots) {
    if (shot.status === "running") {
      project = updateShot(project, shot.id, {
        status: "pending",
        message: "Interrupted — click Generate to retry",
      });
      dirty = true;
    }
  }
  if (dirty) project = await saveProject(root, project);
  return project;
}

/**
 * Serve files under canvas/assets/, including history/ subfolders.
 * Rejects path traversal; only relative paths inside assetsDir are allowed.
 */
async function serveAsset(root: string, name: string, res: ServerResponse): Promise<void> {
  const decoded = decodeURIComponent(name).replace(/^\/+/, "");
  // Normalize and ensure the resolved path stays under assets/.
  const assetsRoot = resolve(assetsDir(root));
  const candidate = resolve(assetsRoot, decoded);
  const rel = relative(assetsRoot, candidate);
  if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`) || rel === "..") {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad path");
    return;
  }
  // Only allow simple relative segments (history/vid-1/file.mp4).
  if (rel.split(sep).some((part) => part === "" || part === "." || part === "..")) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad path");
    return;
  }
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("not a file");
    const ext = extname(candidate).toLowerCase();
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(info.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    createReadStream(candidate).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

export interface ServeOptions {
  root: string;
  port: number;
  host?: string;
}

export function serve(options: ServeOptions): Promise<{ port: number; close: () => Promise<void> }> {
  const { root } = options;

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`Error: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/") {
      // Heal orphaned "running" markers before rendering (unless a live run owns them).
      const project = running ? await loadProject(root) : await clearStuckRunning(root);
      const html = renderPage(project, root, { liveRun: running });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    }

    if (req.method === "GET" && path === "/api/project") {
      const project = running ? await loadProject(root) : await clearStuckRunning(root);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ...project, running }, null, 2));
      return;
    }

    if (req.method === "GET" && path.startsWith("/assets/")) {
      await serveAsset(root, path.slice("/assets/".length), res);
      return;
    }

    if (req.method === "POST" && path === "/run") {
      startRun(root);
      redirectHome(res);
      return;
    }

    if (req.method === "POST" && path === "/stitch") {
      const project = await loadProject(root);
      const result = await stitchScenes(project, root);
      if (!result.ok) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Stitch failed</title>
           <p>${result.message ?? "Stitch failed"}</p>
           <p><a href="/">← Back</a></p>`,
        );
        return;
      }
      redirectHome(res);
      return;
    }

    // Run one scene end-to-end: strip → crops → video.
    const sceneRunMatch = /^\/scene\/([^/]+)\/run$/.exec(path);
    if (req.method === "POST" && sceneRunMatch) {
      const sceneId = decodeURIComponent(sceneRunMatch[1]!);
      const project = await loadProject(root);
      const scene = findScene(project, sceneId);
      if (scene) {
        const ids = [
          ...(scene.stripId ? [scene.stripId] : []),
          scene.frames.first,
          scene.frames.middle,
          scene.frames.last,
          scene.videoId,
        ];
        startRun(root, ids);
      }
      redirectHome(res);
      return;
    }

    const promptMatch = /^\/shot\/([^/]+)\/prompt$/.exec(path);
    if (req.method === "POST" && promptMatch) {
      const id = decodeURIComponent(promptMatch[1]!);
      const body = await readBody(req);
      const prompt = body.get("prompt") ?? "";
      const providerRaw = body.get("provider");
      const project = await loadProject(root);
      const shot = project.shots.find((candidate) => candidate.id === id);
      const patch: Partial<Shot> & { provider?: ImageProvider } = {
        prompt,
        status: "pending",
      };
      // Provider switch (image shots only) also invalidates a ready asset.
      if (
        shot?.kind === "image" &&
        (providerRaw === "grok" || providerRaw === "codex") &&
        shot.provider !== providerRaw
      ) {
        patch.provider = providerRaw;
      }
      await saveProject(root, updateShot(project, id, patch));
      redirectHome(res);
      return;
    }

    const runMatch = /^\/shot\/([^/]+)\/run$/.exec(path);
    if (req.method === "POST" && runMatch) {
      const id = decodeURIComponent(runMatch[1]!);
      // The Generate button lives inside the prompt form, so an edit the human
      // made but did not explicitly save still takes effect on this run.
      const body = await readBody(req);
      const prompt = body.get("prompt");
      const providerRaw = body.get("provider");
      const project = await loadProject(root);
      const shot = project.shots.find((candidate) => candidate.id === id);
      if (shot) {
        const patch: Partial<Shot> & { provider?: ImageProvider } = {};
        if (prompt !== null && shot.prompt !== prompt) patch.prompt = prompt;
        if (
          shot.kind === "image" &&
          (providerRaw === "grok" || providerRaw === "codex") &&
          shot.provider !== providerRaw
        ) {
          patch.provider = providerRaw;
          patch.status = "pending";
        }
        if (Object.keys(patch).length > 0) {
          await saveProject(root, updateShot(project, id, patch));
        }
      }
      startRun(root, [id], true);
      redirectHome(res);
      return;
    }

    // Rewrite video motion prompt by vision-reviewing the scene strip/crops.
    const motionMatch = /^\/shot\/([^/]+)\/motion-from-strip$/.exec(path);
    if (req.method === "POST" && motionMatch) {
      const id = decodeURIComponent(motionMatch[1]!);
      try {
        const project = await loadProject(root);
        const result = await refreshMotionPromptFromStrip(root, project, id);
        if (!result.prompt) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><meta charset="utf-8"><title>Motion review failed</title>
             <p>${result.message ?? "Could not write motion prompt from strip."}</p>
             <p><a href="/">← Back</a></p>`,
          );
          return;
        }
        await saveProject(root, result.project);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Motion review failed</title>
           <p>${err instanceof Error ? err.message : String(err)}</p>
           <p><a href="/">← Back</a></p>`,
        );
        return;
      }
      redirectHome(res);
      return;
    }

    // Restore a previous generation as the active asset (from history).
    const restoreMatch = /^\/shot\/([^/]+)\/restore$/.exec(path);
    if (req.method === "POST" && restoreMatch) {
      const id = decodeURIComponent(restoreMatch[1]!);
      const body = await readBody(req);
      const historyAsset = body.get("asset");
      if (!historyAsset) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing asset");
        return;
      }
      try {
        const project = await loadProject(root);
        const next = await restoreHistoryAsset(root, project, id, historyAsset);
        await saveProject(root, next);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Restore failed</title>
           <p>${err instanceof Error ? err.message : String(err)}</p>
           <p><a href="/">← Back</a></p>`,
        );
        return;
      }
      redirectHome(res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Loopback by default: this canvas is not something to expose.
    server.listen(options.port, options.host ?? "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
