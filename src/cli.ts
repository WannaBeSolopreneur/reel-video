/**
 * The agent's interface.
 *
 * Every command accepts `--json` and prints a single machine-readable object,
 * so an agent never has to scrape prose to learn what happened. Exit codes are
 * meaningful: 0 success, 1 failure, 2 usage error.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addImageShot,
  addScene,
  addVideoShot,
  initProject,
  loadProject,
  removeShot,
  saveProject,
  setStoryboard,
  shotHash,
  updateShot,
} from "./project.ts";
import { runProject, type RunEvent } from "./runner.ts";
import { serve } from "./server.ts";
import type { Aspect, ImageProvider, Project } from "./types.ts";

/**
 * Load KEY=VALUE pairs from a dotenv file into process.env without overwriting
 * anything already set. No dependency — just enough for CANVAS_S3_* locally.
 */
function loadDotEnv(filePath: string): void {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Best-effort: open a URL in the default browser. Failure is silent — the URL
 * is already printed, and agents running headless should not care.
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Printing the URL is enough.
  }
}

const ASPECTS: Aspect[] = ["9:16", "1:1", "16:9", "4:3", "3:4"];

interface Args {
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(name, true);
    } else {
      flags.set(name, next);
      i += 1;
    }
  }
  return { positional, flags };
}

