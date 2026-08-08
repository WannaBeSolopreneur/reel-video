# Reel Video

**Ship short AI videos from a storyboard — not a pile of loose prompts.**

An open source, agent-operated canvas for stills and short clips. Your agent scaffolds the board and scenes. You review in the browser, fix the prompts that missed, and generate what is worth generating.

### Runs on the subscriptions you already pay for

Generation goes through **Grok Build** and (optionally) **Codex** via CLI login — not a separate Reel Video meter, not a second API key bill, and not another token top-up for this tool. If you already use those products, media runs on that access. This repo stays free and local (MIT).

**Auth is CLI login** (`grok login`, optional `codex login`) · **no extra token bill from Reel Video** · **media stays on your machine** · **zero runtime dependencies** beyond Node 20+

<p align="center">
  <a href="#quick-start"><strong>Get started</strong></a>
  &nbsp;·&nbsp;
  <a href="#how-it-works">How it works</a>
  &nbsp;·&nbsp;
  <a href="#for-agents">For agents</a>
  &nbsp;·&nbsp;
  <a href="docs/zdr.md">Video &amp; privacy</a>
  &nbsp;·&nbsp;
  <a href="LICENSE">MIT</a>
</p>

---

<!--
  ╔══════════════════════════════════════════════════════════════════╗
  ║  HERO EXAMPLE — drop your demo here                              ║
  ║                                                                  ║
  ║  Put a short clip, GIF, or board screenshot in docs/media/ and   ║
  ║  uncomment one of the blocks below.                              ║
  ║                                                                  ║
  ║  Suggested files:                                                ║
  ║    docs/media/hero.gif      — looping board → video              ║
  ║    docs/media/hero.mp4      — (GitHub won’t autoplay mp4 well)   ║
  ║    docs/media/hero.png      — UI or storyboard still             ║
  ╚══════════════════════════════════════════════════════════════════╝
-->

<!-- Uncomment when ready:

<p align="center">
  <img src="docs/media/hero.gif" alt="Reel Video: storyboard to scene video" width="900" />
</p>

<p align="center">
  <em>Example: multi-panel storyboard → three scene frames → 6s clip</em>
</p>

-->

<p align="center">
  <sub>↑ Hero slot reserved — add <code>docs/media/hero.gif</code> (or <code>.png</code>) and uncomment the block above.</sub>
</p>

---

## Why this exists

Most AI video tools are a chat box and a hope. You get one clip, style drifts on the next, nothing is reviewable in a PR — and you often pay a **new** usage meter on top of tools you already subscribe to.

Reel Video is different on cost and on structure.

### Cost model

| | Reel Video | Typical “AI video SaaS” |
|---|---|---|
| **How you pay** | Your existing **Grok Build** / **Codex** subscription (CLI login) | Separate product bill + its own token or credit meter |
| **This tool** | Free, open source (MIT). No Reel Video API keys, no token top-ups here | Hosted meter, waitlists, per-generation charges |
| **Where media lives** | Local `canvas/assets/` | Their cloud |

Images via **Grok** or **Codex**. Video via Grok **`reference_to_video`**. Plan limits still apply on those providers — Reel Video just does not add a second bill.

### Project model

Reel Video treats a short as a **project file**:

| You get | Instead of |
|---|---|
| One **storyboard** as the visual bible | Random one-off stills |
| **Scenes** (~6s beats) with first / mid / last frames | A single vague “animate this” |
| Video locked to those three stills | Style drift every generation |
| A local review UI + JSON the agent can edit | Opaque cloud projects |

---

## How it works

```
Storyboard          one multi-panel still — characters, style, full plot
   └── Scene        one ~6 second chapter of the story
         ├── first frame
         ├── middle frame     full-frame stills, style-locked to the board
         ├── last frame
         └── video            morphs first → mid → last (6s or 10s only)
```

1. **Board** — one image, multi-panel grid (e.g. 8 panels). That is the look and the plot.
2. **Scene** — three cinematic frames for one beat, always referenced to the board.
3. **Video** — `reference_to_video` on those three stills. Longer stories = more scenes, not longer clips.

No node graph coordinates. A video points at its frames by id. The project file is something you can actually read in a diff.

---

## Quick start

```bash
git clone https://github.com/AsadMoulviDev/reel-video.git
cd reel-video
npm install
grok login                       # required for images + video
# optional: codex login          # alternate stills provider

# once per account — interactive Grok TUI (not grok -p):
grok
# /privacy  →  Coding data, retention, and training  →  Opt in
# (needed for video on most personal accounts — see below)

npm run canvas -- init "my short"
npm run canvas -- serve          # → http://localhost:4180
```

Then either drive the UI, or scaffold from the shell:

```bash
# storyboard (prefer Codex for multi-panel boards if you use it)
npm run canvas -- add image --provider codex --aspect 16:9 --id img-1 \
  --prompt "ONE single image: 8-panel storyboard grid … consistent character … style … NO text"

npm run canvas -- storyboard set img-1
npm run canvas -- scene add --name "Opening beat" --panels 1-4 --provider codex --duration 6

# open the UI and Generate — or, only if you asked the agent to run:
# npm run canvas -- run
```

**Preferred loop:** `serve` first, generate in the browser, restart serve after code changes.

---

## What you can do

