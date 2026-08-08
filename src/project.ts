/**
 * Reading and writing canvas/project.json.
 *
 * The project file is the contract between the agent and the human: the agent
 * edits it through the CLI, the diff shows up in a pull request, and the review
 * UI renders it. It is deliberately small, ordered, and free of anything
 * machine-specific so that the diff stays readable.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  emptyProject,
  isImageShot,
  isVideoShot,
  type Aspect,
  type FrameRole,
  type ImageProvider,
  type Project,
  type Scene,
  type Shot,
} from "./types.ts";

export const PROJECT_DIRNAME = "canvas";
export const PROJECT_FILENAME = "project.json";
export const ASSETS_DIRNAME = "assets";

export function projectDir(root: string): string {
  return join(root, PROJECT_DIRNAME);
}

export function projectPath(root: string): string {
  return join(projectDir(root), PROJECT_FILENAME);
}

export function assetsDir(root: string): string {
  return join(projectDir(root), ASSETS_DIRNAME);
}

/** Bring v2 (flat shots only) projects up to v3 (storyboard + scenes). */
export function migrateProject(raw: unknown): Project {
  const p = raw as Partial<Project> & { version?: number; shots?: Shot[] };
  if (!p || !Array.isArray(p.shots)) {
    throw new Error("Invalid project.json: missing shots array.");
  }
  const base = emptyProject(typeof p.name === "string" ? p.name : "Untitled canvas");
  return {
    ...base,
    ...p,
    version: 3,
    name: typeof p.name === "string" ? p.name : base.name,
    shots: p.shots,
    storyboardId: p.storyboardId ?? null,
    scenes: Array.isArray(p.scenes) ? p.scenes : [],
    createdAt: typeof p.createdAt === "string" ? p.createdAt : base.createdAt,
    updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : base.updatedAt,
  };
}

export async function loadProject(root: string): Promise<Project> {
  try {
    const raw = await readFile(projectPath(root), "utf8");
    return migrateProject(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No canvas found at ${projectPath(root)}. Run \`canvas init\` first.`,
      );
    }
    throw err;
  }
}

/**
 * Write atomically. A half-written project.json would be worse than no canvas
 * at all, and runs write this file on every shot transition.
 */
export async function saveProject(root: string, project: Project): Promise<Project> {
  const next: Project = { ...project, updatedAt: new Date().toISOString() };
  const target = projectPath(root);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temp, target);
  return next;
}

export async function initProject(root: string, name?: string): Promise<Project> {
  await mkdir(assetsDir(root), { recursive: true });
  return saveProject(root, emptyProject(name));
}

export function findShot(project: Project, id: string): Shot | null {
  return project.shots.find((shot) => shot.id === id) ?? null;
}

/**
 * Readable, stable, collision-checked ids. These end up in filenames, URLs and
 * PR diffs, so `shot-3` beats a random slug.
 */