function str(args: Args, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function bool(args: Args, name: string): boolean {
  return args.flags.get(name) === true || args.flags.get(name) === "true";
}

/** Comma-separated shot ids: --refs img-1,img-2 */
function parseRefList(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? ids : undefined;
}

class UsageError extends Error {}

const HELP = `agent-canvas — an agent-operated canvas for short videos

Structure
  storyboard (1 multi-panel image)
    └── scene (~6s): first + middle + last frames → video

Usage
  canvas init [name]                          Create canvas/project.json
  canvas storyboard set <image-id>            Mark image as master storyboard
  canvas scene add --name <text>              Scaffold scene (3 frames + video)
        [--panels 1-4] [--provider codex|grok]
        [--duration 6|10] [--storyboard <id>]
  canvas add image --prompt <text>            Add a free image shot
        [--aspect 9:16|1:1|16:9|4:3|3:4]
        [--provider grok|codex] [--id <id>]
        [--refs img-1,img-2]
  canvas add video --from <id> --prompt <t>   Add a free video shot
        [--duration 6|10] [--id <id>] [--refs img-1]
  canvas set <id> --prompt <text>             Rewrite a prompt (marks it pending)
  canvas rm <id>                              Remove a shot
  canvas run [--shot <id>] [--force]          Generate pending shots
  canvas status                               Show storyboard, scenes, shots
  canvas serve [--port 4180] [--no-open]      Human review UI

Global
  --root <dir>   Project root (default: cwd)
  --json         Machine-readable output

Video needs a Grok account permission (once per user):
  grok            # interactive TUI
  /privacy        # Coding data, retention, and training → Opt in
Team ZDR accounts: tools.zdr_video_output_s3 — see docs/zdr.md.`;

function printProject(project: Project, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ ok: true, project }, null, 2));
    return;
  }
  if (project.shots.length === 0) {
    console.log("No shots yet. Try: canvas add image --prompt \"a goat on a hill\"");
    return;
  }
  console.log(`${project.name}  (${project.shots.length} shots · ${project.scenes.length} scenes)`);
  console.log(
    `  storyboard: ${project.storyboardId ?? "(none — canvas storyboard set <img-id>)"}`,
  );
  for (const scene of project.scenes) {
    const panels = scene.panels ? ` panels ${scene.panels}` : "";
    console.log(`  ${scene.id}  ${scene.name}${panels}`);
    console.log(
      `    frames: ${scene.frames.first} → ${scene.frames.middle} → ${scene.frames.last}`,
    );
    console.log(`    video:  ${scene.videoId}`);
  }
  console.log("  shots:");
  for (const shot of project.shots) {
    let detail =
      shot.kind === "image" ? `${shot.aspect} ${shot.provider}` : `${shot.duration}s from ${shot.from}`;
    if (shot.kind === "image" && shot.role === "storyboard") detail += " [storyboard]";
    if (shot.kind === "image" && shot.frame) detail += ` [${shot.frame}]`;
    if (shot.kind === "image" && shot.refs?.length) detail += ` refs:${shot.refs.join(",")}`;
    if (shot.kind === "video" && shot.refs?.length) detail += ` + ${shot.refs.join(",")}`;
    const stale =
      shot.status === "ready" && shot.hash !== shotHash(project, shot) ? " (stale)" : "";
    console.log(
      `  ${shot.id.padEnd(8)} ${shot.kind.padEnd(5)} ${shot.status.padEnd(8)}${stale} ${detail}`,
    );
    if (shot.message) console.log(`           ! ${shot.message.split("\n")[0]}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const json = bool(args, "json");
  const root = resolve(str(args, "root") ?? process.cwd());
  // Prefer project-local env, then cwd. Existing process env wins.
  loadDotEnv(resolve(root, ".env"));
  loadDotEnv(resolve(root, ".env.local"));
  loadDotEnv(resolve(process.cwd(), ".env"));
  const command = args.positional[0];

  if (!command || command === "help" || bool(args, "help")) {
    console.log(HELP);
    return command ? 0 : 2;
  }

  switch (command) {
    case "init": {
      const project = await initProject(root, args.positional[1]);
      if (json) console.log(JSON.stringify({ ok: true, project }, null, 2));
      else {
        console.log(`Created ${root}/canvas/project.json`);
        console.log("");
        console.log("Flow: storyboard image → canvas storyboard set <id> → canvas scene add --name …");
        console.log("Video permission: grok → /privacy → Opt in  (see README)");
      }
      return 0;
    }

    case "storyboard": {
      const sub = args.positional[1];
      if (sub !== "set") throw new UsageError("Usage: canvas storyboard set <image-id>");
      const imageId = args.positional[2];
      if (!imageId) throw new UsageError("Usage: canvas storyboard set <image-id>");
      const project = setStoryboard(await loadProject(root), imageId);
      await saveProject(root, project);
      if (json) console.log(JSON.stringify({ ok: true, storyboardId: imageId }, null, 2));
      else console.log(`Storyboard set to ${imageId}`);
      return 0;
    }

    case "scene": {
      const sub = args.positional[1];
      if (sub !== "add") throw new UsageError("Usage: canvas scene add --name <text> …");
      const name = str(args, "name");
      if (!name) throw new UsageError("--name is required");
      const provider = (str(args, "provider") ?? "codex") as ImageProvider;
      const durationRaw = str(args, "duration") ?? "6";
      if (durationRaw !== "6" && durationRaw !== "10") {
        throw new UsageError("--duration must be 6 or 10");
      }
      const aspectRaw = str(args, "aspect");
      const aspect = aspectRaw as Aspect | undefined;
      if (aspect && !ASPECTS.includes(aspect)) {
        throw new UsageError(`--aspect must be one of ${ASPECTS.join(", ")}`);
      }
      const { project, scene } = addScene(await loadProject(root), {
        name,
        panels: str(args, "panels"),
        storyboardId: str(args, "storyboard"),
        provider,
        aspect,
        duration: Number(durationRaw) as 6 | 10,
        firstPrompt: str(args, "first-prompt"),
        middlePrompt: str(args, "middle-prompt"),
        lastPrompt: str(args, "last-prompt"),
        videoPrompt: str(args, "video-prompt"),
      });
      await saveProject(root, project);
      if (json) console.log(JSON.stringify({ ok: true, scene }, null, 2));
      else {
        console.log(`Added ${scene.id} "${scene.name}"`);
        console.log(
          `  frames: ${scene.frames.first} → ${scene.frames.middle} → ${scene.frames.last}`,
        );
        console.log(`  video:  ${scene.videoId}`);
      }
      return 0;
    }

    case "add": {
      const kind = args.positional[1];
      const prompt = str(args, "prompt");
      if (!prompt) throw new UsageError("--prompt is required");
      const project = await loadProject(root);

      if (kind === "image") {
        const aspect = (str(args, "aspect") ?? "9:16") as Aspect;
        if (!ASPECTS.includes(aspect)) {
          throw new UsageError(`--aspect must be one of ${ASPECTS.join(", ")}`);
        }
        const provider = (str(args, "provider") ?? "grok") as ImageProvider;
        const refs = parseRefList(str(args, "refs"));
        const result = addImageShot(project, {
          prompt,
          aspect,
          provider,
          id: str(args, "id"),
          refs,
        });
        await saveProject(root, result.project);
        if (json) console.log(JSON.stringify({ ok: true, shot: result.shot }, null, 2));
        else {
          const r = result.shot.kind === "image" && result.shot.refs?.length
            ? ` (refs: ${result.shot.refs.join(", ")})`
            : "";
          console.log(`Added ${result.shot.id}${r}`);
        }
        return 0;
      }

      if (kind === "video") {
        const from = str(args, "from");
        if (!from) throw new UsageError("--from <image shot id> is required for video");
        const durationRaw = str(args, "duration") ?? "6";
        if (durationRaw !== "6" && durationRaw !== "10") {
          throw new UsageError("--duration must be 6 or 10");
        }
        const refs = parseRefList(str(args, "refs"));
        const result = addVideoShot(project, {
          prompt,
          from,
          duration: Number(durationRaw) as 6 | 10,
          id: str(args, "id"),
          refs,
        });
        await saveProject(root, result.project);
        if (json) console.log(JSON.stringify({ ok: true, shot: result.shot }, null, 2));
        else {
          const r = result.shot.kind === "video" && result.shot.refs?.length
            ? ` (style refs: ${result.shot.refs.join(", ")})`
            : "";
          console.log(`Added ${result.shot.id}${r}`);
        }
        return 0;
      }

      throw new UsageError("canvas add <image|video>");
    }

    case "set": {
      const id = args.positional[1];
      const prompt = str(args, "prompt");
      if (!id) throw new UsageError("canvas set <id> --prompt <text>");
      if (!prompt) throw new UsageError("--prompt is required");
      const project = await loadProject(root);
      const next = await saveProject(root, updateShot(project, id, { prompt, status: "pending" }));
      if (json) console.log(JSON.stringify({ ok: true, project: next }, null, 2));
      else console.log(`Updated ${id}`);
      return 0;
    }

    case "rm": {
      const id = args.positional[1];
      if (!id) throw new UsageError("canvas rm <id>");
      const project = await loadProject(root);
      await saveProject(root, removeShot(project, id));
      if (json) console.log(JSON.stringify({ ok: true, removed: id }, null, 2));
      else console.log(`Removed ${id}`);
      return 0;
    }

    case "run": {
      const project = await loadProject(root);
      const only = str(args, "shot");
      const events: RunEvent[] = [];
      const { summary } = await runProject(project, {
        root,
        shotIds: only ? [only] : undefined,
        force: bool(args, "force"),
        onEvent: (event) => {
          events.push(event);
          if (!json && event.status !== "running") {
            const suffix = event.message ? ` — ${event.message.split("\n")[0]}` : "";
            console.log(`  ${event.shotId.padEnd(8)} ${event.status}${suffix}`);
          }
        },
      });
      if (json) {
        console.log(JSON.stringify({ ok: summary.failed === 0, summary, events }, null, 2));
      } else {
        console.log(
          `\n${summary.ready} ready · ${summary.skipped} skipped · ` +
            `${summary.failed} failed · ${summary.blocked} blocked · ` +
            `$${summary.costUsd.toFixed(4)}`,
        );
      }
      return summary.failed > 0 ? 1 : 0;
    }

    case "status": {
      printProject(await loadProject(root), json);
      return 0;
    }

    case "serve": {
      const port = Number(str(args, "port") ?? 4180);
      const noOpen = bool(args, "no-open");
      await loadProject(root); // Fail fast if there is no canvas here.
      const { port: bound } = await serve({ root, port });
      const url = `http://localhost:${bound}`;
      console.log(`Canvas review UI  →  ${url}`);
      console.log("Ctrl-C to stop.");
      // Agents and headless runs pass --no-open (or --json); humans get a tab.
      if (!noOpen && !json) openBrowser(url);
      await new Promise(() => {}); // Serve until interrupted.
      return 0;
    }

    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

const isUsage = (err: unknown): err is UsageError => err instanceof UsageError;

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(isUsage(err) ? `${message}\n\n${HELP}` : `Error: ${message}`);
    }
    process.exit(isUsage(err) ? 2 : 1);
  });
