import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addImageShot,
  addScene,
  addVideoShot,
  needsRun,
  nextShotId,
  pendingShots,
  removeShot,
  sceneTiming,
  setStoryboard,
  shotHash,
  updateShot,
} from "../src/project.ts";
import { emptyProject } from "../src/types.ts";

function withImage(prompt = "a goat on a hill") {
  return addImageShot(emptyProject("test"), { prompt });
}

test("image shots get readable sequential ids", () => {
  let { project } = withImage();
  ({ project } = addImageShot(project, { prompt: "second" }));
  assert.deepEqual(
    project.shots.map((shot) => shot.id),
    ["img-1", "img-2"],
  );
});

test("ids skip over ones already taken", () => {
  const { project } = addImageShot(emptyProject(), { prompt: "x", id: "img-1" });
  assert.equal(nextShotId(project, "image"), "img-2");
});

test("a video must animate an image that exists", () => {
  const { project } = withImage();
  assert.throws(
    () => addVideoShot(project, { prompt: "push in", from: "nope" }),
    /Source shot not found/,
  );
});

test("a video cannot animate another video", () => {
  let { project } = withImage();
  ({ project } = addVideoShot(project, { prompt: "push in", from: "img-1" }));
  assert.throws(
    () => addVideoShot(project, { prompt: "again", from: "vid-1" }),
    /is a video shot/,
  );
});

test("removing an image that a video depends on is refused", () => {
  let { project } = withImage();
  ({ project } = addVideoShot(project, { prompt: "push in", from: "img-1" }));
  assert.throws(() => removeShot(project, "img-1"), /used by vid-1/);
});

test("removing an unused shot works", () => {
  const { project } = withImage();
  assert.equal(removeShot(project, "img-1").shots.length, 0);
});

test("editing the prompt invalidates a ready asset", () => {
  let { project } = withImage();
  const original = shotHash(project, project.shots[0]!);
  project = updateShot(project, "img-1", {
    status: "ready",
    asset: "assets/img-1.jpg",
    hash: original,
  });
  assert.equal(needsRun(project, project.shots[0]!, false), false);

  project = updateShot(project, "img-1", { prompt: "a different goat" });
  assert.equal(
    needsRun(project, project.shots[0]!, false),
    true,
    "a changed prompt must force regeneration",
  );
});

test("re-rolling frame 1 invalidates the video that animates it", () => {
  let { project } = withImage();
  ({ project } = addVideoShot(project, { prompt: "push in", from: "img-1" }));

  project = updateShot(project, "img-1", { hash: "aaaaaaaaaaaaaaaa" });
  const before = shotHash(project, project.shots[1]!);

  project = updateShot(project, "img-1", { hash: "bbbbbbbbbbbbbbbb" });
  const after = shotHash(project, project.shots[1]!);

  assert.notEqual(before, after, "video hash must fold in its source image hash");
});

test("blocked shots are not retried automatically", () => {
  let { project } = withImage();
  project = updateShot(project, "img-1", { status: "blocked", message: "ZDR" });
  assert.equal(needsRun(project, project.shots[0]!, false), false);
  assert.equal(needsRun(project, project.shots[0]!, true), true, "--force overrides blocked");
});

test("images are ordered before the videos that need them", () => {
  let { project } = addImageShot(emptyProject(), { prompt: "a" });
  ({ project } = addVideoShot(project, { prompt: "v", from: "img-1" }));
  ({ project } = addImageShot(project, { prompt: "b" }));
  assert.deepEqual(
    pendingShots(project).map((shot) => shot.id),
    ["img-1", "img-2", "vid-1"],
  );
});

test("sceneTiming maps 10s and 6s into three windows", () => {
  const t10 = sceneTiming(10);
  assert.equal(t10.setupSec, 3);
  assert.equal(t10.peakSec, 4);
  assert.equal(t10.afterSec, 3);
  assert.match(t10.setupRange, /00:00/);
  assert.match(t10.afterRange, /00:10/);
  const t6 = sceneTiming(6);
  assert.equal(t6.setupSec + t6.peakSec + t6.afterSec, 6);
});

test("default scene prompts use editable timed template (10s)", () => {
  let { project } = addImageShot(emptyProject("timing"), {
    prompt: "cast",
    id: "img-1",
    role: "character",
  });
  ({ project } = addImageShot(project, {
    prompt: "set",
    id: "img-2",
    role: "location",
  }));
  const { project: next } = addScene(project, {
    name: "Beat",
    panels: "press the button",
    duration: 10,
  });
  const strip = next.shots.find(
    (s) => s.kind === "image" && s.role === "strip",
  );
  assert.ok(strip && strip.kind === "image");
  assert.match(strip.prompt, /SCENE STRIP TEMPLATE \(10s\)/);
  assert.match(strip.prompt, /EDIT THESE THREE ACTIONS/);
  assert.match(strip.prompt, /0-3s/);
  assert.match(strip.prompt, /3-7s/);
  assert.match(strip.prompt, /7-10s/);
  assert.match(strip.prompt, /press the button/);
  const video = next.shots.find((s) => s.kind === "video");
  assert.ok(video && video.kind === "video");
  assert.equal(video.duration, 10);
  assert.match(video.prompt, /SCENE VIDEO TEMPLATE \(10s\)/);
  assert.match(video.prompt, /EDIT ACTION/);
  assert.match(video.prompt, /00:00/);
  assert.match(video.prompt, /00:10/);
  assert.match(video.prompt, /FULL length|do not rush/i);
});

test("scene scaffolds strip + three crops + video locked to character and location", () => {
  let { project } = addImageShot(emptyProject("locks"), {
    prompt: "cast bible",
    id: "img-1",
    role: "character",
  });
  ({ project } = addImageShot(project, {
    prompt: "set bible",
    id: "img-2",
    role: "location",
  }));
  assert.equal(project.characterLockId, "img-1");
  assert.equal(project.locationLockId, "img-2");

  const added = addScene(project, { name: "Ride", panels: "opening chaos", provider: "codex" });
  project = added.project;
  assert.equal(project.scenes.length, 1);
  assert.equal(added.scene.stripId, "img-3");
  assert.equal(added.scene.frames.first, "img-4");
  assert.equal(added.scene.frames.middle, "img-5");
  assert.equal(added.scene.frames.last, "img-6");
  assert.equal(added.scene.videoId, "vid-1");
  const strip = project.shots.find((s) => s.id === "img-3");
  assert.ok(strip && strip.kind === "image");
  assert.equal(strip.role, "strip");
  assert.deepEqual(strip.refs, ["img-1", "img-2"]);
  const first = project.shots.find((s) => s.id === "img-4");
  assert.ok(first && first.kind === "image");
  assert.deepEqual(first.deriveFrom, { sourceId: "img-3", panel: "left" });
  assert.equal(first.frame, "first");
  const video = project.shots.find((s) => s.id === "vid-1");
  assert.ok(video && video.kind === "video");
  assert.equal(video.from, "img-4");
  assert.deepEqual(video.refs, ["img-5", "img-6"]);
  // pending order: non-derived images before crops before video
  assert.deepEqual(
    pendingShots(project).map((s) => s.id),
    ["img-1", "img-2", "img-3", "img-4", "img-5", "img-6", "vid-1"],
  );
});

test("scene add fails without both locks", () => {
  const { project } = addImageShot(emptyProject(), {
    prompt: "cast only",
    role: "character",
  });
  assert.throws(() => addScene(project, { name: "Nope" }), /locks required/i);
});
