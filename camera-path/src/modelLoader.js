/**
 * GLB loading and normalisation.
 *
 * Raw GLB units are unknown, so nothing downstream may assume metres. We
 * measure the bounding box, centre the model on the X/Z origin, drop its floor
 * to Y = 0, and scale the longest horizontal side to a caller-supplied target
 * (default 12 units). After that "1 unit = 1 metre" is true by construction and
 * an eye height of 1.6 means what it says.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath("https://unpkg.com/three@0.185.1/examples/jsm/libs/draco/");
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);

export async function loadGLB(url) {
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

export function loadGLBFromFile(file) {
  const url = URL.createObjectURL(file);
  return loadGLB(url).finally(() => URL.revokeObjectURL(url));
}

/**
 * Centre, floor and rescale `root` in place.
 * Returns the measurements so the UI can report what it did.
 */
export function normalizeModel(root, { targetSize = 12, enabled = true } = {}) {
  root.position.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const rawLongest = Math.max(size.x, size.z) || Math.max(size.x, size.y, size.z) || 1;

  const scale = enabled ? targetSize / rawLongest : 1;
  root.scale.setScalar(scale);

  if (enabled) {
    // Centre on X/Z, sit the lowest geometry on Y = 0.
    root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  }
  root.updateMatrixWorld(true);

  const finalBox = new THREE.Box3().setFromObject(root);
  const finalSize = finalBox.getSize(new THREE.Vector3());

  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Interior shells are usually modelled single-sided from outside.
      if (obj.material && obj.material.side === THREE.FrontSide) {
        obj.material.side = THREE.DoubleSide;
      }
    }
  });

  return {
    scale,
    rawSize: size,
    size: finalSize,
    box: finalBox,
    radius: finalSize.length() / 2,
  };
}
