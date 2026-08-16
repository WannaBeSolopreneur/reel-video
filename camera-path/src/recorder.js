/**
 * Canvas -> WebM via MediaRecorder.
 *
 * captureStream() is real time: whatever the renderer draws over the next
 * `duration` seconds is what lands in the file, which is why playback is driven
 * off the wall clock rather than a fixed frame counter. The camera path itself
 * stays deterministic — it is a pure function of time — so the same path always
 * produces the same move, only the sampled frame times vary with machine speed.
 */

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

export function isSupported() {
  return Boolean(pickMimeType());
}

/**
 * Record `canvas` until `stop()` is called.
 * @returns {{stop:()=>Promise<Blob>}}
 */
export function startRecording(canvas, { fps = 60, bitrateMbps = 16 } = {}) {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error("MediaRecorder/WebM is not available in this browser.");

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.round(bitrateMbps * 1_000_000),
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(200);

  return {
    mimeType,
    stop() {
      return new Promise((resolve, reject) => {
        recorder.onerror = (e) => reject(e.error || new Error("Recording failed"));
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          resolve(new Blob(chunks, { type: mimeType }));
        };
        if (recorder.state !== "inactive") recorder.stop();
        else recorder.onstop();
      });
    },
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
