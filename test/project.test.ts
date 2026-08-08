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
  assert.throws(() => removeShot(project, "img-1"), /used by video vid-1/);
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

test("scene scaffolds three frames + video locked to storyboard", () => {
  let { project, shot } = addImageShot(emptyProject("sb"), {
    prompt: "8-panel board",
    id: "img-1",
  });
  project = setStoryboard(project, shot.id);
  const added = addScene(project, { name: "Ride", panels: "1-4", provider: "codex" });
  project = added.project;
  assert.equal(project.scenes.length, 1);
  assert.equal(added.scene.frames.first, "img-2");
  assert.equal(added.scene.frames.middle, "img-3");
  assert.equal(added.scene.frames.last, "img-4");
  assert.equal(added.scene.videoId, "vid-1");
  const video = project.shots.find((s) => s.id === "vid-1");
  assert.ok(video && video.kind === "video");
  assert.equal(video.from, "img-2");
  assert.deepEqual(video.refs, ["img-3", "img-4"]);
  const first = project.shots.find((s) => s.id === "img-2");
  assert.ok(first && first.kind === "image");
  assert.deepEqual(first.refs, ["img-1"]);
  assert.equal(first.frame, "first");
});
