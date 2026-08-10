/**
 * Review UI: storyboard on top, then each scene (3 frames + video).
 * Server-rendered HTML + form POSTs. A small status poller updates badges,
 * media, and the live bar without full page reloads (and without cache-busting
 * asset URLs — those stay content-addressed).
 */

import { existsSync, statSync } from "node:fs";
import type { Project, Scene, Shot } from "./types.ts";
import { structuralShotIds } from "./project.ts";
import {
  readySceneVideos,
  stitchedAssetPath,
  stitchedPublicUrl,
  STITCHED_FILENAME,
} from "./stitch.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Map project-relative assets/… path to a public /assets/… URL. */
function publicAssetUrl(asset: string, cacheKey = "0"): string {
  const under = asset.replace(/^assets\//, "");
  const encoded = under
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/assets/${encoded}?v=${encodeURIComponent(cacheKey)}`;
}

function assetSrc(shot: Shot): string | null {
  if (!shot.asset) return null;
  return publicAssetUrl(shot.asset, shot.hash ?? "0");
}

function historyStrip(shot: Shot): string {
  const history = shot.history ?? [];
  if (history.length === 0) return "";
  const items = history
    .map((h, i) => {
      const src = publicAssetUrl(h.asset, h.hash ?? h.createdAt);
      const label = h.createdAt.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
      const preview =
        shot.kind === "video"
          ? `<video class="hist-thumb" src="${escapeHtml(src)}" muted playsinline preload="metadata"></video>`
          : `<img class="hist-thumb" src="${escapeHtml(src)}" alt="" loading="lazy">`;
      return `
      <li class="hist-item">
        ${preview}
        <div class="hist-meta">
          <span class="sub">#${i + 1} · ${escapeHtml(label)}</span>
          <form method="post" action="/shot/${encodeURIComponent(shot.id)}/restore">
            <input type="hidden" name="asset" value="${escapeHtml(h.asset)}" />
            <button type="submit" title="Make this the active version">Use</button>
          </form>
        </div>
      </li>`;
    })
    .join("");
  return `
  <details class="history" data-history>
    <summary class="sub">Previous versions (${history.length})</summary>
    <ul class="hist-list">${items}</ul>
  </details>`;
}

const STYLES = `
:root {
  color-scheme: dark;
  --bg: #0b0d11; --panel: #141821; --panel2: #1a2030; --line: #262d3a;
  --text: #eef1f5; --muted: #97a1b2;
  --ready: #46d391; --error: #ff6b7f; --blocked: #f2b544; --running: #6aa8ff; --pending: #7a8499;
  --accent: #7b6cf0; --image: #3d8bfd; --video: #c084fc; --board: #f2b544;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
header {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 14px 20px; border-bottom: 1px solid var(--line);
  background: #0e1219; position: sticky; top: 0; z-index: 5;
}
h1 { margin: 0; font-size: 15px; letter-spacing: -0.01em; }
.sub { color: var(--muted); font-size: 12px; }
.grow { flex: 1; }
button {
  font: inherit; color: inherit; cursor: pointer;
  background: #1c2230; border: 1px solid var(--line); border-radius: 8px;
  padding: 7px 12px;
}
button:hover:not(:disabled) { border-color: #3d4859; }
button.primary { background: var(--accent); border-color: transparent; font-weight: 650; }
button:disabled { opacity: 0.45; cursor: not-allowed; }
main { max-width: 1180px; margin: 0 auto; padding: 20px 20px 64px; }
.hint {
  margin: 0 0 18px; padding: 10px 14px; border: 1px solid var(--line);
  border-radius: 10px; background: #10151f; color: var(--muted); font-size: 12px;
}
.live-bar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: 0 0 18px; padding: 10px 14px; border: 1px solid var(--line);
  border-radius: 10px; background: #10151f; font-size: 12px;
}
.live-bar[data-live="1"] { border-color: #2a4a7a; background: #0f1828; }
.live-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--pending);
  flex-shrink: 0;
}
.live-bar[data-live="1"] .live-dot {
  background: var(--running);
  box-shadow: 0 0 0 0 rgba(106, 168, 255, 0.55);
  animation: pulse 1.4s ease-out infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(106, 168, 255, 0.55); }
  70% { box-shadow: 0 0 0 10px rgba(106, 168, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(106, 168, 255, 0); }
}
.live-label { font-weight: 650; }
.live-bar[data-live="1"] .live-label { color: var(--running); }
.section {
  margin-bottom: 28px; border: 1px solid var(--line); border-radius: 16px;
  background: #0e1219; overflow: hidden;
}
.section-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--panel2);
}
.section-head h2 { margin: 0; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; }
.section-head form { margin: 0; margin-left: auto; }
.section-head button.primary { white-space: nowrap; }
.section-body { padding: 16px; }
.section.storyboard { border-color: #4a3a18; }
.section.storyboard .section-head { border-top: 3px solid var(--board); }
.section.locks { border-color: #1e3a2f; }
.section.locks .section-head { border-top: 3px solid var(--ready); }
.section.scene .section-head { border-top: 3px solid var(--accent); }
.locks-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
}
@media (max-width: 900px) { .locks-grid { grid-template-columns: 1fr; } }
.frames-row {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 16px;
}
@media (max-width: 900px) { .frames-row { grid-template-columns: 1fr; } }
.scene-layout {
  display: grid; grid-template-columns: 1fr minmax(220px, 280px); gap: 18px; align-items: start;
}
@media (max-width: 900px) { .scene-layout { grid-template-columns: 1fr; } }
.node {
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  overflow: hidden; position: relative; transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.node.image { border-top: 3px solid var(--image); }
.node.video { border-top: 3px solid var(--video); }
.node.storyboard-node { border-top: 3px solid var(--board); }
.node.is-running {
  border-color: #3d6aaa;
  box-shadow: 0 0 0 1px rgba(106, 168, 255, 0.25);
}
.node.crop-node { border-top: 3px solid #5a6a7a; }
.node.crop-node .node-header { background: #121820; }
.node-header {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--panel2);
}
.node-body { padding: 12px; display: grid; gap: 10px; }
.kind {
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--muted);
}
.id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); }
.badge {
  font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 2px 7px; border-radius: 999px; border: 1px solid currentColor;
}
.badge.ready { color: var(--ready); } .badge.error { color: var(--error); }
.badge.blocked { color: var(--blocked); } .badge.running { color: var(--running); }
.badge.pending { color: var(--pending); }
.thumb-wrap {
  border-radius: 10px; border: 1px solid var(--line); background: #05070a; overflow: hidden;
}
.thumb { width: 100%; display: block; max-height: 320px; object-fit: contain; background: #05070a; }
.placeholder {
  aspect-ratio: 16 / 9; max-height: 200px; display: grid; place-items: center;
  color: var(--muted); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  border: 1px dashed var(--line); border-radius: 10px;
}
textarea, select {
  width: 100%; font: inherit; color: inherit;
  background: #0e1219; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px;
}
textarea { min-height: 64px; resize: vertical; }
textarea:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.msg {
  padding: 8px 10px; border-radius: 8px; font-size: 12px;
  background: #1a1420; border: 1px solid #3a2a33; color: #ffb3bf; white-space: pre-wrap;
}
.msg.blocked { background: #1e1a12; border-color: #3d3520; color: #ffd48a; }
.msg:empty { display: none; }
.empty { color: var(--muted); text-align: center; padding: 48px 16px; }
code { font-size: 12px; background: #1c2230; padding: 2px 6px; border-radius: 4px; }
label.sub { display: block; margin-bottom: 4px; }
.arrow {
  text-align: center; color: var(--muted); font-size: 11px; letter-spacing: 0.06em;
  text-transform: uppercase; padding: 4px 0 12px;
}
.orphans .section-head { border-top: 3px solid #3d4859; }
.section.export { border-color: #2a4a3a; }
.section.export .section-head { border-top: 3px solid var(--ready); }
.history { margin: 0; border-top: 1px solid var(--line); padding-top: 8px; }
.history summary { cursor: pointer; user-select: none; }
.hist-list {
  list-style: none; margin: 8px 0 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px;
}
.hist-item {
  border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: #0e1219;
}
.hist-thumb { width: 100%; display: block; max-height: 90px; object-fit: cover; background: #05070a; }
.hist-meta { padding: 6px 8px; display: grid; gap: 6px; }
.hist-meta button { width: 100%; }
`;

/**
 * Client status layer: poll /api/project, patch the DOM. No framework, no
 * Date.now() on assets (hash query only). Polls fast while a live run is on.
 */
const CLIENT_SCRIPT = `
(function () {
  var summaryEl = document.getElementById("status-summary");
  var liveBar = document.getElementById("live-bar");
  var liveLabel = document.getElementById("live-label");
  var liveDetail = document.getElementById("live-detail");
  var timer = null;
  var lastJson = "";

  function publicAssetUrl(asset, cacheKey) {
    var under = String(asset || "").replace(/^assets\//, "");
    var encoded = under.split("/").map(encodeURIComponent).join("/");
    return "/assets/" + encoded + "?v=" + encodeURIComponent(cacheKey || "0");
  }
  function assetSrc(shot) {
    if (!shot.asset) return null;
    return publicAssetUrl(shot.asset, shot.hash || "0");
  }

  function summarize(shots) {
    var counts = {};
    for (var i = 0; i < shots.length; i++) {
      var st = shots[i].status;
      counts[st] = (counts[st] || 0) + 1;
    }
    return Object.keys(counts).map(function (k) { return counts[k] + " " + k; }).join(" · ");
  }

  function setBadge(node, status) {
    var badge = node.querySelector("[data-badge]");
    if (!badge) return;
    badge.className = "badge " + status;
    badge.textContent = status;
  }

  function setMedia(node, shot) {
    var wrap = node.querySelector("[data-media]");
    if (!wrap) return;
    // Keep showing the last good asset while status is "running" — do not blank
    // the player when re-animate starts.
    var key = (shot.hash || "") + "|" + (shot.asset || "") + "|" + shot.kind;
    if (wrap.getAttribute("data-key") === key) return;
    wrap.setAttribute("data-key", key);
    var src = assetSrc(shot);
    if (!src) {
      wrap.innerHTML = '<div class="placeholder">' + (shot.kind === "video" ? "VIDEO" : "IMAGE") + "</div>";
      return;
    }
    if (shot.kind === "video") {
      wrap.innerHTML = '<div class="thumb-wrap"><video class="thumb" src="' + src + '" controls playsinline preload="metadata"></video></div>';
    } else {
      wrap.innerHTML = '<div class="thumb-wrap"><img class="thumb" src="' + src + '" alt="" loading="lazy" decoding="async"></div>';
    }
  }

  function setHistory(node, shot) {
    var host = node.querySelector("[data-history-host]");
    if (!host) return;
    var history = shot.history || [];
    var sig = history.map(function (h) { return h.asset; }).join("|");
    if (host.getAttribute("data-hist-sig") === sig) return;
    host.setAttribute("data-hist-sig", sig);
    if (!history.length) {
      host.innerHTML = "";
      return;
    }
    var items = history.map(function (h, i) {
      var src = publicAssetUrl(h.asset, h.hash || h.createdAt || String(i));
      var label = String(h.createdAt || "").replace("T", " ").replace(/\\.\\d{3}Z$/, "Z");
      var preview = shot.kind === "video"
        ? '<video class="hist-thumb" src="' + src + '" muted playsinline preload="metadata"></video>'
        : '<img class="hist-thumb" src="' + src + '" alt="" loading="lazy">';
      return '<li class="hist-item">' + preview +
        '<div class="hist-meta"><span class="sub">#' + (i + 1) + ' · ' + label + '</span>' +
        '<form method="post" action="/shot/' + encodeURIComponent(shot.id) + '/restore">' +
        '<input type="hidden" name="asset" value="' + String(h.asset).replace(/"/g, "&quot;") + '" />' +
        '<button type="submit">Use</button></form></div></li>';
    }).join("");
    host.innerHTML = '<details class="history" open><summary class="sub">Previous versions (' +
      history.length + ')</summary><ul class="hist-list">' + items + '</ul></details>';
  }

  function setMessage(node, shot) {
    var msg = node.querySelector("[data-msg]");
    if (!msg) return;
    if (shot.message) {
      msg.textContent = shot.message;
      msg.className = "msg" + (shot.status === "blocked" ? " blocked" : "");
      msg.hidden = false;
    } else {
      msg.textContent = "";
      msg.hidden = true;
    }
  }

  function setRunButton(node, shot) {
    var btn = node.querySelector("[data-run-btn]");
    if (!btn) return;
    if (shot.kind === "video") {
      btn.textContent = shot.asset ? "Re-animate" : "Animate";
    } else if (shot.deriveFrom || node.getAttribute("data-crop") === "1") {
      btn.textContent = shot.asset ? "Re-crop" : "Crop from strip";
    } else if (shot.role === "strip") {
      btn.textContent = shot.asset ? "Re-generate strip" : "Generate strip";
    } else {
      btn.textContent = shot.asset ? "Regenerate" : "Generate";
    }
  }

  function setSceneButtons(project) {
    var scenes = project.scenes || [];
    for (var i = 0; i < scenes.length; i++) {
      var scene = scenes[i];
      var btn = document.querySelector('[data-scene-run="' + scene.id + '"]');
      if (!btn) continue;
      var ids = [];
      if (scene.stripId) ids.push(scene.stripId);
      ids.push(scene.frames.first, scene.frames.middle, scene.frames.last, scene.videoId);
      var pending = 0;
      for (var j = 0; j < ids.length; j++) {
        var shot = null;
        for (var k = 0; k < project.shots.length; k++) {
          if (project.shots[k].id === ids[j]) { shot = project.shots[k]; break; }
        }
        if (shot && shot.status !== "ready" && shot.status !== "running" && shot.status !== "blocked") pending++;
      }
      btn.textContent = pending > 0 ? "Run scene (" + pending + ")" : "Run scene";
    }
  }

  function setRunControlsDisabled(disabled) {
    var buttons = document.querySelectorAll("[data-run-btn], [data-scene-run], [data-run-all]");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = !!disabled;
  }

  function apply(project) {
    var live = !!project.running;
    var runningShot = null;
    for (var i = 0; i < project.shots.length; i++) {
      if (project.shots[i].status === "running") { runningShot = project.shots[i]; break; }
    }

    if (summaryEl) summaryEl.textContent = summarize(project.shots) || "empty";
    if (liveBar) liveBar.setAttribute("data-live", live ? "1" : "0");
    if (liveLabel) liveLabel.textContent = live ? "Generating" : "Idle";
    if (liveDetail) {
      if (live && runningShot) {
        liveDetail.textContent = "Working on " + runningShot.id + " (" + runningShot.kind + ")…";
      } else if (live) {
        liveDetail.textContent = "Run in progress…";
      } else {
        liveDetail.textContent = "Statuses update live — no full page refresh.";
      }
    }

    for (var s = 0; s < project.shots.length; s++) {
      var shot = project.shots[s];
      var node = document.getElementById("node-" + shot.id);
      if (!node) continue;
      node.setAttribute("data-status", shot.status);
      node.classList.toggle("is-running", shot.status === "running");
      setBadge(node, shot.status);
      setMedia(node, shot);
      setHistory(node, shot);
      setMessage(node, shot);
      setRunButton(node, shot);
    }

    setSceneButtons(project);
    setRunControlsDisabled(live);
  }

  function schedule(live) {
    if (timer) clearTimeout(timer);
    if (document.hidden) {
      timer = setTimeout(tick, 8000);
      return;
    }
    timer = setTimeout(tick, live ? 2000 : 6000);
  }

  function tick() {
    fetch("/api/project", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (project) {
        var raw = JSON.stringify(project);
        if (raw !== lastJson) {
          lastJson = raw;
          apply(project);
        } else if (liveBar) {
          // still refresh live flag path for button disable if only running flipped mid-string-stable edge cases
          setRunControlsDisabled(!!project.running);
        }
        schedule(!!project.running);
      })
      .catch(function () { schedule(false); });
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) tick();
  });

  // Kick once after load, then poll.
  tick();
})();
`;

function badge(shot: Shot): string {
  return `<span class="badge ${shot.status}" data-badge>${shot.status}</span>`;
}

function media(shot: Shot): string {
  const src = assetSrc(shot);
  const key = `${shot.hash ?? ""}|${shot.asset ?? ""}|${shot.kind}|${shot.status}`;
  const inner = !src
    ? `<div class="placeholder">${shot.kind === "video" ? "VIDEO" : "IMAGE"}</div>`
    : shot.kind === "video"
      ? `<div class="thumb-wrap"><video class="thumb" src="${src}" controls playsinline preload="metadata"></video></div>`
      : `<div class="thumb-wrap"><img class="thumb" src="${src}" alt="${escapeHtml(shot.prompt)}" loading="lazy" decoding="async"></div>`;
  return `<div data-media data-key="${escapeHtml(key)}">${inner}</div>`;
}

function messageSlot(shot: Shot): string {
  if (!shot.message) {
    return `<div class="msg" data-msg hidden></div>`;
  }
  return `<div class="msg ${shot.status === "blocked" ? "blocked" : ""}" data-msg>${escapeHtml(shot.message)}</div>`;
}

function imageRoleLabel(shot: Shot & { kind: "image" }): string {
  if (shot.role === "character") return "Character lock";
  if (shot.role === "location") return "Location lock";
  if (shot.role === "storyboard") return "Storyboard";
  if (shot.role === "strip") return "3-panel strip";
  if (shot.deriveFrom) return `${shot.frame ?? "crop"} (crop)`;
  if (shot.frame) return `${shot.frame} frame`;
  return "Image";
}

function imageCard(shot: Shot & { kind: "image" }, title?: string): string {
  // Crops are not model gens — dedicated card (no provider / freeform prompt).
  if (shot.deriveFrom) {
    return cropCard(shot, title);
  }

  const role = imageRoleLabel(shot);
  const refs = shot.refs?.length ? `<span class="sub">refs ${escapeHtml(shot.refs.join(", "))}</span>` : "";
  const boardClass =
    shot.role === "storyboard" ||
    shot.role === "character" ||
    shot.role === "location" ||
    shot.role === "strip"
      ? " storyboard-node"
      : "";
  const runningClass = shot.status === "running" ? " is-running" : "";
  const genLabel =
    shot.role === "strip"
      ? shot.asset
        ? "Re-generate strip"
        : "Generate strip"
      : shot.asset
        ? "Regenerate"
        : "Generate";
  return `
<article class="node image${boardClass}${runningClass}" id="node-${escapeHtml(shot.id)}" data-shot-id="${escapeHtml(shot.id)}" data-status="${escapeHtml(shot.status)}" data-kind="image">
  <div class="node-header">
    <span class="kind">${escapeHtml(title ?? role)} · ${escapeHtml(shot.provider === "codex" ? "Codex" : "Grok")}</span>
    <span class="id">${escapeHtml(shot.id)}</span>
    ${badge(shot)}
    <span class="sub">${escapeHtml(shot.aspect)}</span>
    ${refs}
  </div>
  <div class="node-body">
    ${media(shot)}
    <div data-history-host>${historyStrip(shot)}</div>
    <form method="post" action="/shot/${encodeURIComponent(shot.id)}/prompt">
      <label class="sub" for="p-${escapeHtml(shot.id)}">Prompt</label>
      <textarea id="p-${escapeHtml(shot.id)}" name="prompt">${escapeHtml(shot.prompt)}</textarea>
      <div class="row" style="margin-top:8px">
        <label class="sub" for="prov-${escapeHtml(shot.id)}">Provider</label>
        <select id="prov-${escapeHtml(shot.id)}" name="provider">
          <option value="grok"${shot.provider === "grok" ? " selected" : ""}>Grok</option>
          <option value="codex"${shot.provider === "codex" ? " selected" : ""}>Codex</option>
        </select>
        <button type="submit">Save</button>
        <button type="submit" class="primary" data-run-btn formaction="/shot/${encodeURIComponent(shot.id)}/run">
          ${genLabel}
        </button>
      </div>
    </form>
    ${messageSlot(shot)}
  </div>
</article>`;
}

/** Crop cards: no Codex provider — just slice the strip and show the result. */
function cropCard(shot: Shot & { kind: "image" }, title?: string): string {
  const panel = shot.deriveFrom!.panel;
  const sourceId = shot.deriveFrom!.sourceId;
  const frameLabel =
    shot.frame === "first"
      ? "First"
      : shot.frame === "middle"
        ? "Middle"
        : shot.frame === "last"
          ? "Last"
          : panel;
  const runningClass = shot.status === "running" ? " is-running" : "";
  const cropLabel = shot.asset ? "Re-crop" : "Crop from strip";
  return `
<article class="node image crop-node${runningClass}" id="node-${escapeHtml(shot.id)}" data-shot-id="${escapeHtml(shot.id)}" data-status="${escapeHtml(shot.status)}" data-kind="image" data-crop="1">
  <div class="node-header">
    <span class="kind">${escapeHtml(title ?? `${frameLabel} crop`)}</span>
    <span class="id">${escapeHtml(shot.id)}</span>
    ${badge(shot)}
    <span class="sub">${escapeHtml(panel)} of ${escapeHtml(sourceId)}</span>
  </div>
  <div class="node-body">
    ${media(shot)}
    <p class="sub" style="margin:0">
      Auto-sliced from the scene strip — not a separate image model call.
      Generate the strip first, then crop (or use <strong>Run scene</strong>).
    </p>
    <form method="post" action="/shot/${encodeURIComponent(shot.id)}/run">
      <div class="row">
        <button type="submit" class="primary" data-run-btn data-crop-btn>
          ${cropLabel}
        </button>
      </div>
    </form>
    ${messageSlot(shot)}
  </div>
</article>`;
}

function videoCard(shot: Shot & { kind: "video" }): string {
  const frames = [shot.from, ...(shot.refs ?? [])];
  const framesLabel = frames.length
    ? `frames ${escapeHtml(frames.join(" → "))}`
    : `from ${escapeHtml(shot.from)}`;
  const runningClass = shot.status === "running" ? " is-running" : "";
  return `
<article class="node video${runningClass}" id="node-${escapeHtml(shot.id)}" data-shot-id="${escapeHtml(shot.id)}" data-status="${escapeHtml(shot.status)}" data-kind="video" data-from="${escapeHtml(shot.from)}" data-refs="${escapeHtml(frames.join(","))}">
  <div class="node-header">
    <span class="kind">Video · Grok</span>
    <span class="id">${escapeHtml(shot.id)}</span>
    ${badge(shot)}
    <span class="sub">${shot.duration}s · ${escapeHtml(shot.resolution ?? "720p")} · ${framesLabel}</span>
  </div>
  <div class="node-body">
    ${media(shot)}
    <div data-history-host>${historyStrip(shot)}</div>
    <form method="post" action="/shot/${encodeURIComponent(shot.id)}/prompt">
      <label class="sub" for="p-${escapeHtml(shot.id)}">Motion prompt</label>
      <textarea id="p-${escapeHtml(shot.id)}" name="prompt">${escapeHtml(shot.prompt)}</textarea>
      <div class="row" style="margin-top:8px">
        <button type="submit">Save</button>
        <button
          type="submit"
          formaction="/shot/${encodeURIComponent(shot.id)}/motion-from-strip"
          title="Review strip/crops with vision and rewrite this motion prompt"
        >
          Rewrite from strip
        </button>
        <button type="submit" class="primary" data-run-btn formaction="/shot/${encodeURIComponent(shot.id)}/run">
          ${shot.asset ? "Re-animate" : "Animate"}
        </button>
      </div>
    </form>
    ${messageSlot(shot)}
  </div>
</article>`;
}

function shotById(project: Project, id: string): Shot | undefined {
  return project.shots.find((s) => s.id === id);
}

function sceneSection(project: Project, scene: Scene): string {
  const strip = scene.stripId ? shotById(project, scene.stripId) : undefined;
  const first = shotById(project, scene.frames.first);
  const middle = shotById(project, scene.frames.middle);
  const last = shotById(project, scene.frames.last);
  const video = shotById(project, scene.videoId);
  const panels = scene.panels ? ` · ${escapeHtml(scene.panels)}` : "";
  const sceneIds = [
    ...(scene.stripId ? [scene.stripId] : []),
    scene.frames.first,
    scene.frames.middle,
    scene.frames.last,
    scene.videoId,
  ];
  const pendingInScene = sceneIds.filter((id) => {
    const s = shotById(project, id);
    return s && s.status !== "ready" && s.status !== "running" && s.status !== "blocked";
  }).length;
  const runLabel =
    pendingInScene > 0 ? `Run scene (${pendingInScene})` : "Run scene";

  return `
<section class="section scene" id="${escapeHtml(scene.id)}">
  <div class="section-head">
    <h2>Scene · ${escapeHtml(scene.name)}</h2>
    <span class="sub">${escapeHtml(scene.id)}${panels}</span>
    <span class="sub">strip → crop 3 → video</span>
    <span class="sub">locks: character + location</span>
    <form method="post" action="/scene/${encodeURIComponent(scene.id)}/run">
      <button type="submit" class="primary" data-scene-run="${escapeHtml(scene.id)}" title="Generate strip, crop three panels, then video">${runLabel}</button>
    </form>
  </div>
  <div class="section-body">
    ${
      strip?.kind === "image"
        ? `<div style="margin-bottom:16px">${imageCard(strip, "Scene strip")}</div>
           <div class="arrow">↓ crop left / middle / right (no new model gen)</div>`
        : scene.stripId
          ? `<div class="sub" style="margin-bottom:12px">missing strip ${escapeHtml(scene.stripId)}</div>`
          : ""
    }
    <div class="scene-layout">
      <div>
        <div class="frames-row">
          ${
            first?.kind === "image"
              ? imageCard(first, "First (crop)")
              : `<div class="sub">missing ${escapeHtml(scene.frames.first)}</div>`
          }
          ${
            middle?.kind === "image"
              ? imageCard(middle, "Middle (crop)")
              : `<div class="sub">missing ${escapeHtml(scene.frames.middle)}</div>`
          }
          ${
            last?.kind === "image"
              ? imageCard(last, "Last (crop)")
              : `<div class="sub">missing ${escapeHtml(scene.frames.last)}</div>`
          }
        </div>
        <div class="arrow">↓ reference_to_video [first, mid, last]</div>
      </div>
      <div>
        ${
          video?.kind === "video"
            ? videoCard(video)
            : `<div class="sub">missing ${escapeHtml(scene.videoId)}</div>`
        }
      </div>
    </div>
  </div>
</section>`;
}

/**
 * @param liveRun True when the server currently has a generation job in flight.
 *   Used for initial live-bar state; ongoing updates come from the status poller.
 */
export function renderPage(
  project: Project,
  root: string,
  options: { liveRun?: boolean } = {},
): string {
  const liveRun = options.liveRun ?? false;
  const counts = project.shots.reduce<Record<string, number>>((acc, shot) => {
    acc[shot.status] = (acc[shot.status] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .map(([status, n]) => `${n} ${status}`)
    .join(" · ");
  const runningShot = project.shots.find((s) => s.status === "running");

  if (project.shots.length === 0) {
    return pageShell(
      project,
      root,
      summary,
      liveRun,
      runningShot?.id ?? null,
      `<p class="empty">No shots yet.<br><br>
       <code>canvas add image --role character --prompt "cast bible…" --provider codex</code><br>
       <code>canvas add image --role location --prompt "set bible…" --provider codex</code><br>
       <code>canvas scene add --name "Opening" --provider codex</code></p>`,
    );
  }

  const used = structuralShotIds(project);

  const char = project.characterLockId
    ? shotById(project, project.characterLockId)
    : undefined;
  const loc = project.locationLockId
    ? shotById(project, project.locationLockId)
    : undefined;

  const locksHtml = `
<section class="section locks">
  <div class="section-head">
    <h2>Style locks</h2>
    <span class="sub">Generate these first — every scene frame refs both</span>
  </div>
  <div class="section-body">
    <div class="locks-grid">
      ${
        char?.kind === "image"
          ? imageCard(char, "Character")
          : `<div class="placeholder" style="min-height:120px">Character lock not set<br><span class="sub">canvas lock character &lt;id&gt;</span></div>`
      }
      ${
        loc?.kind === "image"
          ? imageCard(loc, "Location")
          : `<div class="placeholder" style="min-height:120px">Location lock not set<br><span class="sub">canvas lock location &lt;id&gt;</span></div>`
      }
    </div>
  </div>
</section>`;

  const board = project.storyboardId
    ? shotById(project, project.storyboardId)
    : undefined;

  const storyboardHtml = board?.kind === "image"
    ? `<section class="section storyboard">
        <div class="section-head">
          <h2>Storyboard</h2>
          <span class="sub">${escapeHtml(board.id)} · optional plot map (not required for scenes)</span>
        </div>
        <div class="section-body">${imageCard(board, "Storyboard")}</div>
      </section>`
    : "";

  const scenesHtml = project.scenes.map((s) => sceneSection(project, s)).join("\n");

  const orphans = project.shots.filter((s) => !used.has(s.id));
  const orphansHtml =
    orphans.length === 0
      ? ""
      : `<section class="section orphans">
          <div class="section-head"><h2>Other shots</h2>
          <span class="sub">Not in a scene or lock</span></div>
          <div class="section-body" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
            ${orphans
              .map((s) =>
                s.kind === "image" ? imageCard(s) : videoCard(s),
              )
              .join("\n")}
          </div>
        </section>`;

  const locksReady = Boolean(project.characterLockId && project.locationLockId);
  const scenesBlock =
    scenesHtml ||
    (locksReady
      ? `<p class="sub" style="margin:0 0 20px">No scenes yet. <code>canvas scene add --name "Scene 1"</code></p>`
      : `<p class="sub" style="margin:0 0 20px">Set <strong>character</strong> and <strong>location</strong> locks before adding scenes.</p>`);

  const stitchHtml = stitchSection(project, root);

  return pageShell(
    project,
    root,
    summary,
    liveRun,
    runningShot?.id ?? null,
    `${locksHtml}
     ${storyboardHtml}
     ${scenesBlock}
     ${stitchHtml}
     ${orphansHtml}`,
  );
}

function stitchSection(project: Project, root: string): string {
  const ready = readySceneVideos(project, root);
  const totalScenes = project.scenes.length;
  const stitchedPath = stitchedAssetPath(root);
  const hasFile = existsSync(stitchedPath);
  let player = "";
  if (hasFile) {
    const mtime = statSync(stitchedPath).mtimeMs;
    const src = stitchedPublicUrl(mtime);
    player = `
      <div class="thumb-wrap" style="margin-top:12px;max-width:720px">
        <video class="thumb" src="${src}" controls playsinline preload="metadata"></video>
      </div>
      <p class="sub" style="margin:8px 0 0">Saved as <code>canvas/assets/${STITCHED_FILENAME}</code></p>`;
  }

  const canStitch = ready.length >= 2;
  const list =
    ready.length === 0
      ? `<p class="sub" style="margin:0">No ready scene videos yet.</p>`
      : `<ol class="sub" style="margin:0;padding-left:1.2rem">
          ${ready
            .map(
              (c) =>
                `<li><strong>${escapeHtml(c.sceneName)}</strong> · ${escapeHtml(c.videoId)}</li>`,
            )
            .join("")}
        </ol>`;

  return `
<section class="section export" id="export">
  <div class="section-head">
    <h2>Full short</h2>
    <span class="sub">${ready.length}/${totalScenes} scene video(s) ready</span>
    <form method="post" action="/stitch">
      <button type="submit" class="primary" ${canStitch ? "" : "disabled"} title="Concatenate ready scene videos in order (ffmpeg)">
        ${canStitch ? `Stitch ${ready.length} scenes` : "Stitch scenes"}
      </button>
    </form>
  </div>
  <div class="section-body">
    <p class="sub" style="margin:0 0 10px">
      Joins ready scene videos <strong>in scene order</strong> into one MP4 (local ffmpeg — not a model call).
      Needs at least two ready scene videos.
    </p>
    ${list}
    ${player}
  </div>
</section>`;
}

function pageShell(
  project: Project,
  root: string,
  summary: string,
  liveRun: boolean,
  runningShotId: string | null,
  body: string,
): string {
  const liveDetail = liveRun
    ? runningShotId
      ? `Working on ${runningShotId}…`
      : "Run in progress…"
    : "Statuses update live — no full page refresh.";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(project.name)} — agent canvas</title>
<style>${STYLES}</style>
</head><body>
<header>
  <h1>${escapeHtml(project.name)}</h1>
  <span class="sub" id="status-summary">${escapeHtml(summary || "empty")}</span>
  <span class="sub">${project.scenes.length} scene(s)</span>
  <span class="grow"></span>
  <span class="sub">${escapeHtml(root)}</span>
  <form method="post" action="/stitch"><button type="submit">Stitch scenes</button></form>
  <form method="post" action="/run"><button type="submit" class="primary" data-run-all>Run pending</button></form>
</header>
<main>
  <div class="live-bar" id="live-bar" data-live="${liveRun ? "1" : "0"}">
    <span class="live-dot" aria-hidden="true"></span>
    <span class="live-label" id="live-label">${liveRun ? "Generating" : "Idle"}</span>
    <span class="sub" id="live-detail">${escapeHtml(liveDetail)}</span>
  </div>
  <p class="hint">
    <strong>Character + location locks</strong> first.
    <strong>Scene</strong> = one <em>3-panel strip</em> (refs locks) → <em>crop</em> three panels
    → video (<em>action-only</em> prompt). Use <strong>Run scene</strong> for the full chain.
    <strong>Stitch scenes</strong> joins finished scene videos into one short.
  </p>
  ${body}
</main>
<script>${CLIENT_SCRIPT}</script>
</body></html>`;
}
