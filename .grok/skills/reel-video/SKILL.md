---
name: reel-video
description: >
  Operate Reel Video (agent-canvas): storyboard → scenes → first/mid/last frames →
  Grok reference_to_video, with Codex or Grok stills. Use when the user mentions
  reel video, agent-canvas, canvas storyboard, short video canvas, scene frames,
  reference_to_video, codex storyboard, or runs /reel-video. Also when scaffolding
  multi-panel boards, 6s scene videos, or continuing a visual story with style refs.
---

# Reel Video

Agent-operated short-video canvas. CLI + local review UI. Auth is **CLI login**
(`grok login`, optional `codex login`) — no API keys in the project.

Repo: https://github.com/AsadMoulviDev/reel-video  
Work from the package root (e.g. `agent-canvas/` or a clone of `reel-video`).

## Non-negotiables

1. **Serve the UI first; humans generate.** Prefer `canvas serve` and let the
   user click Generate / Animate. Only run `canvas run` when they explicitly ask
   you to generate, or when scaffolding empty pending shots they will run later.
2. **Never invent infra.** No tunnels, no public PUT servers, no `--yolo` with a
   shell to “just make the video appear.” See `docs/zdr.md`.
3. **Narrow tools only.** Generation goes through the canvas runner (Grok:
   `image_gen` / `reference_to_video`; Codex: constrained `codex exec`). Do not
   hand the model a free terminal for media jobs.
4. **Video duration is only 6 or 10 seconds.** Long stories = multiple scenes.

## Mental model

```
Storyboard (1 multi-panel still — the visual bible)
  └── Scene (~6s story beat)
        ├── first frame   (full frame still, refs storyboard)
        ├── middle frame  (full frame still, refs storyboard)
        ├── last frame    (full frame still, refs storyboard)
        └── video         reference_to_video([first, mid, last])
```

| Piece | File type | Role |
|---|---|---|
| Storyboard | One image | Full plot, multi-panel (e.g. 8 panels). Style + character lock. |
| Scene | Grouping | One ~6s chapter of the story (e.g. panels 1–4). |
| 3 frames | Three images | First / mid / last of that scene — what the video model can use. |
| Video | One mp4 | Morphs the three stills in order. **Does not accept video as input.** |

`reference_to_video` takes **2–7 images only**, not `.mp4`. Continuity for later
boards uses **prior stills** via `--refs`, never prior videos.

## Setup (once per machine / account)

```bash
npm install
grok login          # images + video
codex login         # optional stills provider

# Video often requires coding-data retention Opt in (account setting):
# Interactive only — not grok -p:
grok
# then: /privacy  →  Coding data, retention, and training → Opt in
```

If video fails with `output.upload_url` / ZDR text, re-check `/privacy` or
configure `tools.zdr_video_output_s3` in `~/.grok/config.toml` (see `docs/zdr.md`).

## Standard workflow

### 1. Init + UI

```bash
npm run canvas -- init "my short"
npm run canvas -- serve --port 4180   # open browser; restart after code changes
```

After any code change that affects serve/UI, **restart serve** and tell the user
to refresh.

### 2. Storyboard (master board)

Prefer **Codex** for multi-panel boards when the user wants that; otherwise Grok.

```bash
npm run canvas -- add image --provider codex --aspect 16:9 --id img-1 \
  --prompt "ONE single image: N-panel storyboard grid … consistent character … style … NO text, NO watermark"
npm run canvas -- storyboard set img-1
```

Prompt rules for boards:
- Explicitly **one image**, multi-panel layout (e.g. 2×4 for 8 panels).
- Number panels and describe each beat left-to-right, top-to-bottom.
- Style lock phrase (Pixar, live action, etc.) and “same character in every panel”.
- Forbid text, captions, speech bubbles, watermarks.

User generates the board in the UI (or `canvas run --shot img-1` if asked).

### 3. Scenes (3 frames + video)

```bash
npm run canvas -- scene add --name "Ride and trip" --panels 1-4 --provider codex --duration 6
```

Optional overrides: `--first-prompt`, `--middle-prompt`, `--last-prompt`,
`--video-prompt`, `--storyboard img-1`.

This creates:
- three image shots with `refs: [storyboard]`, `frame: first|middle|last`
- one video with `from: first`, `refs: [middle, last]`

**Do not invent free-floating keyframes** without the storyboard as ref when
continuing a story — style will drift.

### 4. User generates

Order in UI / run:
1. Storyboard ready  
2. Scene frames (first, mid, last)  
3. Scene video  

Status: `npm run canvas -- status`.

## Prompt recipes

### Scene frame (always ref storyboard)

```
SINGLE cinematic frame (NOT multi-panel). FIRST|MIDDLE|LAST FRAME of scene "<name>".
Use attached storyboard as ONLY style/character reference — match exact design.
This frame = <beat>. Full shot. NO panels, NO text, NO watermark.
```

### Scene video (three stills in order)

```
Animate continuous N-second shot using three reference stills IN ORDER:
first = start, second = middle, third = end of scene "<name>".
Morph smoothly first→mid→last. Match characters/world from the stills.
Clear beats, no on-screen text.
```

### Continuity / next board

```bash
npm run canvas -- add image --provider codex --refs img-1 --prompt "ONE image, 4-panel grid, CONTINUATION of attached board…"
```

## Commands cheat sheet

| Command | Purpose |
|---|---|
| `canvas init [name]` | Create `canvas/project.json` |
| `canvas storyboard set <img-id>` | Mark master board |
| `canvas scene add --name … [--panels …]` | Scaffold 3 frames + video |
| `canvas add image … [--provider codex\|grok] [--refs a,b]` | Free image |
| `canvas add video --from <id> [--refs a,b] [--duration 6\|10]` | Free video |
| `canvas set <id> --prompt …` | Edit prompt (marks pending) |
| `canvas rm <id>` | Remove shot (blocked if scene-wired) |
| `canvas run [--shot id] [--force]` | Generate (only if user asked) |
| `canvas status` | Structure + shot states |
| `canvas serve [--port 4180] [--no-open]` | Review UI |

`--json` on any command for machine-readable output.

## UI rules

- UI groups: **Storyboard** block, then each **Scene** (first/mid/last + video).
- Asset URLs are content-addressed; never cache-bust with `Date.now()`.
- After serve restarts, tell the user to **refresh** the browser.

## Failure playbook

| Symptom | Action |
|---|---|
| Video: `output.upload_url` / ZDR | `grok` → `/privacy` → Opt in; or `docs/zdr.md` R2 config |
| Codex: `No prompt provided via stdin` | Ensure package has stdin-based prompt pass (codex.ts); restart serve; `codex login` |
| Codex wrote no image | Check `codex login`; re-Generate; inspect shot message |
| Style drift on new board/frames | Must use `--refs <storyboard>` / scene scaffolding |
| Video ignores board | Use three **scene frames** as refs, not only the multi-panel grid |
| Want longer than 10s | Add another **scene**, do not fight duration enum |

## Anti-patterns

- Running full `canvas run` unprompted while the user is driving the UI  
- Feeding **video files** into `reference_to_video`  
- Generating scene frames **without** storyboard refs  
- One video for an 8-panel arc without splitting into scenes  
- Standing up tunnels or public upload endpoints for ZDR  
- Committing `.env` or `canvas/assets/` to git  

## When to read more

- `README.md` — install, requirements, commands  
- `docs/zdr.md` — privacy, ZDR, R2  
- `docs/design.md` — why list + SSR UI, not React Flow  
