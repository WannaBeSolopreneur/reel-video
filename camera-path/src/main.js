/**
 * Glue: GLB model + camera trajectory = reproducible video.
 *
 * Nothing here is generative. A keyframe is the exact camera transform you were
 * looking at when you pressed the button, and playback is a pure function of
 * time over those keyframes.
 */

import * as THREE from "three";
import { createViewer } from "./scene.js";
import { loadGLBFromFile, loadGLB, normalizeModel } from "./modelLoader.js";
import { CameraPath } from "./cameraPath.js";
import { createCameraController } from "./cameraController.js";
import { createPathView } from "./pathView.js";
import { startRecording, downloadBlob, isSupported as canRecord } from "./recorder.js";
import { createUI } from "./ui.js";

const DEFAULT_GAP = 10; // seconds between successive keyframes
const EYE_HEIGHT = 1.6;

const canvas = document.getElementById("scene");

let viewer;
try {
  viewer = createViewer(canvas);
} catch (err) {
  // No WebGL (headless browser, blocklisted GPU, hardware acceleration off).
  // Say so in the page instead of leaving a blank canvas and a console trace.
  const hint = document.getElementById("drop-hint");
  hint.classList.remove("hidden");
  hint.textContent = `WebGL is unavailable in this browser, so the scene cannot render. (${err.message})`;
  throw err;
}

const path = new CameraPath();
const controller = createCameraController(viewer, path);
const pathView = createPathView(viewer.scene, path);

let model = null;
let modelStats = null;
let selected = -1;
let recording = null;
let showPath = true;

const ui = createUI({
  loadFile: (file) => loadModelFromFile(file),
  importJson: (file) => importJson(file),
  renormalize: () => applyNormalize(),
  eyeHeight: () => controller.toEyeHeight(EYE_HEIGHT),
  addKeyframe,
  updateKeyframe,
  deleteKeyframe,
  step,
  select,
  gotoSelected,
  setDuration,
  setEasing,
  setShowPath,
  preview,
  stop: stopAll,
  togglePlay: () => (controller.playing ? stopAll() : preview()),
  scrub,
  exportJson,
  record,
});

ui.renderKeyframes(path, selected);
ui.syncSettings(path);
ui.setPlayhead(0, path.duration);
if (!canRecord()) ui.setStatus("This browser cannot record WebM — export the JSON instead.");

// ---------------------------------------------------------------- model

async function loadModelFromFile(file) {
  ui.setModelInfo(`Loading ${file.name}…`);
  try {
    const root = await loadGLBFromFile(file);
    installModel(root, file.name);
  } catch (err) {
    ui.setModelInfo(`Failed to load ${file.name}: ${err.message}`);
  }
}

function installModel(root, name) {
  if (model) {
    viewer.scene.remove(model);
    disposeTree(model);
  }
  model = root;
  model.name = name;
  viewer.scene.add(model);
  applyNormalize(true);

  // Still taller than wide after the up-axis fix means this really is an object
  // to orbit, not an interior; scaling its floor plan would inflate it absurdly.
  if (modelStats.objectLike && ui.el.normalizeFit.value === "horizontal") {
    ui.el.normalizeFit.value = "overall";
    applyNormalize(true);
  }
  ui.setDropHintVisible(false);
}

function applyNormalize(frameCamera = false) {
  if (!model) return;
  modelStats = normalizeModel(model, ui.normalizeOptions);
  viewer.frameLights(modelStats.radius);
  pathView.setScale(modelStats.radius);
  pathView.refresh(selected);
  if (frameCamera) controller.frame(modelStats.box);

  const s = modelStats.size;
  const raw = modelStats.rawSize;
  ui.setModelInfo(
    `${model.name} — ${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)} units ` +
      `(raw ${raw.x.toFixed(2)} × ${raw.y.toFixed(2)} × ${raw.z.toFixed(2)}, scaled ×${modelStats.scale.toFixed(4)}). ` +
      `${modelStats.upAxis === "z" ? "Z-up, laid flat. " : ""}Floor at Y=0, eye height ${EYE_HEIGHT}.` +
      (modelStats.objectLike ? " Taller than wide — orbit it rather than walking through it." : ""),
  );
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m?.dispose();
    }
  });
}

// ------------------------------------------------------------ keyframes

/** Next keyframe time: DEFAULT_GAP after the last one, extending the shot if needed. */
function nextTime() {
  if (path.length === 0) return 0;
  const last = path.keyframes[path.length - 1].time;
  const t = last + DEFAULT_GAP;
  if (t > path.duration) {
    setDuration(t);
    ui.syncSettings(path);
  }
  return t;
}

function addKeyframe() {
  const kf = { time: nextTime(), ...controller.capture() };
  selected = path.add(kf);
  refresh();
}

function updateKeyframe() {
  if (selected < 0 || selected >= path.length) return;
  selected = path.update(selected, controller.capture());
  refresh();
}

