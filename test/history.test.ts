import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { archiveActiveAsset, restoreHistoryAsset } from "../src/runner.ts";
import { saveProject } from "../src/project.ts";
import { emptyProject } from "../src/types.ts";
import type { Project, Shot } from "../src/types.ts";

test("archiveActiveAsset moves active file into history/", async () => {
  const root = join(tmpdir(), `canvas-hist-${Date.now()}`);
  await mkdir(join(root, "canvas", "assets"), { recursive: true });
  const active = join(root, "canvas", "assets", "vid-1.mp4");
  await writeFile(active, Buffer.from("version-one"));

  const shot: Shot = {
    id: "vid-1",
    kind: "video",
    prompt: "go",
    from: "img-1",
    duration: 10,
    status: "ready",
    asset: "assets/vid-1.mp4",
    hash: "abc",
    message: null,
    updatedAt: new Date().toISOString(),
  };

  const entry = await archiveActiveAsset(root, shot);
  assert.ok(entry);
  assert.match(entry!.asset, /^assets\/history\/vid-1\//);
  const archivedBytes = await readFile(join(root, "canvas", entry!.asset));
  assert.equal(archivedBytes.toString(), "version-one");
  // active path should be gone after rename
  await assert.rejects(() => readFile(active));
  await rm(root, { recursive: true, force: true });
});

test("restoreHistoryAsset promotes history and archives previous active", async () => {
  const root = join(tmpdir(), `canvas-restore-${Date.now()}`);
  await mkdir(join(root, "canvas", "assets", "history", "vid-1"), { recursive: true });
  const active = join(root, "canvas", "assets", "vid-1.mp4");
  const histRel = "assets/history/vid-1/old.mp4";
  const histAbs = join(root, "canvas", histRel);
  await writeFile(active, Buffer.from("current"));
  await writeFile(histAbs, Buffer.from("old-version"));

  let project: Project = {
    ...emptyProject("hist"),
    shots: [
      {
        id: "img-1",
        kind: "image",
        prompt: "a",
        aspect: "16:9",
        provider: "grok",
        status: "ready",
        asset: "assets/img-1.png",
        hash: "x",
        message: null,
        updatedAt: new Date().toISOString(),
      },
      {
        id: "vid-1",
        kind: "video",
        prompt: "go",
        from: "img-1",
        duration: 10,
        status: "ready",
        asset: "assets/vid-1.mp4",
        hash: "newhash",
        history: [
          {
            asset: histRel,
            hash: "oldhash",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        message: null,
        updatedAt: new Date().toISOString(),
      },
    ],
  };
  await saveProject(root, project);
  // saveProject may re-read — use our project for restore
  project = await restoreHistoryAsset(root, project, "vid-1", histRel);
  const vid = project.shots.find((s) => s.id === "vid-1")!;
  assert.equal(vid.asset, "assets/vid-1.mp4");
  assert.equal(vid.hash, "oldhash");
  assert.equal(await readFile(active, "utf8"), "old-version");
  // previous current should now be in history
  assert.ok((vid.history ?? []).some((h) => h.hash === "newhash" || h.asset.includes("history")));
  await rm(root, { recursive: true, force: true });
});
