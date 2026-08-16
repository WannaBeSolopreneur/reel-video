/**
 * Renderer, scene, lights, camera and the render loop.
 *
 * Colour management matters here: the GLB ships its own PBR materials and
 * textures, so we render in sRGB with ACES tone mapping and light the room with
 * a neutral environment instead of re-authoring any material.
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11141a);

  // Image-based lighting so PBR metal/rough surfaces have something to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x404652, 1.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
  sun.position.set(6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xdce6ff, 0.6);
  fill.position.set(-8, 6, -6);
  scene.add(fill);

  const grid = new THREE.GridHelper(40, 40, 0x3a4252, 0x232833);
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
  camera.position.set(6, 4, 8);

  /** Set the shadow frustum to whatever the model turned out to be. */
  function frameLights(radius) {
    const r = Math.max(radius, 1);
    sun.position.set(r * 0.8, r * 1.6, r * 1.0);
    const cam = sun.shadow.camera;
    cam.left = -r * 1.5;
    cam.right = r * 1.5;
    cam.top = r * 1.5;
    cam.bottom = -r * 1.5;
    cam.near = 0.1;
    cam.far = r * 6;
    cam.updateProjectionMatrix();
    grid.scale.setScalar(Math.max(r / 10, 0.25));
  }

  let overrideSize = null; // {width, height} while recording

  function resize() {
    if (overrideSize) return;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /**
   * Render at an exact pixel size (for recording) regardless of the window.
   * Pass null to hand the canvas back to the layout.
   */
  function setRenderSize(size) {
    overrideSize = size;
    if (size) {
      renderer.setPixelRatio(1);
      renderer.setSize(size.width, size.height, false);
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
    } else {
      resize();
    }
  }

  window.addEventListener("resize", resize);
  resize();

  const updaters = new Set();
  const clock = new THREE.Clock();

  function loop() {
    requestAnimationFrame(loop);
    const dt = clock.getDelta();
    for (const fn of updaters) fn(dt);
    renderer.render(scene, camera);
  }
  loop();

  return {
    THREE,
    renderer,
    scene,
    camera,
    grid,
    frameLights,
    setRenderSize,
    onUpdate: (fn) => updaters.add(fn),
  };
}
