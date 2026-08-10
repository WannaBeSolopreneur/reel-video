/**
 * Editable scene prompt templates for strip + video.
 *
 * Designed so an agent (or human) only fills ACTION lines and CORE ACTION.
 * Timing numbers are fixed for the clip duration (default 10s) and stay in
 * the prompt so the image/video models pace to the full length.
 *
 *  10s → LEFT 0–3s · MIDDLE 3–7s · RIGHT 7–10s
 *   6s → LEFT 0–2s · MIDDLE 2–4s · RIGHT 4–6s
 */

/**
 * Timeline for a scene clip. Default scenes are 10s — strip keyframes and the
 * video prompt must both plan action across the full length, not a 2s gag.
 */
export function sceneTiming(duration: 6 | 10): {
  duration: 6 | 10;
  leftWindow: string;
  midWindow: string;
  rightWindow: string;
  setupRange: string;
  peakRange: string;
  afterRange: string;
  setupSec: number;
  peakSec: number;
  afterSec: number;
  leftLabel: string;
  midLabel: string;
  rightLabel: string;
} {
  if (duration === 6) {
    return {
      duration: 6,
      leftWindow: "0–2s (start of clip)",
      midWindow: "2–4s (mid clip)",
      rightWindow: "4–6s (end of clip)",
      setupRange: "[00:00–00:02]",
      peakRange: "[00:02–00:04]",
      afterRange: "[00:04–00:06]",
      setupSec: 2,
      peakSec: 2,
      afterSec: 2,
      leftLabel: "0-2s",
      midLabel: "2-4s",
      rightLabel: "4-6s",
    };
  }
  return {
    duration: 10,
    leftWindow: "0–3s (start of 10s clip)",
    midWindow: "3–7s (mid of 10s clip)",
    rightWindow: "7–10s (end of 10s clip)",
    setupRange: "[00:00–00:03]",
    peakRange: "[00:03–00:07]",
    afterRange: "[00:07–00:10]",
    setupSec: 3,
    peakSec: 4,
    afterSec: 3,
    leftLabel: "0-3s",
    midLabel: "3-7s",
    rightLabel: "7-10s",
  };
}

export interface ScenePromptBeats {
  name: string;
  duration?: 6 | 10;
  /** One-line overall action (what the scene is about). */
  coreAction?: string;
  /** LEFT panel / setup window — physical action only. */
  leftAction?: string;
  /** MIDDLE panel / peak window. */
  middleAction?: string;
  /** RIGHT panel / aftermath window. */
  rightAction?: string;
  /** Optional camera note for the whole take. */
  camera?: string;
}

function defaultBeats(input: ScenePromptBeats): Required<
  Pick<ScenePromptBeats, "coreAction" | "leftAction" | "middleAction" | "rightAction" | "camera">
> & { duration: 6 | 10; name: string } {
  const duration = input.duration ?? 10;
  const t = sceneTiming(duration);
  const core =
    input.coreAction?.trim() ||
    "EDIT: one clear physical action (who does what to what)";
  return {
    name: input.name,
    duration,
    coreAction: core,
    leftAction:
      input.leftAction?.trim() ||
      `EDIT: setup for "${core}" — intent/approach, hands+eyes readable, held for ~${t.setupSec}s`,
    middleAction:
      input.middleAction?.trim() ||
      `EDIT: peak of "${core}" — decisive contact/mid-gesture, highest energy, ~${t.peakSec}s`,
    rightAction:
      input.rightAction?.trim() ||
      `EDIT: aftermath of "${core}" — reaction/prop change/exit, hold ~${t.afterSec}s`,
    camera:
      input.camera?.trim() ||
      "gentle motivated push-in or slight pan; no whip cuts",
  };
}

/**
 * Fill-in strip prompt. Time numbers are intentional (in the prompt and allowed
 * as small on-panel corner labels like "0-3s").
 */