- **No extra token bill from this tool** — uses Grok Build and Codex subscriptions you already have; login once, generate without a Reel Video meter  
- **Storyboard → scenes → video** as a first-class workflow, not a prompt recipe you reinvent every time  
- **Style lock** — scene frames and continuations take the board (or prior stills) as refs  
- **Human review** — node-style board in the browser; edit prompts, pick Grok vs Codex per image  
- **Agent friendly** — every command accepts `--json`; exit codes are meaningful  
- **Safe by default** — runner grants the model one media tool only (no shell, no web, no free filesystem)  
- **Local assets** — files land in `canvas/assets/`; project state is `canvas/project.json`

---

## For agents

Every command takes `--json` and prints one machine-readable object.

```bash
canvas add image --prompt "..." --json
# {"ok":true,"shot":{"id":"img-1","status":"pending",...}}

canvas run --json
# {"ok":true,"summary":{"ready":2,"skipped":0,"failed":0,"blocked":0,...},"events":[...]}
```

| Exit | Meaning |
|:---:|---|
| `0` | Success |
| `1` | Failure |
| `2` | Usage error |

Typical contribution: `init` → `add` / `scene add` → leave shots `pending` for the human (or `run` only if they asked) → commit `canvas/project.json`. Media is gitignored; the project file is the reviewable artifact.

**Non-negotiables for agents**

1. Serve the UI first; do not unprompted `canvas run` while the human is generating in the browser.  
2. Never invent tunnels or public upload endpoints for ZDR. See [docs/zdr.md](docs/zdr.md).  
3. Video duration is only **6** or **10** seconds. Longer story = another scene.  
4. `reference_to_video` takes **images only** (2–7 stills), never prior `.mp4` files.

Agent skill (copy into your agent skills dir): [`.grok/skills/reel-video/SKILL.md`](.grok/skills/reel-video/SKILL.md)

---

## For humans

`canvas serve` opens a **node-style review board** — storyboard block, then each scene (first / mid / last + video). No client framework. Prompt edits are form POSTs. Progress refreshes only while a run is in flight. Asset URLs are content-addressed and immutable, so multi-megabyte stills decode once instead of on every re-render.

---

## Requirements for video

Video uses **Grok Build** on your account. Images work without the steps below; **video** usually needs one of them.

### Coding data retention (most personal accounts)

If **Coding data, retention, and training** is opted out, the video API often returns:

```text
Zero Data Retention teams must provide output.upload_url for video generation.
```

Fix it once in the **interactive** Grok TUI:

```bash
grok                 # not grok -p
/privacy             # Settings → Coding data, retention, and training
# choose: Opt in
```

On team accounts only a **team admin** may change it. This lives on your xAI / Grok account, not in this repo.

### Team Zero Data Retention

If the team has real ZDR (`is_zdr: true`), configure S3/R2 upload URLs in `~/.grok/config.toml` — full guide: **[docs/zdr.md](docs/zdr.md)**.

| Situation | What to do |
|---|---|
| Fresh install, personal account | `grok` → `/privacy` → Opt in |
| Video fails with `output.upload_url` / ZDR text | Same, or team R2 config |
| Team ZDR on | `tools.zdr_video_output_s3` in `~/.grok/config.toml` |

Blocked video shots are marked `blocked` with the API error. The tool will **never** invent a public tunnel for you.

---

## Commands

```text
canvas init [name]                              Create canvas/project.json
canvas storyboard set <img-id>                  Mark the master board
canvas scene add --name … [--panels …]          Scaffold 3 frames + video
canvas add image --prompt <text>                [--aspect …] [--provider grok|codex]
                                                [--refs a,b] [--id <id>]
canvas add video --from <id> --prompt <t>       [--refs a,b] [--duration 6|10]
canvas set <id> --prompt <text>                 Rewrite prompt (marks pending)
canvas rm <id>                                  Remove shot
canvas run [--shot <id>] [--force]              Generate pending shots
canvas status                                   Structure + shot states
canvas serve [--port 4180] [--no-open]          Human review UI

--root <dir>   Project root (default: cwd)
--json         Machine-readable output
```

### Shot status

| Status | Meaning |
|---|---|
| `pending` | Needs generating |
| `running` | In flight |
| `ready` | Asset matches current prompt |
| `error` | Failed; retry may work |
| `blocked` | Config forbids it until you change something |

Re-running skips shots whose inputs have not changed. Editing a prompt marks the shot pending; re-rolling an image invalidates videos that depend on it.

---

## Safety

The runner grants the model **exactly one tool per call** — `image_gen` or `reference_to_video` — with no web access, no terminal, and no permission bypass.

Generated media is collected by our code from a session directory we choose. The model is never asked to place a file or open a port.

That constraint is load-bearing: prompts often arrive via PR. A hostile prompt must not become remote code execution. See [docs/zdr.md](docs/zdr.md) for the failure mode this design closed.

---

## Development

```bash
npm test        # node:test, no network
npm run typecheck
```

Tests never call the model. CI needs no credentials.

---

## Status

Early. Images: Grok and Codex. Video: Grok `reference_to_video` once coding-data retention is opted in (or ZDR + R2 is configured).

Deeper design notes: [docs/design.md](docs/design.md)

---

## License

[MIT](LICENSE)
