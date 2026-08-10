/**
 * A canvas holds style locks, optional plot board, and scenes:
 *
 *   character lock + location lock  (visual bible — generate first)
 *     └── scene (~6s beat)
 *           ├── strip (ONE 3-panel still, refs locks)
 *           ├── first / mid / last  (CROPS of the strip — not new gens)
 *           └── video (reference_to_video on the three crops; action prompt)
 *
 * Shots remain the generateable units; scenes only group them.
 */

export type Aspect = "9:16" | "1:1" | "16:9" | "4:3" | "3:4";

export type ImageProvider = "grok" | "codex";

/**
 * `blocked` is distinct from `error` on purpose. An error is something that
 * might succeed on retry; blocked means the account or configuration forbids
 * it, so retrying is pointless until a human changes something.
 */
export type ShotStatus = "pending" | "running" | "ready" | "error" | "blocked";

/** Role of a still inside a scene (for the video model). */
export type FrameRole = "first" | "middle" | "last";

/** Structural role of an image shot in the project. */
export type ImageRole = "storyboard" | "character" | "location" | "strip" | "frame";

/** Which third of a 3-panel strip a derived frame is cropped from. */
export type StripPanel = "left" | "middle" | "right";

/** One archived generation of a shot. The live file is always `shot.asset`. */
export interface AssetVersion {
  /** Path relative to project dir, e.g. "assets/history/vid-1/2026-08-10T03-00-00.000Z.mp4". */
  asset: string;
  /** Input hash that produced this file (may be null for older archives). */
  hash: string | null;
  createdAt: string;
}

export interface BaseShot {
  id: string;
  prompt: string;
  status: ShotStatus;
  /** Path relative to the project dir, e.g. "assets/shot-1.jpg". Active version. */
  asset: string | null;
  /**
   * Prior generations (newest first). Re-animate / regenerate archives the
   * previous active file here instead of overwriting it into oblivion.
   */
  history?: AssetVersion[];
  /** Human-readable failure text. For `blocked`, quote the upstream verbatim. */
  message: string | null;
  /** Hash of the inputs that produced `asset`, for skip-if-unchanged. */
  hash: string | null;
  updatedAt: string;
}

export interface ImageShot extends BaseShot {
  kind: "image";
  aspect: Aspect;
  provider: ImageProvider;
  /**
   * Prior image shot ids used as visual context (style / character / location).
   * Scene strips ref character + location locks.
   */
  refs?: string[];
  role?: ImageRole;
  /** If role is frame, which beat of its scene. */
  frame?: FrameRole;
  /**
   * When set, this image is produced by cropping a strip — no model call.
   * panel left/middle/right → first/middle/last frames.
   */
  deriveFrom?: { sourceId: string; panel: StripPanel };
  /** Scene this frame/strip belongs to. */
  sceneId?: string;
}

/** Grok reference_to_video resolution. */
export type VideoResolution = "480p" | "720p";

export interface VideoShot extends BaseShot {
  kind: "video";
  /** Primary image (first frame of the scene). */
  from: string;
  /** The API accepts 6 or 10 only. */
  duration: 6 | 10;
  /** Output resolution for Grok video (default 720p). */
  resolution?: VideoResolution;
  /**
   * Middle + last frame ids (and any extra style boards). Model call order is
   * always [from, ...refs].
   */
  refs?: string[];
  /** Scene this video belongs to. */
  sceneId?: string;
}

export type Shot = ImageShot | VideoShot;

/**
 * One ~6s beat. Identity lives in locks + one strip; video sees three crops.
 */
export interface Scene {
  id: string;
  name: string;
  /** Human note, e.g. beat list: "practice fail". */
  panels?: string;
  /** 3-panel strip shot (model-generated once per scene). */
  stripId?: string;
  /** Shot ids: first, middle, last — usually crops of stripId. */
  frames: { first: string; middle: string; last: string };
  /** Video shot that animates those three frames. */
  videoId: string;
}

export interface Project {
  /** 3 = storyboard + scenes; character/location locks are additive fields. */
  version: 3;
  name: string;
  shots: Shot[];
  /** Master multi-panel plot board (optional; not required for scenes). */
  storyboardId: string | null;
  /** Character bible still — required before scene add. */
  characterLockId: string | null;
  /** Location / set bible still — required before scene add. */
  locationLockId: string | null;
  scenes: Scene[];
  createdAt: string;
  updatedAt: string;
}

export function isImageShot(shot: Shot): shot is ImageShot {
  return shot.kind === "image";
}

export function isVideoShot(shot: Shot): shot is VideoShot {
  return shot.kind === "video";
}

export function emptyProject(name = "Untitled canvas"): Project {
  const now = new Date().toISOString();
  return {
    version: 3,
    name,
    shots: [],
    storyboardId: null,
    characterLockId: null,
    locationLockId: null,
    scenes: [],
    createdAt: now,
    updatedAt: now,
  };
}