export function buildStripPrompt(input: ScenePromptBeats): string {
  const b = defaultBeats(input);
  const t = sceneTiming(b.duration);

  return [
    `=== SCENE STRIP TEMPLATE (${b.duration}s) — edit only ACTION lines ===`,
    ``,
    `ONE single image: 3-panel storyboard STRIP, equal panels LEFT | MIDDLE | RIGHT in one horizontal row.`,
    `Clean even gutters, same height, equal width. Professional storyboard layout.`,
    ``,
    `DURATION: ${b.duration} seconds total (this strip becomes ONE continuous ${b.duration}s video).`,
    `TIMELINE (fixed — do not change):`,
    `  LEFT   = ${t.leftLabel}   SETUP      (~${t.setupSec}s)`,
    `  MIDDLE = ${t.midLabel}   PEAK       (~${t.peakSec}s)`,
    `  RIGHT  = ${t.rightLabel}  AFTERMATH  (~${t.afterSec}s)`,
    ``,
    `SCENE NAME: ${b.name}`,
    `CORE ACTION: ${b.coreAction}`,
    ``,
    `--- EDIT THESE THREE ACTIONS ---`,
    `LEFT [${t.leftLabel}] ACTION: ${b.leftAction}`,
    `MIDDLE [${t.midLabel}] ACTION: ${b.middleAction}`,
    `RIGHT [${t.rightLabel}] ACTION: ${b.rightAction}`,
    `--- END EDIT ---`,
    ``,
    `LOCKS (fixed):`,
    `- Use attached CHARACTER LOCK + LOCATION LOCK as the only style references.`,
    `- Same characters, wardrobe, faces, and place in every panel — do not redesign.`,
    `- Match lock style exactly.`,
    ``,
    `ON-PANEL LABELS (numbers OK): small corner timecode only — "${t.leftLabel}" / "${t.midLabel}" / "${t.rightLabel}". No other text, no dialogue captions, no logos, no watermark.`,
    `Each panel = FROZEN KEYFRAME for that time window. Hands, eyes, body, prop contact must read for animation.`,
    `Camera family consistent across panels unless a beat needs a clear push-in.`,
  ].join("\n");
}

/**
 * Fill-in video prompt with explicit ${duration}s timecodes.
 * Agent edits CORE ACTION and optional per-window notes; timing stays fixed.
 */
export function buildVideoPrompt(input: ScenePromptBeats): string {
  const b = defaultBeats(input);
  const t = sceneTiming(b.duration);

  return [
    `=== SCENE VIDEO TEMPLATE (${b.duration}s) — edit only ACTION lines ===`,
    ``,
    `Continuous ${b.duration}-second SINGLE TAKE of scene "${b.name}".`,
    `Total runtime = ${b.duration}s. Use the FULL length — do not rush action into the first 2 seconds.`,
    ``,
    `PRIMARY: Morph three reference stills IN ORDER (first→middle→last).`,
    `Stills lock identity + set. Motion is continuous between them.`,
    `Match characters, wardrobe, faces, location EXACTLY — no redesign, no new props, no on-screen text.`,
    ``,
    `--- EDIT ACTION ---`,
    `CORE ACTION (must read across full ${b.duration}s): ${b.coreAction}`,
    `SETUP note ${t.setupRange}: ${b.leftAction}`,
    `PEAK note ${t.peakRange}: ${b.middleAction}`,
    `AFTERMATH note ${t.afterRange}: ${b.rightAction}`,
    `CAMERA: ${b.camera}`,
    `--- END EDIT ---`,
    ``,
    `PACING / TIMECODE (fixed — honor exactly):`,
    `${t.setupRange} SETUP (~${t.setupSec}s): establish from first still — intent, approach, anticipation. Slow; hold readable poses.`,
    `${t.peakRange} PEAK (~${t.peakSec}s): main action through middle still — contact, weight, effort. Spend real time on the gesture.`,
    `${t.afterRange} AFTERMATH (~${t.afterSec}s): land on last still — reaction, prop state, settle. Fill until end; do not cut early.`,
    ``,
    `Animate: body mechanics, hands, head turns, eyes, weight shifts, prop contact, facial reaction, holds, follow-through.`,
    `Smooth morph between stills; no freeze-frames; no speed-ramping the whole clip into a blink.`,
  ].join("\n");
}

/** Build both prompts from the same beat sheet (preferred for scene scaffold). */
export function buildScenePrompts(input: ScenePromptBeats): {
  stripPrompt: string;
  videoPrompt: string;
  duration: 6 | 10;
} {
  const duration = input.duration ?? 10;
  return {
    duration,
    stripPrompt: buildStripPrompt({ ...input, duration }),
    videoPrompt: buildVideoPrompt({ ...input, duration }),
  };
}
