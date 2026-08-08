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
import { basename, extname, join } from "node:path";
import { assetsDir, loadProject, saveProject, updateShot } from "./project.ts";
import { runProject } from "./runner.ts";
import type { ImageProvider, Shot } from "./types.ts";
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
function startRun(root: string, shotIds?: string[]): void {
  if (running) return;
  running = true;
  void (async () => {
    try {
      const project = await loadProject(root);
      await runProject(project, { root, shotIds });
    } catch (err) {
      console.error("[canvas] run failed:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  })();
}

async function serveAsset(root: string, name: string, res: ServerResponse): Promise<void> {
  // basename() strips any traversal attempt before it reaches the filesystem.
  const safe = basename(decodeURIComponent(name));
  const file = join(assetsDir(root), safe);
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(safe).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(info.size),
      // Safe because the URL carries the content hash: new bytes, new URL.
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    createReadStream(file).pipe(res);
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
      const project = await loadProject(root);
      const html = renderPage(project, root);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    }

    if (req.method === "GET" && path === "/api/project") {
      const project = await loadProject(root);
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
      startRun(root, [id]);
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
