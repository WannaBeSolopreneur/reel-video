/**
 * DOM wiring. Knows nothing about Three.js — it renders the keyframe list and
 * timeline from plain data and calls back into main.js for everything else.
 */

const $ = (id) => document.getElementById(id);

export function createUI(handlers) {
  const el = {
    loadGlb: $("load-glb"),
    glbInput: $("glb-input"),
    normalizeSize: $("normalize-size"),
    normalizeFit: $("normalize-fit"),
    normalizeUp: $("normalize-up"),
    normalizeEnabled: $("normalize-enabled"),
    eyeHeight: $("eye-height"),
    modelInfo: $("model-info"),
    addKf: $("add-kf"),
    updateKf: $("update-kf"),
    deleteKf: $("delete-kf"),
    prevKf: $("prev-kf"),
    nextKf: $("next-kf"),
    gotoKf: $("goto-kf"),
    timeline: $("timeline"),
    kfList: $("kf-list"),
    duration: $("duration"),
    easing: $("easing"),
    showPath: $("show-path"),
    preview: $("preview"),
    stop: $("stop"),
    scrub: $("scrub"),
    playhead: $("playhead"),
    exportJson: $("export-json"),
    importJson: $("import-json"),
    jsonInput: $("json-input"),
    recSize: $("rec-size"),
    recBitrate: $("rec-bitrate"),
    record: $("record"),
    recStatus: $("rec-status"),
    viewport: $("viewport"),
    dropHint: $("drop-hint"),
  };

  el.loadGlb.onclick = () => el.glbInput.click();
  el.glbInput.onchange = () => {
    if (el.glbInput.files[0]) handlers.loadFile(el.glbInput.files[0]);
    el.glbInput.value = "";
  };
  el.importJson.onclick = () => el.jsonInput.click();
  el.jsonInput.onchange = () => {
    if (el.jsonInput.files[0]) handlers.importJson(el.jsonInput.files[0]);
    el.jsonInput.value = "";
  };

  el.normalizeSize.onchange = () => handlers.renormalize();
  el.normalizeFit.onchange = () => handlers.renormalize();
  el.normalizeUp.onchange = () => handlers.renormalize();
  el.normalizeEnabled.onchange = () => handlers.renormalize();
  el.eyeHeight.onclick = () => handlers.eyeHeight();

  el.addKf.onclick = () => handlers.addKeyframe();
  el.updateKf.onclick = () => handlers.updateKeyframe();
  el.deleteKf.onclick = () => handlers.deleteKeyframe();
  el.prevKf.onclick = () => handlers.step(-1);
  el.nextKf.onclick = () => handlers.step(1);
  el.gotoKf.onclick = () => handlers.gotoSelected();

  el.duration.onchange = () => handlers.setDuration(Number(el.duration.value));
  el.easing.onchange = () => handlers.setEasing(el.easing.value);
  el.showPath.onchange = () => handlers.setShowPath(el.showPath.checked);

  el.preview.onclick = () => handlers.preview();
  el.stop.onclick = () => handlers.stop();
  el.scrub.oninput = () => handlers.scrub(Number(el.scrub.value));

  el.exportJson.onclick = () => handlers.exportJson();
  el.record.onclick = () => handlers.record();

  // Drag & drop a .glb or a camera .json anywhere over the viewport.
  ["dragenter", "dragover"].forEach((type) =>
    el.viewport.addEventListener(type, (e) => {
      e.preventDefault();
      el.viewport.classList.add("dragging");
    }),
  );
  ["dragleave", "drop"].forEach((type) =>
    el.viewport.addEventListener(type, (e) => {
      e.preventDefault();
      el.viewport.classList.remove("dragging");
    }),
  );
  el.viewport.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.json$/i.test(file.name)) handlers.importJson(file);
    else handlers.loadFile(file);
  });

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      handlers.togglePlay();
    } else if (e.key === "k") handlers.addKeyframe();
    else if (e.key === "ArrowLeft") handlers.step(-1);
    else if (e.key === "ArrowRight") handlers.step(1);
  });

  const fmt = (a) => a.map((v) => v.toFixed(2)).join(", ");

  return {
    el,

    get recordSize() {
      return el.recSize.value;
    },
    get bitrate() {
      return Number(el.recBitrate.value) || 16;
    },
    get normalizeOptions() {
      return {
        targetSize: Number(el.normalizeSize.value) || 12,
        enabled: el.normalizeEnabled.checked,
        fit: el.normalizeFit.value,
        upAxis: el.normalizeUp.value,
      };
    },

    setModelInfo(text) {
      el.modelInfo.textContent = text;
    },
    setStatus(text) {
      el.recStatus.textContent = text;
    },
    setDropHintVisible(v) {
      el.dropHint.classList.toggle("hidden", !v);
    },
    setPlaying(v) {
      el.preview.textContent = v ? "Playing…" : "Preview Path";
      el.preview.classList.toggle("active", v);
    },
    setRecording(v) {
      el.record.textContent = v ? "Recording… (click to stop)" : "Record Video";
      el.record.classList.toggle("active", v);
    },
    syncSettings(path) {
      el.duration.value = path.duration;
      el.easing.value = path.easing;
    },

    setPlayhead(t, duration) {
      el.playhead.textContent = `t = ${t.toFixed(2)}s / ${duration.toFixed(2)}s`;
      el.scrub.value = String(duration > 0 ? t / duration : 0);
      const ph = el.timeline.querySelector(".playhead");
      if (ph) ph.style.left = `${duration > 0 ? (t / duration) * 100 : 0}%`;
    },

    renderKeyframes(path, selected) {
      el.kfList.innerHTML = "";
      path.keyframes.forEach((k, i) => {
        const li = document.createElement("li");
        li.className = i === selected ? "selected" : "";
        li.innerHTML =
          `<span class="t">${k.time.toFixed(1)}s</span>` +
          `<span class="v">pos ${fmt(k.position)}<br>tgt ${fmt(k.target)} &middot; ${k.fov.toFixed(0)}&deg;</span>`;
        li.onclick = () => handlers.select(i);
        li.ondblclick = () => handlers.gotoSelected();
        el.kfList.appendChild(li);
      });

      el.timeline.innerHTML = '<div class="track"></div><div class="playhead" style="left:0"></div>';
      path.keyframes.forEach((k, i) => {
        const tick = document.createElement("div");
        tick.className = `tick${i === selected ? " selected" : ""}`;
        tick.style.left = `${path.duration > 0 ? (k.time / path.duration) * 100 : 0}%`;
        tick.title = `Keyframe ${i + 1} @ ${k.time.toFixed(2)}s`;
        tick.innerHTML = `<span class="label">${k.time.toFixed(0)}s</span>`;
        tick.onclick = () => handlers.select(i, true);
        el.timeline.appendChild(tick);
      });

      const has = path.keyframes.length > 0;
      el.deleteKf.disabled = !has;
      el.updateKf.disabled = !has;
      el.gotoKf.disabled = !has;
      el.preview.disabled = !has;
      el.record.disabled = !has;
      el.exportJson.disabled = !has;
    },
  };
}
