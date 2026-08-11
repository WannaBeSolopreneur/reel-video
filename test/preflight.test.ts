import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  describeMediaTools,
  ffmpegInstallHint,
  hasBin,
  type MediaToolReport,
} from "../src/preflight.ts";

const report = (over: Partial<MediaToolReport> = {}): MediaToolReport => ({
  ffmpeg: false,
  sips: false,
  canCrop: false,
  canStitch: false,
  ...over,
});

test("hasBin finds a binary that exists", async () => {
  assert.equal(await hasBin("node"), true);
});

test("hasBin returns false for a missing binary", async () => {
  assert.equal(await hasBin("definitely-not-a-real-binary-xyz"), false);
});

test("describeMediaTools is silent when ffmpeg is present", () => {
  const msg = describeMediaTools(
    report({ ffmpeg: true, canCrop: true, canStitch: true }),
  );
  assert.equal(msg, null);
});

test("describeMediaTools hard-fails when nothing can crop", () => {
  const msg = describeMediaTools(report());
  assert.ok(msg, "expected a message");
  assert.match(msg, /ffmpeg is required/);
  assert.match(msg, /--skip-checks/);
});

test("describeMediaTools warns but allows sips-only (crop yes, stitch no)", () => {
  const msg = describeMediaTools(report({ sips: true, canCrop: true }));
  assert.ok(msg, "expected a message");
  assert.match(msg, /WARNING/);
  assert.match(msg, /stitch/i);
  assert.doesNotMatch(msg, /--skip-checks/);
});

test("ffmpegInstallHint is platform specific", () => {
  assert.match(ffmpegInstallHint("darwin"), /brew install ffmpeg/);
  assert.match(ffmpegInstallHint("win32"), /winget|choco/);
  assert.match(ffmpegInstallHint("linux"), /apt|dnf|pacman/);
});
