/**
 * Turning pending shots into files on disk.
 *
 * The runner owns every filesystem decision. Generation backends hand back a
 * path to something they produced; this module decides where it belongs, copies
 * it, and records the result. No backend is ever told where to write.
 */

import { access, copyFile, mkdir, rename } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { generateImageWithCodex } from "./codex.ts";
import { cropStripPanel } from "./crop.ts";
import { animateImage, generateImage } from "./grok.ts";
import {
  generateMotionPromptFromStrip,
  pickReviewImagePaths,
} from "./motion-from-strip.ts";
import {
  assetsDir,
  findScene,
  findShot,
  needsRun,
  pendingShots,
  projectDir,
  saveProject,
  shotHash,
  updateShot,
} from "./project.ts";
import { ASSETS_DIRNAME } from "./project.ts";
import type { AssetVersion, Project, Shot } from "./types.ts";

/** Keep the last N archives per shot so the canvas folder does not grow forever. */
const MAX_HISTORY = 12;

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

function historyDir(root: string, shotId: string): string {
  return join(assetsDir(root), "history", shotId);
}

/**
 * Move the current active asset into assets/history/{shotId}/… and return a
 * history entry. No-op if there is no file on disk.
 */
export async function archiveActiveAsset(
  root: string,
  shot: Shot,
): Promise<AssetVersion | null> {
  if (!shot.asset) return null;
  const abs = join(projectDir(root), shot.asset);
  try {
    await access(abs);
  } catch {
    return null;
  }
  const extension = extname(abs).toLowerCase() || ".bin";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = historyDir(root, shot.id);
  await mkdir(dir, { recursive: true });
  const archivedName = `${stamp}${extension}`;
  const archivedAbs = join(dir, archivedName);
  // Prefer rename (same volume); fall back to copy if cross-device.
  try {
    await rename(abs, archivedAbs);
  } catch {
    await copyFile(abs, archivedAbs);
  }
  return {
    asset: `${ASSETS_DIRNAME}/history/${shot.id}/${archivedName}`,
    hash: shot.hash,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Copy generated media into the project. If the shot already has an active
 * asset, archive it into history first so re-animate does not destroy work.
 *
 * Active file stays content-stable name: assets/{shotId}{ext}.
 * History: assets/history/{shotId}/{iso}{ext}.
 */
async function adoptMedia(
  root: string,
  shot: Shot,
  sourcePath: string,
): Promise<{ asset: string; history: AssetVersion[] }> {
  const extension = extname(sourcePath).toLowerCase() || ".bin";
  const filename = `${shot.id}${extension}`;
  await mkdir(assetsDir(root), { recursive: true });
  const dest = join(assetsDir(root), filename);

  // Stage new bytes first so a failed write never leaves the shot with neither
  // active nor history after we move the previous file aside.
  const staged = `${dest}.staging`;
  if (sourcePath !== dest) {
    await copyFile(sourcePath, staged);
  } else {
    // Source is already the active path (e.g. crop wrote in place) — nothing to stage.
  }

  const archived = await archiveActiveAsset(root, shot);
  const prev = shot.history ?? [];
  const history = archived
    ? [archived, ...prev].slice(0, MAX_HISTORY)
    : prev.slice(0, MAX_HISTORY);

  if (sourcePath !== dest) {
    await rename(staged, dest);
  }
  return {
    asset: `${ASSETS_DIRNAME}/${filename}`,
    history,
  };
}

/** Promote a history entry to active, archiving the current active first. */
export async function restoreHistoryAsset(
  root: string,
  project: Project,
  shotId: string,
  historyAsset: string,
): Promise<Project> {
  const shot = findShot(project, shotId);
  if (!shot) throw new Error(`Shot not found: ${shotId}`);
  const history = shot.history ?? [];
  const entry = history.find((h) => h.asset === historyAsset);
  if (!entry) throw new Error(`History entry not found for ${shotId}: ${historyAsset}`);

  const histAbs = join(projectDir(root), entry.asset);
  try {
    await access(histAbs);
  } catch {
    throw new Error(`History file missing on disk: ${entry.asset}`);
  }

  // Archive current active (if any), then copy history file into active slot.
  const archived = await archiveActiveAsset(root, shot);
  const extension = extname(histAbs).toLowerCase() || extname(entry.asset).toLowerCase() || ".bin";
  const activeRel = `${ASSETS_DIRNAME}/${shot.id}${extension}`;
  const activeAbs = join(projectDir(root), activeRel);
  await mkdir(dirname(activeAbs), { recursive: true });
  await copyFile(histAbs, activeAbs);

  // Drop the restored entry from history; keep the archived previous active.
  const remaining = history.filter((h) => h.asset !== historyAsset);
  const nextHistory = archived
    ? [archived, ...remaining].slice(0, MAX_HISTORY)
    : remaining.slice(0, MAX_HISTORY);

  return updateShot(project, shotId, {
    asset: activeRel,
    hash: entry.hash,
    history: nextHistory,
    status: "ready",
    message: null,
  });
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

async function runDerivedCrop(
  root: string,
  project: Project,
  shot: Shot & { kind: "image" },
): Promise<{ project: Project; event: RunEvent }> {
  const derive = shot.deriveFrom!;
  const source = findShot(project, derive.sourceId);
  if (!source || source.kind !== "image" || !source.asset) {
    const message = `Strip ${derive.sourceId} is not ready yet. Generate the strip first.`;
    return {
      project: updateShot(project, shot.id, { status: "error", message }),
      event: { shotId: shot.id, status: "error", message },
    };
  }
  const sourcePath = join(projectDir(root), source.asset);
  // Write to a staging file so adoptMedia can archive the previous active first.
  const outPath = join(assetsDir(root), `${shot.id}.new.png`);
  try {
    await cropStripPanel(sourcePath, derive.panel, outPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      project: updateShot(project, shot.id, { status: "error", message }),
      event: { shotId: shot.id, status: "error", message },
    };
  }
  // Re-read shot so we archive the latest active asset + history.
  const current = findShot(project, shot.id) ?? shot;
  const adopted = await adoptMedia(root, current, outPath);
  const next = updateShot(project, shot.id, {
    status: "ready",
    asset: adopted.asset,
    history: adopted.history,
    message: null,
    hash: shotHash(project, shot),
  });
  return {
    project: next,
    event: { shotId: shot.id, status: "ready", costUsd: 0 },
  };
}

async function runImageShot(
  root: string,
  project: Project,
  shot: Shot & { kind: "image" },
): Promise<{ project: Project; event: RunEvent }> {
  // Derived frames = crops of a 3-panel strip (no model call).
  if (shot.deriveFrom) {
    return runDerivedCrop(root, project, shot);
  }

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

  // Never write backends straight onto the active asset path — archive first.
  const stagedOut = join(assetsDir(root), `${shot.id}.new.png`);
  const result =
    shot.provider === "codex"
      ? await generateImageWithCodex({
          prompt: shot.prompt,
          aspect: shot.aspect,
          workDir: assetsDir(root),
          outPath: stagedOut,
          referenceImagePaths: refPaths,
        })
      : await generateImage({
          prompt:
            refPaths.length > 0
              ? `${shot.prompt}\n\nVisual continuity: match character, wardrobe, and style of the reference stills.`
              : shot.prompt,
          aspect: shot.aspect,
          cwd: projectDir(root),
          referenceImagePaths: refPaths,
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
  // so the extension matches what was produced. Archive previous active first.
  const current = findShot(project, shot.id) ?? shot;
  const adopted = await adoptMedia(root, current, result.mediaPath);
  const next = updateShot(project, shot.id, {
    status: "ready",
    asset: adopted.asset,
    history: adopted.history,
    message: null,
    hash: shotHash(project, shot),
  });
  return {
    project: next,
    event: { shotId: shot.id, status: "ready", costUsd: result.costUsd },
  };
}

/**
 * Vision-review the scene strip / three crops and write a timed motion prompt
 * onto the video shot. Used before every animate so re-animate tracks the strip.
 */
export async function refreshMotionPromptFromStrip(
  root: string,
  project: Project,
  videoId: string,
): Promise<{ project: Project; prompt: string | null; message: string | null }> {
  const shot = findShot(project, videoId);
  if (!shot || shot.kind !== "video") {
    return { project, prompt: null, message: `Not a video shot: ${videoId}` };
  }

  const scene = shot.sceneId
    ? findScene(project, shot.sceneId)
    : project.scenes.find((s) => s.videoId === videoId) ?? null;

  const first = findShot(project, shot.from);
  const mid = shot.refs?.[0] ? findShot(project, shot.refs[0]) : null;
  const last = shot.refs?.[1] ? findShot(project, shot.refs[1]) : null;
  const strip = scene?.stripId ? findShot(project, scene.stripId) : null;

  const abs = (s: typeof first) =>
    s?.kind === "image" && s.asset ? join(projectDir(root), s.asset) : null;

  const imagePaths = pickReviewImagePaths({
    stripPath: abs(strip),
    firstPath: abs(first),
    middlePath: abs(mid),
    lastPath: abs(last),
  });

  if (imagePaths.length < 1) {
    return {
      project,
      prompt: null,
      message: "No strip or frame assets ready to review for motion prompt.",
    };
  }

  const workDir = join(assetsDir(root), ".motion-review");
  const review = await generateMotionPromptFromStrip({
    imagePaths,
    duration: shot.duration,
    sceneName: scene?.name,
    seedAction: scene?.panels ?? shot.prompt.slice(0, 200),
    workDir,
  });

  if (!review.ok || !review.prompt) {
    return {
      project,
      prompt: null,
      message: review.message ?? "Motion prompt review failed.",
    };
  }

  const next = updateShot(project, videoId, {
    prompt: review.prompt,
    // Do not change status/asset — only the motion text.
  });
  return { project: next, prompt: review.prompt, message: null };
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

  // Motion prompt is authored by the agent (or human) after reviewing the strip.
  // Do not auto-rewrite via Codex here — use the saved shot.prompt as-is.
  // Optional: POST /shot/:id/motion-from-strip or agent rewrites the textarea.
  const motionPrompt = shot.prompt;
  const projectForVideo = project;

  // Prior boards (shot.refs) lock style; primary is always `from` (sourcePath).
  const stylePaths = resolvedImagePaths(root, projectForVideo, shot.refs);
  const result = await animateImage({
    prompt: motionPrompt,
    sourcePath: join(projectDir(root), source.asset),
    referencePaths: stylePaths,
    aspect: source.kind === "image" ? source.aspect : "9:16",
    duration: shot.duration,
    resolution: shot.resolution ?? "720p",
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
      project: updateShot(projectForVideo, shot.id, {
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

  const current = findShot(projectForVideo, shot.id) ?? shot;
  const adopted = await adoptMedia(root, current, result.mediaPath);
  // Hash against the prompt we actually used (may have been rewritten).
  const hashed = updateShot(projectForVideo, shot.id, { prompt: motionPrompt });
  const next = updateShot(hashed, shot.id, {
    status: "ready",
    asset: adopted.asset,
    history: adopted.history,
    message: null,
    hash: shotHash(hashed, findShot(hashed, shot.id)!),
  });
  return {
    project: next,
    event: { shotId: shot.id, status: "ready", costUsd: result.costUsd },
  };
}

/**
 * Run shots one at a time. Serial on purpose: these calls cost real money, and
 * a video depends on its source image having finished.
 *
 * When the UI (or CLI) passes explicit shotIds, force=true is recommended so
 * "Re-animate" actually re-runs a ready shot instead of being skipped as
 * unchanged.
 */
export async function runProject(
  startingProject: Project,
  options: RunOptions,
): Promise<{ project: Project; summary: RunSummary }> {
  let project = startingProject;
  const summary: RunSummary = { ready: 0, skipped: 0, failed: 0, blocked: 0, costUsd: 0 };
  // Explicit single/multi shot lists from the UI mean "run these now".
  const force = options.force ?? Boolean(options.shotIds?.length);

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
