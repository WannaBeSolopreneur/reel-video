/**
 * The camera path is the deterministic half of the pipeline: same keyframes and
 * same time in, same camera transform out, every run. These tests pin that down.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CameraPath } from "../camera-path/src/cameraPath.js";

function shot() {
  const path = new CameraPath();
  path.setDuration(30);
  path.add({ time: 0, position: [0.2, 1.6, 2.1], target: [0.1, 1.2, 0.5], fov: 50 });
  path.add({ time: 10, position: [0.2, 1.6, 1.8], target: [0.0, 1.2, 0.2], fov: 50 });
  path.add({ time: 20, position: [0.5, 1.6, 0.9], target: [-1.2, 1.2, -0.4], fov: 50 });
  path.add({ time: 30, position: [1.4, 1.6, 0.3], target: [-1.8, 1.2, -1.1], fov: 40 });
  return path;
}

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

test("keyframes are hit exactly at their own times", () => {
  const path = shot();
  for (const kf of path.keyframes) {
    const s = path.sample(kf.time);
    kf.position.forEach((v, i) => near(s.position.getComponent(i), v));
    kf.target.forEach((v, i) => near(s.target.getComponent(i), v));
    near(s.fov, kf.fov);
  }
});

test("keyframes stay sorted regardless of insertion order", () => {
  const path = new CameraPath();
  path.add({ time: 20, position: [0, 1, 0], target: [0, 1, 1] });
  path.add({ time: 5, position: [1, 1, 0], target: [0, 1, 1] });
  path.add({ time: 12, position: [2, 1, 0], target: [0, 1, 1] });
  assert.deepEqual(path.keyframes.map((k) => k.time), [5, 12, 20]);
});

test("sampling is pure — repeated samples at the same time agree", () => {
  const path = shot();
  for (const t of [0, 3.7, 12.25, 29.999, 30]) {
    const a = path.sample(t);
    const first = [a.position.toArray(), a.target.toArray(), a.fov];
    const b = path.sample(t);
    assert.deepEqual([b.position.toArray(), b.target.toArray(), b.fov], first);
  }
});

test("position and target are independent curves", () => {
  // Camera slides straight along +X while the target swings to -X: if the two
  // were coupled the look direction would follow the movement instead.
  const path = new CameraPath();
  path.setDuration(10);
  path.add({ time: 0, position: [0, 1.6, 0], target: [0, 1.6, -5] });
  path.add({ time: 10, position: [4, 1.6, 0], target: [-5, 1.6, -5] });

  const start = path.sample(0);
  const end = path.sample(10);
  near(end.position.x - start.position.x, 4);
  assert.ok(end.target.x < start.target.x, "target moved the opposite way");
});

test("measure() reports translation and yaw for a segment", () => {
  const path = new CameraPath();
  path.setDuration(10);
  path.add({ time: 0, position: [0, 1.6, 0], target: [0, 1.6, -1] });
  path.add({ time: 10, position: [0, 1.6, -0.3], target: [-0.0699, 1.6, -1.3] });

  const m = path.measure(0, 10);
  near(m.translation, 0.3, 1e-4);
  assert.ok(Math.abs(m.yawDegrees - 4) < 0.15, `yaw ${m.yawDegrees} should be ~4 deg`);
});

test("easing changes the pacing but never the keyframe poses", () => {
  const linear = shot();
  const eased = shot();
  eased.setEasing("smoothstep");

  for (const kf of linear.keyframes) {
    const a = linear.sample(kf.time);
    const b = eased.sample(kf.time);
    assert.deepEqual(b.position.toArray(), a.position.toArray());
  }
  const mid = 2.5; // midpoint would coincide: smoothstep(0.5) === 0.5
  assert.notDeepEqual(eased.sample(mid).position.toArray(), linear.sample(mid).position.toArray());
});

test("JSON round-trips to an identical trajectory", () => {
  const path = shot();
  path.setEasing("smoothstep");
  const restored = CameraPath.fromJSON(JSON.parse(JSON.stringify(path.toJSON())));

  assert.equal(restored.duration, path.duration);
  assert.equal(restored.easing, path.easing);
  for (let t = 0; t <= 30; t += 0.5) {
    const a = path.sample(t);
    const b = restored.sample(t);
    a.position.toArray().forEach((v, i) => near(b.position.getComponent(i), v, 1e-4));
    a.target.toArray().forEach((v, i) => near(b.target.getComponent(i), v, 1e-4));
  }
});

test("fromJSON rejects malformed input", () => {
  assert.throws(() => CameraPath.fromJSON({}), /keyframes/);
  assert.throws(() => CameraPath.fromJSON({ keyframes: [{ time: 0, position: [0, 0], target: [0, 0, 0] }] }), /position/);
});

test("a single keyframe yields a static shot", () => {
  const path = new CameraPath();
  path.add({ time: 0, position: [1, 2, 3], target: [4, 5, 6], fov: 35 });
  for (const t of [0, 7, 30]) {
    const s = path.sample(t);
    assert.deepEqual(s.position.toArray(), [1, 2, 3]);
    assert.deepEqual(s.target.toArray(), [4, 5, 6]);
  }
  assert.equal(path.sample(0).fov, 35);
});

test("an empty path samples to nothing", () => {
  assert.equal(new CameraPath().sample(0), null);
});