function deleteKeyframe() {
  if (selected < 0 || selected >= path.length) return;
  path.remove(selected);
  selected = Math.min(selected, path.length - 1);
  refresh();
}

function select(index, andGoto = false) {
  selected = index;
  refresh();
  if (andGoto) gotoSelected();
}

function step(delta) {
  if (path.length === 0) return;
  selected = (selected + delta + path.length) % path.length;
  refresh();
  gotoSelected();
}

function gotoSelected() {
  const kf = path.keyframes[selected];
  if (!kf) return;
  stopAll();
  controller.apply(kf);
  ui.setPlayhead(kf.time, path.duration);
}

function refresh() {
  pathView.refresh(selected);
  ui.renderKeyframes(path, selected);
}

// ------------------------------------------------------------- playback

function setDuration(seconds) {
  path.setDuration(seconds);
  refresh();
  ui.setPlayhead(Math.min(controller.time, path.duration), path.duration);
}

function setEasing(name) {
  path.setEasing(name);
  refresh();
}

function setShowPath(v) {
  showPath = v;
  pathView.setVisible(v);
}

function preview() {
  if (path.length === 0) return;
  pathView.setVisible(false);
  ui.setPlaying(true);
  controller.play({
    from: 0,
    onTick: (t) => ui.setPlayhead(t, path.duration),
    onEnd: () => {
      ui.setPlaying(false);
      pathView.setVisible(showPath);
      if (recording) finishRecording();
    },
  });
}

function stopAll() {
  if (controller.playing) controller.stop();
  else if (recording) finishRecording();
  ui.setPlaying(false);
  pathView.setVisible(showPath);
}

function scrub(fraction) {
  if (controller.playing) controller.stop();
  const t = fraction * path.duration;
  controller.seek(t);
  ui.setPlayhead(t, path.duration);
}

// --------------------------------------------------------------- export

function exportJson() {
  const json = JSON.stringify(path.toJSON(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, `camera-path-${stamp()}.json`);
  ui.setStatus(`Exported ${path.length} keyframes over ${path.duration}s.`);
}

async function importJson(file) {
  try {
    const loaded = CameraPath.fromJSON(JSON.parse(await file.text()));
    path.clear();
    path.duration = loaded.duration;
    path.easing = loaded.easing;
    for (const k of loaded.keyframes) path.add(k);
    selected = path.length ? 0 : -1;
    ui.syncSettings(path);
    refresh();
    if (selected >= 0) gotoSelected();
    ui.setStatus(`Imported ${path.length} keyframes from ${file.name}.`);
  } catch (err) {
    ui.setStatus(`Could not import ${file.name}: ${err.message}`);
  }
}

// -------------------------------------------------------------- record

function record() {
  if (recording) {
    stopAll();
    return;
  }
  if (path.length === 0) return;

  const size = resolveRecordSize();
  viewer.setRenderSize(size);
  pathView.setVisible(false);

  // Pose the camera on the first keyframe *before* capture opens, otherwise
  // frame 0 of the video is whatever the editor happened to be looking at.
  controller.seek(0);

  // Two frames: one to render at the new size, one to be sure the posed frame
  // is on the canvas before the stream starts reading it.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      recording = startRecording(canvas, { fps: 60, bitrateMbps: ui.bitrate });
    } catch (err) {
      viewer.setRenderSize(null);
      pathView.setVisible(showPath);
      ui.setStatus(err.message);
      return;
    }
    ui.setRecording(true);
    ui.setStatus(`Recording ${size ? `${size.width}×${size.height}` : "viewport"} for ${path.duration}s…`);
    preview();
  }));
}

async function finishRecording() {
  const rec = recording;
  recording = null;
  ui.setRecording(false);
  try {
    const blob = await rec.stop();
    // Kept so the recording can be retrieved from the console if the browser's
    // download handling gets in the way (automation profiles, blocked saves).
    window.lastRecording = blob;
    downloadBlob(blob, `camera-shot-${stamp()}.webm`);
    ui.setStatus(`Saved ${(blob.size / 1e6).toFixed(1)} MB WebM.`);
  } catch (err) {
    ui.setStatus(`Recording failed: ${err.message}`);
  } finally {
    viewer.setRenderSize(null);
    pathView.setVisible(showPath);
  }
}

function resolveRecordSize() {
  const value = ui.recordSize;
  if (value === "viewport") return null;
  const [width, height] = value.split("x").map(Number);
  return { width, height };
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

// ------------------------------------------------------------- startup

// Convenience: drop an apartment.glb into camera-path/models/ and it loads itself.
loadGLB("./models/apartment.glb")
  .then((root) => installModel(root, "apartment.glb"))
  .catch(() => {
    /* no default model — the drop hint stays up */
  });

// Expose the working parts for console-driven scripting / debugging.
window.cameraPath = path;
window.cameraController = controller;
// Call after mutating cameraPath from the console so the list, timeline and
// button states catch up with the data.
window.refreshUI = () => {
  ui.syncSettings(path);
  refresh();
};
window.viewer = viewer;
window.THREE = THREE;
