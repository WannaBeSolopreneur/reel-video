# Camera Path Editor

A GLB apartment, an exact camera trajectory, a rendered video. No generative
video model, no "interpret this adverb" — the camera goes where the keyframes
say, at the times they say.

```
GLB  →  Three.js scene  →  keyframes  →  spline  →  preview  →  WebM
```

## Run it

```bash
npm run camera-path      # http://localhost:5174
```

ES modules and GLB fetches both need a real origin, so opening `index.html`
from the filesystem will not work. Three.js loads from unpkg via an importmap,
so the first load needs network access.

Then either drop a `.glb` onto the viewport, click **Load GLB**, or put the file
at `camera-path/models/apartment.glb` and it loads on startup.

## Building a shot

1. Orbit / pan until the viewport shows the frame you want. The orbit pivot
   **is** the look-target, so aiming the shot and setting the target are the
   same gesture.
2. **Add Keyframe** — stores position, target and FOV as they are right now.
   Each new keyframe lands 10 s after the previous one, extending the duration
   if needed. Drag the frames' times by editing the JSON, or re-record a frame
   with **Update**.
3. Repeat for the rest of the move, then **Preview Path**.
4. **Export Camera JSON** to keep it, **Record Video** to render it.

Keyboard: `space` preview/stop, `k` add keyframe, `←` / `→` step keyframes.

The blue spline is the position path, the dashed orange spline is the target
path, and the grey tie-lines connect each position to the target it is looking
at. Both are hidden during preview and recording.

## Why position and target are separate

A listing walkthrough moves forward down the hall while the gaze drifts left
onto the kitchen island. Pointing the camera along its direction of travel
cannot express that, so the trajectory carries two independent curves:

```js
camera.position.copy(interpolatedPosition);
camera.lookAt(interpolatedTarget);
```

## Determinism

Both curves are `THREE.CatmullRomCurve3` (centripetal for 3+ keyframes).
Sampling is *time-exact*, not arc-length: within segment `i`,
`u = (t - t_i) / (t_{i+1} - t_i)` and the curve is read at `(i + u) / (n - 1)`.
Catmull-Rom passes exactly through control point `i` at that parameter, so the
camera is at keyframe `i` at time `t_i` to the float — no drift.

`path.measure(t0, t1)` returns the straight-line translation and the yaw delta
across a window, so "10 s segment, 0.30 m, 4.0°" is a number you can check
rather than a hope. `window.cameraPath` is exposed in the console for that.

Easing options change *pacing only* — keyframe poses at keyframe times are
untouched:

| Mode | Effect |
| --- | --- |
| `linear` | constant speed within each segment |
| `smoothstep` | ease in/out at every keyframe |
| `global` | ease in/out across the whole shot |

## Model normalisation

Raw GLB units are unknown, so nothing downstream assumes metres. On load the
model is centred on X/Z, its floor dropped to Y = 0, and its longest horizontal
side scaled to the target size (default 12 units). After that 1 unit = 1 m by
construction and eye height 1.6 means what it says. Uncheck **Center &
normalize** to keep the authored transform.

## JSON format

```json
{
  "duration": 30,
  "easing": "linear",
  "keyframes": [
    { "time": 0,  "position": [0.2, 1.6, 2.1], "target": [0.1, 1.2, 0.5], "fov": 50 },
    { "time": 10, "position": [0.2, 1.6, 1.8], "target": [0.0, 1.2, 0.2], "fov": 50 }
  ]
}
```

Re-importable, so one model plus a folder of these JSON files gives you as many
reproducible shots as you like — living→dining→kitchen, a kitchen orbit, a
vertical social cut — without touching the model again. `easing` is optional and
defaults to `linear`. Drop a `.json` on the viewport to import it.

See `examples/living-dining-kitchen.json` for the walkthrough from the spec.

## Recording

`canvas.captureStream()` + `MediaRecorder` → WebM, at 1080p/720p/vertical/square
or the current viewport. Capture is real time, so playback runs off the wall
clock and the machine's frame rate decides which times get sampled; the path
itself is a pure function of time, so the *move* is identical every run. Convert
with `ffmpeg -i shot.webm -c:v libx264 -crf 18 shot.mp4` if you need H.264.

## Files

```
camera-path/
  index.html        markup + importmap
  style.css
  serve.js          zero-dependency static server
  src/
    scene.js            renderer, lights, tone mapping, render loop
    modelLoader.js      GLTF/Draco/meshopt loading + normalisation
    cameraController.js OrbitControls in edit mode, path-driven in playback
    cameraPath.js       keyframes, interpolation, JSON — the deterministic core
    pathView.js         in-scene spline + keyframe markers
    recorder.js         canvas → WebM
    ui.js               DOM only, no Three.js
    main.js             glue
```

`cameraPath.js` has no DOM or renderer dependency and is covered by
`test/camera-path.test.js` (`npm test`).
