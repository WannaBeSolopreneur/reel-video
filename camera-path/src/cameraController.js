/**
 * Two camera modes over one PerspectiveCamera.
 *
 * Edit mode: OrbitControls drives the camera; `controls.target` doubles as the
 * look-target that gets stored in a keyframe, which is why aiming a shot is
 * just orbiting until it looks right.
 *
 * Playback mode: OrbitControls is disabled and the camera is driven from the
 * CameraPath — position from one curve, lookAt from the other, never coupled.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createCameraController(viewer, path) {
  const { camera, renderer } = viewer;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.target.set(0, 1.2, 0);

  const scratch = { position: new THREE.Vector3(), target: new THREE.Vector3() };

  let playing = false;
  let time = 0;
  let onTick = null;
  let onEnd = null;

  /** Snapshot the current view as keyframe data. */
  function capture() {
    return {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      fov: camera.fov,
    };
  }

  /** Move the live camera to a stored keyframe (keeps orbit pivot in sync). */
  function apply(kf) {
    camera.position.fromArray(kf.position);
    controls.target.fromArray(kf.target);
    if (kf.fov) {
      camera.fov = kf.fov;
      camera.updateProjectionMatrix();
    }
    controls.update();
  }

  /** Put the camera at human eye height, keeping the current look direction. */
  function toEyeHeight(height = 1.6) {
    const dir = controls.target.clone().sub(camera.position);
    camera.position.y = height;
    controls.target.copy(camera.position).add(dir);
    controls.target.y = height + dir.y * 0.15; // near-level gaze
    controls.update();
  }

  /** Pose the camera at absolute time t without changing play state. */
  function seek(t) {
    time = Math.max(0, Math.min(t, path.duration));
    const s = path.sample(time, scratch);
    if (!s) return time;
    camera.position.copy(s.position);
    camera.lookAt(s.target);
    if (camera.fov !== s.fov) {
      camera.fov = s.fov;
      camera.updateProjectionMatrix();
    }
    // Keep the orbit pivot under the shot so leaving playback is not a jump.
    controls.target.copy(s.target);
    if (onTick) onTick(time);
    return time;
  }

  function play({ from = 0, onTick: tick = null, onEnd: end = null } = {}) {
    if (path.length < 1) return false;
    onTick = tick;
    onEnd = end;
    time = from;
    playing = true;
    controls.enabled = false;
    seek(time);
    return true;
  }

  function stop() {
    if (!playing) return;
    playing = false;
    controls.enabled = true;
    controls.update();
    const done = onEnd;
    onEnd = null;
    if (done) done();
  }

  viewer.onUpdate((dt) => {
    if (playing) {
      time += dt;
      if (time >= path.duration) {
        seek(path.duration);
        stop();
      } else {
        seek(time);
      }
    } else {
      controls.update();
    }
  });

  return {
    controls,
    capture,
    apply,
    toEyeHeight,
    seek,
    play,
    stop,
    get playing() {
      return playing;
    },
    get time() {
      return time;
    },
    /** Frame the whole model, for the initial view after loading a GLB. */
    frame(box) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const dist = Math.max(size.x, size.z) * 1.1 + size.y;
      camera.position.set(center.x + dist * 0.7, center.y + size.y * 1.2, center.z + dist * 0.7);
      controls.target.set(center.x, size.y * 0.35, center.z);
      camera.near = Math.max(0.02, dist / 5000);
      camera.far = dist * 20;
      camera.updateProjectionMatrix();
      controls.update();
    },
  };
}