export function nextShotId(project: Project, kind: Shot["kind"]): string {
  const prefix = kind === "video" ? "vid" : "img";
  const taken = new Set(project.shots.map((shot) => shot.id));
  for (let n = 1; ; n += 1) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface AddImageOptions {
  prompt: string;
  aspect?: Aspect;
  provider?: ImageProvider;
  id?: string;
  /** Prior image shot ids for visual style/character lock. */
  refs?: string[];
  role?: "storyboard" | "frame";
  frame?: FrameRole;
  sceneId?: string;
}

function resolveImageRefs(project: Project, refs: string[] | undefined, selfId?: string): string[] {
  if (!refs?.length) return [];
  const out: string[] = [];
  for (const ref of refs) {
    if (selfId && ref === selfId) {
      throw new Error(`A shot cannot ref itself (${ref}).`);
    }
    const shot = findShot(project, ref);
    if (!shot) throw new Error(`Ref shot not found: ${ref}`);
    if (shot.kind !== "image") {
      throw new Error(`Ref ${ref} must be an image shot, not ${shot.kind}.`);
    }
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

export function addImageShot(project: Project, options: AddImageOptions): {
  project: Project;
  shot: Shot;
} {
  const id = options.id ?? nextShotId(project, "image");
  if (findShot(project, id)) throw new Error(`Shot id already exists: ${id}`);
  const refs = resolveImageRefs(project, options.refs, id);
  const shot: Shot = {
    id,
    kind: "image",
    prompt: options.prompt,
    aspect: options.aspect ?? "9:16",
    provider: options.provider ?? "grok",
    ...(refs.length ? { refs } : {}),
    ...(options.role ? { role: options.role } : {}),
    ...(options.frame ? { frame: options.frame } : {}),
    ...(options.sceneId ? { sceneId: options.sceneId } : {}),
    status: "pending",
    asset: null,
    message: null,
    hash: null,
    updatedAt: new Date().toISOString(),
  };
  let next: Project = { ...project, shots: [...project.shots, shot] };
  if (options.role === "storyboard") {
    next = { ...next, storyboardId: id };
  }
  return { project: next, shot };
}

export interface AddVideoOptions {
  prompt: string;
  from: string;
  duration?: 6 | 10;
  id?: string;
  /** Extra image ids for style continuity (in addition to `from`). */
  refs?: string[];
  sceneId?: string;
}

export function addVideoShot(project: Project, options: AddVideoOptions): {
  project: Project;
  shot: Shot;
} {
  const source = findShot(project, options.from);
  if (!source) throw new Error(`Source shot not found: ${options.from}`);
  if (source.kind !== "image") {
    throw new Error(
      `Video shots animate an image, but ${options.from} is a ${source.kind} shot.`,
    );
  }
  const id = options.id ?? nextShotId(project, "video");
  if (findShot(project, id)) throw new Error(`Shot id already exists: ${id}`);
  const refs = resolveImageRefs(project, options.refs, id).filter((r) => r !== options.from);
  const shot: Shot = {
    id,
    kind: "video",
    prompt: options.prompt,
    from: options.from,
    duration: options.duration ?? 6,
    ...(refs.length ? { refs } : {}),
    ...(options.sceneId ? { sceneId: options.sceneId } : {}),
    status: "pending",
    asset: null,
    message: null,
    hash: null,
    updatedAt: new Date().toISOString(),
  };
  return { project: { ...project, shots: [...project.shots, shot] }, shot };
}

export function nextSceneId(project: Project): string {
  const taken = new Set(project.scenes.map((s) => s.id));
  for (let n = 1; ; n += 1) {
    const candidate = `scene-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Mark an existing image shot as the project storyboard master. */
export function setStoryboard(project: Project, imageId: string): Project {
  const shot = findShot(project, imageId);
  if (!shot) throw new Error(`Shot not found: ${imageId}`);
  if (shot.kind !== "image") {
    throw new Error(`Storyboard must be an image shot, not ${shot.kind}.`);
  }
  const shots = project.shots.map((s) => {
    if (s.kind !== "image") return s;
    if (s.id === imageId) {
      return { ...s, role: "storyboard" as const, updatedAt: new Date().toISOString() };
    }
    if (s.role === "storyboard") {
      const { role: _r, ...rest } = s;
      return { ...rest, updatedAt: new Date().toISOString() } as Shot;
    }
    return s;
  });
  return { ...project, shots, storyboardId: imageId };
}

export interface AddSceneOptions {
  name: string;
  panels?: string;
  /** Defaults to project.storyboardId. */
  storyboardId?: string;
  provider?: ImageProvider;
  aspect?: Aspect;
  duration?: 6 | 10;
  /** Override auto prompts for the three frames + video. */
  firstPrompt?: string;
  middlePrompt?: string;
  lastPrompt?: string;
  videoPrompt?: string;
}

/**
 * Scaffold a scene: three keyframes (first/mid/last) style-locked to the
 * storyboard, plus a video that uses those three in order.
 */
export function addScene(
  project: Project,
  options: AddSceneOptions,
): { project: Project; scene: Scene } {
  const boardId = options.storyboardId ?? project.storyboardId;
  if (!boardId) {
    throw new Error(
      "No storyboard set. Add a multi-panel image, then: canvas storyboard set <id>",
    );
  }
  const board = findShot(project, boardId);
  if (!board || board.kind !== "image") {
    throw new Error(`Storyboard shot not found or not an image: ${boardId}`);
  }

  const sceneId = nextSceneId(project);
  const provider = options.provider ?? "codex";
  const aspect = options.aspect ?? board.aspect;
  const panels = options.panels ?? "";
  const panelNote = panels ? ` (storyboard panels ${panels})` : "";
  const name = options.name;

  const defaultFirst =
    options.firstPrompt ??
    `SINGLE cinematic frame (NOT multi-panel), same style as the attached storyboard. FIRST FRAME of scene "${name}"${panelNote}. Full shot of the OPENING beat of this scene only. Match character and world from the storyboard. NO text, NO watermark.`;
  const defaultMiddle =
    options.middlePrompt ??
    `SINGLE cinematic frame (NOT multi-panel), same style as the attached storyboard. MIDDLE FRAME of scene "${name}"${panelNote}. Full shot of the MID beat of this scene only. Match character and world from the storyboard. NO text, NO watermark.`;
  const defaultLast =
    options.lastPrompt ??
    `SINGLE cinematic frame (NOT multi-panel), same style as the attached storyboard. LAST FRAME of scene "${name}"${panelNote}. Full shot of the ENDING beat of this scene only. Match character and world from the storyboard. NO text, NO watermark.`;
  const defaultVideo =
    options.videoPrompt ??
    `Animate a continuous ${options.duration ?? 6}-second shot using three reference stills IN ORDER: first = start of scene "${name}", second = middle, third = end. Morph smoothly first→mid→last. Match characters and world from the stills. Clear beats, no on-screen text.`;

  let next = project;
  let firstId: string;
  let middleId: string;
  let lastId: string;
  let videoId: string;

  {
    const r = addImageShot(next, {
      prompt: defaultFirst,
      aspect,
      provider,
      refs: [boardId],
      role: "frame",
      frame: "first",
      sceneId,
    });
    next = r.project;
    firstId = r.shot.id;
  }
  {
    const r = addImageShot(next, {
      prompt: defaultMiddle,
      aspect,
      provider,
      refs: [boardId],
      role: "frame",
      frame: "middle",
      sceneId,
    });
    next = r.project;
    middleId = r.shot.id;
  }
  {
    const r = addImageShot(next, {
      prompt: defaultLast,
      aspect,
      provider,
      refs: [boardId],
      role: "frame",
      frame: "last",
      sceneId,
    });
    next = r.project;
    lastId = r.shot.id;
  }
  {
    const r = addVideoShot(next, {
      prompt: defaultVideo,
      from: firstId,
      refs: [middleId, lastId],
      duration: options.duration ?? 6,
      sceneId,
    });
    next = r.project;
    videoId = r.shot.id;
  }

  const scene: Scene = {
    id: sceneId,
    name,
    ...(panels ? { panels } : {}),
    frames: { first: firstId, middle: middleId, last: lastId },
    videoId,
  };

  return {
    project: { ...next, scenes: [...next.scenes, scene] },
    scene,
  };
}

export function updateShot(project: Project, id: string, patch: Partial<Shot>): Project {
  let seen = false;
  const shots = project.shots.map((shot) => {
    if (shot.id !== id) return shot;
    seen = true;
    return { ...shot, ...patch, updatedAt: new Date().toISOString() } as Shot;
  });
  if (!seen) throw new Error(`Shot not found: ${id}`);
  return { ...project, shots };
}

/**
 * Removing an image orphans any video that animates it, so refuse rather than
 * silently leaving a dangling `from`.
 */
export function removeShot(project: Project, id: string): Project {
  if (!findShot(project, id)) throw new Error(`Shot not found: ${id}`);
  const dependents = project.shots.filter(
    (shot) => isVideoShot(shot) && (shot.from === id || shot.refs?.includes(id)),
  );
  if (dependents.length > 0) {
    const names = dependents.map((shot) => shot.id).join(", ");
    throw new Error(`Cannot remove ${id}: it is used by video ${names}.`);
  }
  // Refuse if the shot is wired into a scene (remove the scene first, later).
  for (const scene of project.scenes) {
    const used =
      scene.frames.first === id ||
      scene.frames.middle === id ||
      scene.frames.last === id ||
      scene.videoId === id;
    if (used) {
      throw new Error(
        `Cannot remove ${id}: it belongs to ${scene.id} (${scene.name}). ` +
          `Remove or rebuild the scene first.`,
      );
    }
  }
  const shots = project.shots.filter((shot) => shot.id !== id);
  const storyboardId = project.storyboardId === id ? null : project.storyboardId;
  return { ...project, shots, storyboardId };
}

export function findScene(project: Project, id: string): Scene | null {
  return project.scenes.find((s) => s.id === id) ?? null;
}

/** All shot ids that belong to any scene (frames + video). */
export function sceneShotIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const scene of project.scenes) {
    ids.add(scene.frames.first);
    ids.add(scene.frames.middle);
    ids.add(scene.frames.last);
    ids.add(scene.videoId);
  }
  return ids;
}

/**
 * Inputs that, if unchanged, mean the existing asset is still correct. Used to
 * skip regeneration — the expensive thing this tool does.
 */
export function shotHash(project: Project, shot: Shot): string {
  const parts: unknown[] = [shot.kind, shot.prompt];
  if (shot.kind === "image") {
    const refHashes = (shot.refs ?? []).map((id) => findShot(project, id)?.hash ?? null);
    parts.push(shot.aspect, shot.provider, shot.refs ?? [], refHashes);
  } else {
    const source = findShot(project, shot.from);
    const refHashes = (shot.refs ?? []).map((id) => findShot(project, id)?.hash ?? null);
    // Fold in the source's hash so re-rolling frame 1 invalidates the video.
    parts.push(shot.duration, shot.from, source?.hash ?? null, shot.refs ?? [], refHashes);
  }
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/** Shots that need work, in list order. Images before the videos that need them. */
export function pendingShots(project: Project, ids?: string[]): Shot[] {
  const wanted = ids && ids.length > 0 ? new Set(ids) : null;
  const selected = project.shots.filter((shot) => !wanted || wanted.has(shot.id));
  const images = selected.filter((shot) => shot.kind === "image");
  const videos = selected.filter((shot) => shot.kind === "video");
  return [...images, ...videos];
}

export function needsRun(project: Project, shot: Shot, force: boolean): boolean {
  if (force) return true;
  if (shot.status === "ready" && shot.asset && shot.hash === shotHash(project, shot)) {
    return false;
  }
  // Blocked shots stay blocked until a human changes the configuration.
  return shot.status !== "blocked";
}
