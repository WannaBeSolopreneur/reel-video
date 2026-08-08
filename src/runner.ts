/**
 * Turning pending shots into files on disk.
 *
 * The runner owns every filesystem decision. Generation backends hand back a
 * path to something they produced; this module decides where it belongs, copies
 * it, and records the result. No backend is ever told where to write.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { generateImageWithCodex } from "./codex.ts";
import { animateImage, generateImage } from "./grok.ts";
import {
  assetsDir,
  findShot,
  needsRun,
  pendingShots,
  projectDir,
  saveProject,
  shotHash,
  updateShot,
} from "./project.ts";
import { ASSETS_DIRNAME } from "./project.ts";
import type { Project, Shot } from "./types.ts";

export interface RunEvent {
  shotId: string;
  status: "skipped" | "running" | "ready" | "error" | "blocked";
  message?: string;
  costUsd?: number;
}

export interface RunOptions {
  root: string;
  shotIds?: string[];
  force?: boolean;
  onEvent?: (event: RunEvent) => void;
}

export interface RunSummary {
  ready: number;
  skipped: number;
  failed: number;
  blocked: number;
  costUsd: number;
}

/**
 * Copy generated media into the project and return its project-relative path.
 * The extension follows whatever the backend actually produced — Grok returns
 * JPEG even when asked for PNG, and renaming it would be a lie.
 */
async function adoptMedia(root: string, shotId: string, sourcePath: string): Promise<string> {
  const extension = extname(sourcePath).toLowerCase() || ".bin";
  const filename = `${shotId}${extension}`;
  await mkdir(assetsDir(root), { recursive: true });
  const dest = join(assetsDir(root), filename);
  if (sourcePath !== dest) {
    await copyFile(sourcePath, dest);
  }
  return `${ASSETS_DIRNAME}/${filename}`;
}

/** Absolute asset paths for image shot ids that are ready (for refs). */
function resolvedImagePaths(
  root: string,
  project: Project,
  ids: string[] | undefined,
): string[] {
  if (!ids?.length) return [];
  const paths: string[] = [];
  for (const id of ids) {
    const shot = findShot(project, id);
    if (shot?.kind === "image" && shot.asset) {
      paths.push(join(projectDir(root), shot.asset));
    }
  }
  return paths;
}

async function runImageShot(
  root: string,
  project: Project,
  shot: Shot & { kind: "image" },
): Promise<{ project: Project; event: RunEvent }> {
  const refPaths = resolvedImagePaths(root, project, shot.refs);
  const missingRefs = (shot.refs ?? []).filter((id) => {
    const s = findShot(project, id);
    return !s || s.kind !== "image" || !s.asset;
  });
  if (missingRefs.length) {
    const message = `Style refs not ready yet: ${missingRefs.join(", ")}. Generate those images first.`;
    return {
      project: updateShot(project, shot.id, { status: "error", message }),
      event: { shotId: shot.id, status: "error", message },
    };
  }

  const result =
    shot.provider === "codex"
      ? await generateImageWithCodex({
          prompt: shot.prompt,
          aspect: shot.aspect,
          workDir: assetsDir(root),
          outPath: join(assetsDir(root), `${shot.id}.png`),
          referenceImagePaths: refPaths,
        })
      : await generateImage({
          prompt:
            refPaths.length > 0
              ? `${shot.prompt}\n\nVisual continuity: match character and style of prior board(s) at: ${refPaths.join(", ")}`
              : shot.prompt,
          aspect: shot.aspect,
          cwd: projectDir(root),
        });

  if (!result.ok || !result.mediaPath) {
    return {
      project: updateShot(project, shot.id, {
        status: result.blocked ? "blocked" : "error",
        message: result.message,
      }),
      event: {
        shotId: shot.id,
        status: result.blocked ? "blocked" : "error",
        message: result.message ?? undefined,
        costUsd: result.costUsd,
      },
    };
  }

  // Codex may have already written into assets/; still normalize via adoptMedia
  // so the extension matches what was produced.
  const asset = await adoptMedia(root, shot.id, result.mediaPath);
  const next = updateShot(project, shot.id, {
    status: "ready",
    asset,
    message: null,
    hash: shotHash(project, shot),
  });
  return {
    project: next,
    event: { shotId: shot.id, status: "ready", costUsd: result.costUsd },
  };
}

