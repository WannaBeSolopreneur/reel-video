import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractMotionPrompt,
  pickReviewImagePaths,
} from "../src/motion-from-strip.ts";

test("extractMotionPrompt reads BEGIN_MOTION block", () => {
  const raw = `thinking...
BEGIN_MOTION
=== SCENE VIDEO TEMPLATE (10s) ===
Continuous 10-second SINGLE TAKE of scene "x".
CORE ACTION: skinny guy denied the bench
SETUP note [00:00–00:03]: approaches hopeful
PEAK note [00:03–00:07]: muscle guy shakes head
AFTERMATH note [00:07–00:10]: shoulders slump
END_MOTION
done`;
  const p = extractMotionPrompt(raw);
  assert.ok(p);
  assert.match(p!, /skinny guy denied/);
  assert.match(p!, /SCENE VIDEO TEMPLATE/);
});

test("extractMotionPrompt ignores placeholder ellipsis blocks", () => {
  const raw = `user said:
<<<MOTION_PROMPT
...
>>>MOTION_PROMPT
assistant:
BEGIN_MOTION
=== SCENE VIDEO TEMPLATE (10s) — from strip review ===
Continuous 10-second SINGLE TAKE of scene "Bench denied".
CORE ACTION: asks for the bench and is refused
SETUP note [00:00–00:03]: walks up
PEAK note [00:03–00:07]: denied with head shake
AFTERMATH note [00:07–00:10]: walks away sad
END_MOTION`;
  const p = extractMotionPrompt(raw);
  assert.ok(p);
  assert.match(p!, /asks for the bench/);
  assert.doesNotMatch(p!, /^\.\.\.$/);
});

test("extractMotionPrompt falls back to template header", () => {
  const raw = `Here you go:\n=== SCENE VIDEO TEMPLATE (10s) — from strip review ===\nContinuous 10-second SINGLE TAKE of scene "x".\nCORE ACTION: sit down carefully\nSETUP note [00:00–00:03]: walks in\nPEAK note [00:03–00:07]: sits\nAFTERMATH note [00:07–00:10]: settles\n`;
  const p = extractMotionPrompt(raw);
  assert.ok(p);
  assert.match(p!, /CORE ACTION: sit down carefully/);
});

test("pickReviewImagePaths prefers three frames over strip", () => {
  const paths = pickReviewImagePaths({
    stripPath: "/a/strip.png",
    firstPath: "/a/f.png",
    middlePath: "/a/m.png",
    lastPath: "/a/l.png",
  });
  assert.deepEqual(paths, ["/a/f.png", "/a/m.png", "/a/l.png"]);
});

test("pickReviewImagePaths falls back to strip", () => {
  const paths = pickReviewImagePaths({
    stripPath: "/a/strip.png",
    firstPath: null,
    middlePath: null,
    lastPath: null,
  });
  assert.deepEqual(paths, ["/a/strip.png"]);
});
