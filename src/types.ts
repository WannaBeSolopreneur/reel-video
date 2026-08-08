/**
 * A canvas holds shots plus an optional story structure:
 *
 *   storyboard (1 multi-panel image)
 *     └── scene (~6s beat)
 *           ├── first / middle / last frames
 *           └── video (reference_to_video on those three)
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

export interface BaseShot {
  id: string;
  prompt: string;
  status: ShotStatus;
  /** Path relative to the project dir, e.g. "assets/shot-1.jpg". */
  asset: string | null;
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
   * Prior image shot ids used as visual context (style / character lock).
   * For scene frames this should include the storyboard id.
   */
  refs?: string[];
  /** Optional: this image is the project storyboard master. */
  role?: "storyboard" | "frame";
  /** If role is frame, which beat of its scene. */
  frame?: FrameRole;
  /** Scene this frame belongs to. */
  sceneId?: string;
}

export interface VideoShot extends BaseShot {
  kind: "video";
  /** Primary image (first frame of the scene). */
  from: string;
  /** The API accepts 6 or 10 only. */
  duration: 6 | 10;
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
 * One ~6s beat of the storyboard. The video model sees only the three frames.
 */
export interface Scene {
  id: string;
  name: string;
  /** Human note, e.g. which storyboard panels: "1-4". */
  panels?: string;
  /** Shot ids: first, middle, last keyframe stills. */
  frames: { first: string; middle: string; last: string };
  /** Video shot that animates those three frames. */
  videoId: string;
}

export interface Project {
  /** 3 = storyboard + scenes structure. */
  version: 3;
  name: string;
  shots: Shot[];
  /** Master multi-panel board shot id, or null if not set. */
  storyboardId: string | null;
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
    scenes: [],
    createdAt: now,
    updatedAt: now,
  };
}