async function runVideoShot(
  root: string,
  project: Project,
  shot: Shot & { kind: "video" },
): Promise<{ project: Project; event: RunEvent }> {
  const source = findShot(project, shot.from);
  if (!source || source.kind !== "image" || !source.asset) {
    const message = `Source frame ${shot.from} has no image yet. Run it first.`;
    return {
      project: updateShot(project, shot.id, { status: "error", message }),
      event: { shotId: shot.id, status: "error", message },
    };
  }

  // Prior boards (shot.refs) lock style; primary is always `from` (sourcePath).
  const stylePaths = resolvedImagePaths(root, project, shot.refs);
  const result = await animateImage({
    prompt: shot.prompt,
    sourcePath: join(projectDir(root), source.asset),
    referencePaths: stylePaths,
    aspect: source.kind === "image" ? source.aspect : "9:16",
    duration: shot.duration,
    cwd: projectDir(root),
  });

  if (!result.ok || !result.mediaPath) {
    let message = result.message;
    if (result.blocked) {
      message =
        (result.message ?? "Video blocked.") +
        " If this is a ZDR / coding-retention error, opt in via Grok `/privacy` " +
        "or configure tools.zdr_video_output_s3 — see docs/zdr.md.";
    } else if (!result.mediaPath && result.ok) {
      message =
        "Video tool reported success but no media was found in the session directory.";
    }
    return {
      project: updateShot(project, shot.id, {
        status: result.blocked ? "blocked" : "error",
        message,
      }),
      event: {
        shotId: shot.id,
        status: result.blocked ? "blocked" : "error",
        message: message ?? undefined,
        costUsd: result.costUsd,
      },
    };
  }

  const asset = await adoptMedia(root, shot.id, result.mediaPath);
  const next = updateShot(project, shot.id, {
    status: "ready",
    asset,
    message: null,
    hash: shotHash(project, shot),
  });
  return {
    project: next,
    event: { shotId: shot.id, status: "ready", costUsd: result.costUsd },
  };
}

/**
 * Run shots one at a time. Serial on purpose: these calls cost real money, and
 * a video depends on its source image having finished.
 */
export async function runProject(
  startingProject: Project,
  options: RunOptions,
): Promise<{ project: Project; summary: RunSummary }> {
  let project = startingProject;
  const summary: RunSummary = { ready: 0, skipped: 0, failed: 0, blocked: 0, costUsd: 0 };
  const force = options.force ?? false;

  for (const candidate of pendingShots(project, options.shotIds)) {
    // Re-read: an earlier shot in this run may have changed it.
    const shot = findShot(project, candidate.id);
    if (!shot) continue;

    if (!needsRun(project, shot, force)) {
      summary.skipped += 1;
      options.onEvent?.({ shotId: shot.id, status: "skipped" });
      continue;
    }

    project = await saveProject(
      options.root,
      updateShot(project, shot.id, { status: "running", message: null }),
    );
    options.onEvent?.({ shotId: shot.id, status: "running" });

    let outcome: { project: Project; event: RunEvent };
    try {
      outcome =
        shot.kind === "image"
          ? await runImageShot(options.root, project, shot)
          : await runVideoShot(options.root, project, shot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome = {
        project: updateShot(project, shot.id, { status: "error", message }),
        event: { shotId: shot.id, status: "error", message },
      };
    }

    project = await saveProject(options.root, outcome.project);
    summary.costUsd += outcome.event.costUsd ?? 0;
    if (outcome.event.status === "ready") summary.ready += 1;
    else if (outcome.event.status === "blocked") summary.blocked += 1;
    else if (outcome.event.status === "error") summary.failed += 1;
    options.onEvent?.(outcome.event);
  }

  return { project, summary };
}
