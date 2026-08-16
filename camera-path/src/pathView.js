/**
 * In-scene visualisation of the trajectory: the position spline, the target
 * spline, keyframe markers, and a tie-line from each position to its own look
 * target so the position/target separation is visible while editing.
 *
 * Hidden automatically during playback and recording so it never lands in the
 * exported video.
 */

import * as THREE from "three";

export function createPathView(scene, path) {
  const group = new THREE.Group();
  group.renderOrder = 2;
  scene.add(group);

  const posLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x4f8cff, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  const targetLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({
      color: 0xffb347,
      dashSize: 0.18,
      gapSize: 0.12,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    }),
  );
  const tieLines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x6b7688, depthTest: false, transparent: true, opacity: 0.55 }),
  );
  group.add(posLine, targetLine, tieLines);

  const markers = new THREE.Group();
  group.add(markers);

  const posGeo = new THREE.SphereGeometry(1, 16, 12);
  const targetGeo = new THREE.BoxGeometry(1, 1, 1);
  const posMat = new THREE.MeshBasicMaterial({ color: 0x4f8cff, depthTest: false });
  const selMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  const targetMat = new THREE.MeshBasicMaterial({ color: 0xffb347, depthTest: false });

  let markerScale = 0.08;

  function setScale(sceneRadius) {
    markerScale = Math.max(sceneRadius * 0.012, 0.03);
  }

  function refresh(selectedIndex = -1) {
    const pts = path.positionPoints(300);
    const tpts = path.targetPoints(300);
    posLine.geometry.dispose();
    posLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    targetLine.geometry.dispose();
    targetLine.geometry = new THREE.BufferGeometry().setFromPoints(tpts);
    if (tpts.length > 1) targetLine.computeLineDistances();

    const tie = [];
    for (const k of path.keyframes) {
      tie.push(new THREE.Vector3(...k.position), new THREE.Vector3(...k.target));
    }
    tieLines.geometry.dispose();
    tieLines.geometry = new THREE.BufferGeometry().setFromPoints(tie);

    markers.clear();
    path.keyframes.forEach((k, i) => {
      const p = new THREE.Mesh(posGeo, i === selectedIndex ? selMat : posMat);
      p.position.fromArray(k.position);
      p.scale.setScalar(markerScale * (i === selectedIndex ? 1.5 : 1));
      const t = new THREE.Mesh(targetGeo, targetMat);
      t.position.fromArray(k.target);
      t.scale.setScalar(markerScale * 1.2);
      markers.add(p, t);
    });
  }

  return {
    group,
    refresh,
    setScale,
    setVisible(v) {
      group.visible = v;
    },
  };
}
