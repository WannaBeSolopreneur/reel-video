/**
 * Review UI: storyboard on top, then each scene (3 frames + video).
 * Server-rendered HTML + form POSTs. Tiny script only draws SVG edges.
 */

import type { Project, Scene, Shot } from "./types.ts";
import { sceneShotIds } from "./project.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function assetSrc(shot: Shot): string | null {
  if (!shot.asset) return null;
  const file = shot.asset.split("/").pop()!;
  return `/assets/${encodeURIComponent(file)}?v=${encodeURIComponent(shot.hash ?? "0")}`;
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
button:hover { border-color: #3d4859; }
button.primary { background: var(--accent); border-color: transparent; font-weight: 650; }
main { max-width: 1180px; margin: 0 auto; padding: 20px 20px 64px; }
.hint {
  margin: 0 0 18px; padding: 10px 14px; border: 1px solid var(--line);
  border-radius: 10px; background: #10151f; color: var(--muted); font-size: 12px;
}
.section {
  margin-bottom: 28px; border: 1px solid var(--line); border-radius: 16px;
  background: #0e1219; overflow: hidden;
}
.section-head {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--panel2);
}
.section-head h2 { margin: 0; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase; }
.section-body { padding: 16px; }
.section.storyboard { border-color: #4a3a18; }
.section.storyboard .section-head { border-top: 3px solid var(--board); }
.section.scene .section-head { border-top: 3px solid var(--accent); }
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
  overflow: hidden; position: relative;
}
.node.image { border-top: 3px solid var(--image); }
.node.video { border-top: 3px solid var(--video); }
.node.storyboard-node { border-top: 3px solid var(--board); }
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
.empty { color: var(--muted); text-align: center; padding: 48px 16px; }
code { font-size: 12px; background: #1c2230; padding: 2px 6px; border-radius: 4px; }
label.sub { display: block; margin-bottom: 4px; }
.arrow {
  text-align: center; color: var(--muted); font-size: 11px; letter-spacing: 0.06em;
  text-transform: uppercase; padding: 4px 0 12px;
}
.orphans .section-head { border-top: 3px solid #3d4859; }
`;

function badge(shot: Shot): string {
  return `<span class="badge ${shot.status}">${shot.status}</span>`;
}

function media(shot: Shot): string {
  const src = assetSrc(shot);
  if (!src) {
    return `<div class="placeholder">${shot.kind === "video" ? "VIDEO" : "IMAGE"}</div>`;
  }
  if (shot.kind === "video") {
    return `<div class="thumb-wrap"><video class="thumb" src="${src}" controls muted playsinline preload="metadata"></video></div>`;
  }
  return `<div class="thumb-wrap"><img class="thumb" src="${src}" alt="${escapeHtml(shot.prompt)}" loading="lazy" decoding="async"></div>`;
}

function imageCard(shot: Shot & { kind: "image" }, title?: string): string {
  const role =
    shot.role === "storyboard"
      ? "Storyboard"
      : shot.frame
        ? `${shot.frame} frame`
        : "Image";
  const refs = shot.refs?.length ? `<span class="sub">refs ${escapeHtml(shot.refs.join(", "))}</span>` : "";
  const boardClass = shot.role === "storyboard" ? " storyboard-node" : "";
  return `
<article class="node image${boardClass}" id="node-${escapeHtml(shot.id)}">
  <div class="node-header">
    <span class="kind">${escapeHtml(title ?? role)} · ${escapeHtml(shot.provider === "codex" ? "Codex" : "Grok")}</span>
    <span class="id">${escapeHtml(shot.id)}</span>
    ${badge(shot)}
    <span class="sub">${escapeHtml(shot.aspect)}</span>
    ${refs}
  </div>
  <div class="node-body">
    ${media(shot)}
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
        <button type="submit" class="primary" formaction="/shot/${encodeURIComponent(shot.id)}/run">
          ${shot.asset ? "Regenerate" : "Generate"}
        </button>
      </div>
    </form>
    ${
      shot.message
        ? `<div class="msg ${shot.status === "blocked" ? "blocked" : ""}">${escapeHtml(shot.message)}</div>`
        : ""
    }
  </div>
</article>`;
}

function videoCard(shot: Shot & { kind: "video" }): string {
  const frames = [shot.from, ...(shot.refs ?? [])];
  const framesLabel = frames.length
    ? `frames ${escapeHtml(frames.join(" → "))}`
    : `from ${escapeHtml(shot.from)}`;
  return `
<article class="node video" id="node-${escapeHtml(shot.id)}" data-from="${escapeHtml(shot.from)}" data-refs="${escapeHtml(frames.join(","))}">
  <div class="node-header">
    <span class="kind">Video · Grok</span>
    <span class="id">${escapeHtml(shot.id)}</span>
    ${badge(shot)}
    <span class="sub">${shot.duration}s · ${framesLabel}</span>
  </div>
  <div class="node-body">
    ${media(shot)}
    <form method="post" action="/shot/${encodeURIComponent(shot.id)}/prompt">
      <label class="sub" for="p-${escapeHtml(shot.id)}">Motion prompt</label>
      <textarea id="p-${escapeHtml(shot.id)}" name="prompt">${escapeHtml(shot.prompt)}</textarea>
      <div class="row" style="margin-top:8px">
        <button type="submit">Save</button>
        <button type="submit" class="primary" formaction="/shot/${encodeURIComponent(shot.id)}/run">
          ${shot.asset ? "Re-animate" : "Animate"}
        </button>
      </div>
    </form>
    ${
      shot.message
        ? `<div class="msg ${shot.status === "blocked" ? "blocked" : ""}">${escapeHtml(shot.message)}</div>`
        : ""
    }
  </div>
</article>`;
}

function shotById(project: Project, id: string): Shot | undefined {
  return project.shots.find((s) => s.id === id);
}

function sceneSection(project: Project, scene: Scene): string {
  const first = shotById(project, scene.frames.first);
  const middle = shotById(project, scene.frames.middle);
  const last = shotById(project, scene.frames.last);
  const video = shotById(project, scene.videoId);
  const panels = scene.panels ? ` · panels ${escapeHtml(scene.panels)}` : "";

  return `
<section class="section scene" id="${escapeHtml(scene.id)}">
  <div class="section-head">
    <h2>Scene · ${escapeHtml(scene.name)}</h2>
    <span class="sub">${escapeHtml(scene.id)}${panels}</span>
    <span class="sub">first → mid → last → video</span>
  </div>
  <div class="section-body">
    <div class="scene-layout">
      <div>
        <div class="frames-row">
          ${
            first?.kind === "image"
              ? imageCard(first, "First")
              : `<div class="sub">missing ${escapeHtml(scene.frames.first)}</div>`
          }
          ${
            middle?.kind === "image"
              ? imageCard(middle, "Middle")
              : `<div class="sub">missing ${escapeHtml(scene.frames.middle)}</div>`
          }
          ${
            last?.kind === "image"
              ? imageCard(last, "Last")
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

export function renderPage(project: Project, root: string): string {
  const running = project.shots.some((shot) => shot.status === "running");
  const refresh = running ? `<meta http-equiv="refresh" content="3">` : "";
  const counts = project.shots.reduce<Record<string, number>>((acc, shot) => {
    acc[shot.status] = (acc[shot.status] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .map(([status, n]) => `${n} ${status}`)
    .join(" · ");

  if (project.shots.length === 0) {
    return pageShell(
      project,
      root,
      summary,
      refresh,
      `<p class="empty">No shots yet.<br><br>
       <code>canvas add image --prompt "8-panel storyboard…" --provider codex</code><br>
       <code>canvas storyboard set img-1</code><br>
       <code>canvas scene add --name "Ride" --panels 1-4</code></p>`,
    );
  }

  const used = sceneShotIds(project);
  if (project.storyboardId) used.add(project.storyboardId);

  const board = project.storyboardId
    ? shotById(project, project.storyboardId)
    : undefined;

  const storyboardHtml = board?.kind === "image"
    ? `<section class="section storyboard">
        <div class="section-head">
          <h2>Storyboard</h2>
          <span class="sub">${escapeHtml(board.id)} · master multi-panel board</span>
        </div>
        <div class="section-body">${imageCard(board, "Storyboard")}</div>
      </section>`
    : `<section class="section storyboard">
        <div class="section-head"><h2>Storyboard</h2>
        <span class="sub">Not set — generate a multi-panel image, then <code>canvas storyboard set &lt;id&gt;</code></span></div>
      </section>`;

  const scenesHtml = project.scenes.map((s) => sceneSection(project, s)).join("\n");

  const orphans = project.shots.filter((s) => !used.has(s.id));
  const orphansHtml =
    orphans.length === 0
      ? ""
      : `<section class="section orphans">
          <div class="section-head"><h2>Other shots</h2>
          <span class="sub">Not in a scene</span></div>
          <div class="section-body" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
            ${orphans
              .map((s) =>
                s.kind === "image" ? imageCard(s) : videoCard(s),
              )
              .join("\n")}
          </div>
        </section>`;

  return pageShell(
    project,
    root,
    summary,
    refresh,
    `${storyboardHtml}
     ${scenesHtml || `<p class="sub" style="margin:0 0 20px">No scenes yet. <code>canvas scene add --name "Scene 1" --panels 1-4</code></p>`}
     ${orphansHtml}`,
  );
}

function pageShell(
  project: Project,
  root: string,
  summary: string,
  refresh: string,
  body: string,
): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(project.name)} — agent canvas</title>
${refresh}
<style>${STYLES}</style>
</head><body>
<header>
  <h1>${escapeHtml(project.name)}</h1>
  <span class="sub">${escapeHtml(summary || "empty")}</span>
  <span class="sub">${project.scenes.length} scene(s)</span>
  <span class="grow"></span>
  <span class="sub">${escapeHtml(root)}</span>
  <form method="post" action="/run"><button type="submit" class="primary">Run pending</button></form>
</header>
<main>
  <p class="hint">
    <strong>Storyboard</strong> = full multi-panel bible.
    <strong>Scene</strong> = one ~6s beat with <em>first / middle / last</em> frames
    (style-locked to the storyboard) → one <code>reference_to_video</code>.
  </p>
  ${body}
</main>
</body></html>`;
}
