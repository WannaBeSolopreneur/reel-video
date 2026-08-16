/**
 * The camera trajectory: keyframes in, an exact camera state at time t out.
 *
 * Position and look-target are two independent Catmull-Rom curves. That
 * separation is the whole point — a real-estate move can push forward down the
 * hallway while the target drifts left onto the kitchen island, which a single
 * "look where you're going" curve cannot express.
 *
 * Timing is exact rather than arc-length based. Segment i of the curve is
 * parameterised as u = (t - t_i) / (t_{i+1} - t_i), and sampled at global
 * parameter (i + u) / (n - 1). Catmull-Rom passes exactly through control point
 * i at that parameter, so the camera is at keyframe i at time t_i to the float —
 * no drift, no generative interpretation of "slowly".
 */

import * as THREE from "three";

export const EASINGS = {
  linear: (u) => u,
  smoothstep: (u) => u * u * (3 - 2 * u),
  global: (u) => u, // applied to the whole timeline instead, see sample()
};

function smoothstep(u) {
  return u * u * (3 - 2 * u);
}

export class CameraPath {
  constructor() {
    /** @type {{time:number, position:number[], target:number[], fov:number}[]} */
    this.keyframes = [];
    this.duration = 30;
    this.easing = "linear";
    this._dirty = true;
    this._posCurve = null;
    this._targetCurve = null;
  }

  get length() {
    return this.keyframes.length;
  }

  /** Keyframes are always kept sorted by time; returns the new index. */
  add({ time, position, target, fov = 50 }) {
    const kf = {
      time: clamp(time, 0, this.duration),
      position: [...position],
      target: [...target],
      fov,
    };
    this.keyframes.push(kf);
    this.keyframes.sort((a, b) => a.time - b.time);
    this._dirty = true;
    return this.keyframes.indexOf(kf);
  }

  update(index, patch) {
    const kf = this.keyframes[index];
    if (!kf) return index;
    Object.assign(kf, patch);
    if (patch.position) kf.position = [...patch.position];
    if (patch.target) kf.target = [...patch.target];
    this.keyframes.sort((a, b) => a.time - b.time);
    this._dirty = true;
    return this.keyframes.indexOf(kf);
  }

  remove(index) {
    this.keyframes.splice(index, 1);
    this._dirty = true;
  }

  clear() {
    this.keyframes = [];
    this._dirty = true;
  }

  setDuration(seconds) {
    this.duration = Math.max(0.001, seconds);
    for (const kf of this.keyframes) kf.time = clamp(kf.time, 0, this.duration);
    this._dirty = true;
  }

  setEasing(name) {
    this.easing = name in EASINGS ? name : "linear";
    this._dirty = true;
  }

  _build() {
    if (!this._dirty) return;
    const n = this.keyframes.length;
    if (n >= 2) {
      const type = n >= 3 ? "centripetal" : "catmullrom";
      this._posCurve = new THREE.CatmullRomCurve3(
        this.keyframes.map((k) => new THREE.Vector3(...k.position)),
        false,
        type,
        0.5,
      );
      this._targetCurve = new THREE.CatmullRomCurve3(
        this.keyframes.map((k) => new THREE.Vector3(...k.target)),
        false,
        type,
        0.5,
      );
    } else {
      this._posCurve = null;
      this._targetCurve = null;
    }
    this._dirty = false;
  }

  /**
   * Camera state at absolute time `t` (seconds).
   * @returns {{position:THREE.Vector3, target:THREE.Vector3, fov:number}|null}
   */
  sample(t, out = {}) {
    const n = this.keyframes.length;
    if (n === 0) return null;

    const position = out.position || new THREE.Vector3();
    const target = out.target || new THREE.Vector3();

    if (n === 1) {
      const k = this.keyframes[0];
      return { position: position.fromArray(k.position), target: target.fromArray(k.target), fov: k.fov };
    }

    this._build();

    let time = clamp(t, 0, this.duration);
    if (this.easing === "global") {
      const first = this.keyframes[0].time;
      const last = this.keyframes[n - 1].time;
      const span = last - first;
      time = span > 0 ? first + smoothstep((time - first) / span) * span : time;
      time = clamp(time, 0, this.duration);
    }

    // Locate the segment and the local parameter within it.
    let i = 0;
    while (i < n - 2 && time >= this.keyframes[i + 1].time) i++;
    const a = this.keyframes[i];
    const b = this.keyframes[i + 1];
    const span = b.time - a.time;
    let u = span > 0 ? (time - a.time) / span : 0;
    u = clamp(u, 0, 1);
    if (this.easing === "smoothstep") u = smoothstep(u);

    const g = (i + u) / (n - 1);
    this._posCurve.getPoint(g, position);
    this._targetCurve.getPoint(g, target);

    return { position, target, fov: a.fov + (b.fov - a.fov) * u };
  }

  /** Dense polyline of the position curve, for drawing the path in-scene. */
  positionPoints(divisions = 200) {
    if (this.keyframes.length === 1) return [new THREE.Vector3(...this.keyframes[0].position)];
    this._build();
    return this._posCurve ? this._posCurve.getPoints(divisions) : [];
  }

  targetPoints(divisions = 200) {
    if (this.keyframes.length === 1) return [new THREE.Vector3(...this.keyframes[0].target)];
    this._build();
    return this._targetCurve ? this._targetCurve.getPoints(divisions) : [];
  }

  /**
   * Straight-line translation and yaw change over a time window — the numbers
   * you quote when you say "10s segment, 0.3 m, 4 degrees".
   */
  measure(t0, t1) {
    const a = this.sample(t0, { position: new THREE.Vector3(), target: new THREE.Vector3() });
    const b = this.sample(t1, { position: new THREE.Vector3(), target: new THREE.Vector3() });
    if (!a || !b) return null;
    const translation = a.position.distanceTo(b.position);
    const yawOf = (s) => {
      const d = s.target.clone().sub(s.position);
      return Math.atan2(d.x, d.z);
    };
    let yaw = yawOf(b) - yawOf(a);
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;
    return { translation, yawDegrees: THREE.MathUtils.radToDeg(yaw) };
  }

  toJSON() {
    return {
      duration: round(this.duration, 4),
      easing: this.easing,
      keyframes: this.keyframes.map((k) => ({
        time: round(k.time, 4),
        position: k.position.map((v) => round(v, 5)),
        target: k.target.map((v) => round(v, 5)),
        fov: round(k.fov, 3),
      })),
    };
  }

  static fromJSON(json) {
    const path = new CameraPath();
    if (!json || !Array.isArray(json.keyframes)) throw new Error("Not a camera path: missing keyframes[]");
    path.duration = Number(json.duration) > 0 ? Number(json.duration) : 30;
    path.easing = json.easing in EASINGS ? json.easing : "linear";
    for (const k of json.keyframes) {
      if (!Array.isArray(k.position) || k.position.length !== 3) throw new Error("Keyframe position must be [x,y,z]");
      if (!Array.isArray(k.target) || k.target.length !== 3) throw new Error("Keyframe target must be [x,y,z]");
      path.keyframes.push({
        time: Number(k.time) || 0,
        position: k.position.map(Number),
        target: k.target.map(Number),
        fov: Number(k.fov) || 50,
      });
    }
    path.keyframes.sort((a, b) => a.time - b.time);
    path._dirty = true;
    return path;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
