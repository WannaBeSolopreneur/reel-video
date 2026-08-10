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
Character lock  (cast bible — faces, bodies, wardrobe)
Location lock   (set / world bible)
  └── Scene (~6s story beat)
        ├── strip         ONE 3-panel still (refs: character + location)
        ├── first/mid/last  CROPS of strip (no model) — left/middle/right
        └── video         reference_to_video([crops])  — action prompt only
```

Optional: multi-panel **storyboard** as a plot map only (not required for scenes).

| Piece | Role |
|---|---|
| Character lock | Who they are. Generate first. |
| Location lock | Where it is. Generate first. |
| Scene strip | One model gen per scene; 3 equal panels L→R. |
| Crops | Auto-sliced thirds of the strip (ffmpeg/sips). |
| Video | Morph first→mid→last; **action/camera** only. |

`reference_to_video` takes **2–7 images only**, not `.mp4`. Across scenes, keep
using the **same locks** as strip refs so cast and set stay stable.

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

### 2. Character + location locks (required before scenes)

```bash
npm run canvas -- add image --provider codex --aspect 16:9 --role character \
  --prompt "ONE image: character bible / cast lineup, consistent design, full body + face clarity, style… NO text"
npm run canvas -- add image --provider codex --aspect 16:9 --role location \
  --prompt "ONE image: location bible, empty or establishing set, lighting and architecture locked… NO text"
# or: canvas lock character img-1 && canvas lock location img-2
```

Generate **both locks to ready** before scaffolding scenes.

### 3. Scenes (strip → crop → video)

```bash
npm run canvas -- scene add --name "Ride and trip" --panels "opening beats" --provider codex --duration 6
```

Requires both locks. Creates:
- one **strip** image (`role: strip`, `refs: [character, location]`)
- three **crops** (`deriveFrom` left/middle/right of the strip — no model)
- one video (`from: first crop`, `refs: [mid, last]`, action-only prompt)

### 4. User generates

Order in UI / run:
1. Character lock + location lock ready  
2. Scene **strip** ready  
3. Crops auto-run (or **Run scene** does strip → crops → video)  

Status: `npm run canvas -- status`.

## Prompt recipes

### Scene strip (one gen — three panels)

```
ONE image: 3-panel strip L→R for scene "<name>", equal panels, clean gutters.
Attached CHARACTER + LOCATION locks only — match exactly every panel.
LEFT: <start action>. MIDDLE: <mid action>. RIGHT: <end action>.
NO text, NO numbers, NO watermark.
```

### Scene video (three crops — action only)

```
Animate continuous N-second shot using three reference stills IN ORDER:
first = start, second = middle, third = end of scene "<name>".
Morph smoothly first→mid→last. Action and camera only.
Match people and place from the stills. No redesign, no on-screen text.
```

## Commands cheat sheet

| Command | Purpose |
|---|---|
| `canvas init [name]` | Create `canvas/project.json` |
| `canvas lock character <id>` | Mark cast bible |
| `canvas lock location <id>` | Mark set bible |
| `canvas storyboard set <img-id>` | Optional plot board |
| `canvas scene add --name … [--panels …]` | Scaffold 3 frames + video (needs both locks) |
| `canvas add image … [--role character\|location] [--refs a,b]` | Free image |
| `canvas add video --from <id> [--refs a,b] [--duration 6\|10]` | Free video |
| `canvas set <id> --prompt …` | Edit prompt (marks pending) |
| `canvas rm <id>` | Remove shot (blocked if scene-wired) |
| `canvas run [--shot id] [--force]` | Generate (only if user asked) |
| `canvas status` | Structure + shot states |
| `canvas serve [--port 4180] [--no-open]` | Review UI |

`--json` on any command for machine-readable output.

## UI rules

- UI groups: **Style locks** (character + location), optional storyboard, then each **Scene**.
- Asset URLs are content-addressed; never cache-bust with `Date.now()`.
- After serve restarts, tell the user to **refresh** the browser.

## Failure playbook

| Symptom | Action |
|---|---|
| Video: `output.upload_url` / ZDR | `grok` → `/privacy` → Opt in; or `docs/zdr.md` R2 config |
| Codex: `No prompt provided via stdin` | Ensure package has stdin-based prompt pass (codex.ts); restart serve; `codex login` |
| Codex wrote no image | Check `codex login`; re-Generate; inspect shot message |
| Style drift on scene frames | Both locks ready; frames must `refs: [character, location]` |
| Scene add fails | Set character + location locks first |
| Want longer than 10s | Add another **scene**, do not fight duration enum |

## Anti-patterns

- Running full `canvas run` unprompted while the user is driving the UI  
- Feeding **video files** into `reference_to_video`  
- Generating scene frames **without** character + location lock refs  
- Scaffolding scenes before both locks exist  
- Standing up tunnels or public upload endpoints for ZDR  
- Committing `.env` or `canvas/assets/` to git  

## When to read more

- `README.md` — install, requirements, commands  
- `docs/zdr.md` — privacy, ZDR, R2  
- `docs/design.md` — why list + SSR UI, not React Flow  
