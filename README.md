# Reel Video

**Make short AI videos on the Grok and Codex plans you already pay for.**

No new subscription. No API keys. No second token bill. Just `grok login` (and optional `codex login`).

Agent scaffolds the storyboard and scenes. You review in the browser and generate what you want. Files stay on your machine.

<p align="center">
  <a href="#get-started"><strong>Get started</strong></a>
  &nbsp;·&nbsp;
  <a href="#make-a-short">Make a short</a>
  &nbsp;·&nbsp;
  <a href="#if-video-fails">If video fails</a>
  &nbsp;·&nbsp;
  <a href="#for-agents">For agents</a>
  &nbsp;·&nbsp;
  <a href="LICENSE">MIT</a>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-green.svg?style=flat-square" />
  <img alt="grok" src="https://img.shields.io/badge/images%20%2B%20video-Grok%20Build-111.svg?style=flat-square" />
  <img alt="codex" src="https://img.shields.io/badge/stills-Codex%20optional-6b6.svg?style=flat-square" />
</p>

---

<p align="center">
  <img src="docs/media/hero.gif" alt="Reel Video: storyboard to scene frames to 6s clip, cat in the fridge short" width="720" />
</p>

<p align="center">
  <em>Prompt: &quot;I want to make a pixar short for a owner running looking for her cat and it was in the fridge the whole time&quot;</em>
</p>

<p align="center">
  <img src="docs/media/ui.gif" alt="Reel Video local review board with multi-panel storyboard node" width="900" />
</p>

<p align="center">
  <em>Local review board. Agent scaffolds; you generate.</em>
</p>

---

## How it works

```
Storyboard (one multi-panel image)
   └── Scene (~6s beat)
         ├── first frame
         ├── middle frame
         ├── last frame
         └── video  (Grok morphs the three stills)
```

Longer story? Add another scene. Clips are only **6s or 10s**.

You already pay for **Grok Build** (images + video) and optionally **Codex** (stills). Reel Video is free (MIT) and does not add a meter on top.

---

## Get started

### 1. Install

```bash
git clone https://github.com/AsadMoulviDev/reel-video.git
cd reel-video
npm install
```

Needs **Node 20+**, [Grok Build](https://grok.x.ai/) CLI, and optional [Codex](https://openai.com/codex) CLI.

### 2. Log in (once)

```bash
grok login          # images + video
codex login         # optional stills
```

### 3. Enable video (once per account)

Video needs coding-data retention opted **in**. Run the interactive Grok app (not `grok -p`):

```bash
grok
# type: /privacy
# Coding data, retention, and training → Opt in
```

If video later fails with `output.upload_url` / ZDR text, do this step again or see [docs/zdr.md](docs/zdr.md).

### 4. Open the board

```bash
npm run canvas -- init "my short"
npm run canvas -- serve
```

Browser opens at **http://localhost:4180**. Leave this running while you work.

---

## Make a short

Do this in order. Prefer generating in the **browser** (Generate buttons). Only run `canvas run` if you ask the agent to.

### Step A: Storyboard

One image. Multi-panel grid. That is style + plot lock.

```bash
npm run canvas -- add image --provider codex --aspect 16:9 --id img-1 \
  --prompt "ONE single image: 8-panel storyboard grid … same character every panel … NO text"

npm run canvas -- storyboard set img-1
```

Refresh the UI → Generate `img-1`.

### Step B: Scene (3 frames + video)

```bash
npm run canvas -- scene add --name "Opening" --panels 1-4 --provider codex --duration 6
```

That creates first / mid / last frames (refs the board) and one video.

In the UI:

1. Generate the three frames  
2. Generate the video  

### Step C: Next scene (optional)

```bash
npm run canvas -- scene add --name "Reveal" --panels 5-8 --provider codex --duration 6
```

Same board, same look. Repeat until the story is done.

### Check status

```bash
npm run canvas -- status
```

---

## Common commands

| Command | What it does |
|---|---|
| `canvas init [name]` | New project |
| `canvas serve` | Review UI |
| `canvas storyboard set <img-id>` | Mark master board |
| `canvas scene add --name …` | Scaffold 3 frames + video |
| `canvas add image --prompt …` | Free image shot |
| `canvas add video --from <id> …` | Free video shot |
| `canvas set <id> --prompt …` | Edit prompt (marks pending) |
| `canvas run [--shot id]` | Generate pending shots |
| `canvas status` | Show structure + states |

Add `--json` for machine-readable output. Full flags: `npm run canvas -- --help`.

---

## If video fails

| Problem | Fix |
|---|---|
| `output.upload_url` / ZDR error | `grok` → `/privacy` → Opt in ([docs/zdr.md](docs/zdr.md)) |
| Team ZDR locked on | Admin sets R2/S3 in `~/.grok/config.toml` ([docs/zdr.md](docs/zdr.md)) |
| Style drifts | Always ref the storyboard (`scene add` does this) |
| Want longer than 10s | Add another **scene**, do not force a longer clip |
| Codex wrote no image | `codex login`, re-Generate |

Images usually work even when video is blocked. Blocked shots show as `blocked` with the API message. This tool never invents public tunnels for you.

---

## For agents

Skill: [`.grok/skills/reel-video/SKILL.md`](.grok/skills/reel-video/SKILL.md) (copy into your agent skills dir).

1. **Serve first.** Prefer `canvas serve` and let the human click Generate. Do not unprompted `canvas run`.
2. Scaffold with `init` → `add` / `scene add` → leave shots `pending`.
3. Commit `canvas/project.json` (media is gitignored).
4. Video is images only into `reference_to_video` (no prior `.mp4` as input). Duration is only 6 or 10.
5. Never invent ZDR upload endpoints. See [docs/zdr.md](docs/zdr.md).

Every command supports `--json`. Exit `0` ok, `1` fail, `2` usage error.

---

## Safety

One media tool per call (`image_gen` or `reference_to_video`). No shell, no web, no free filesystem for the model. Details: [docs/zdr.md](docs/zdr.md), [docs/design.md](docs/design.md).

---

## Develop

```bash
npm test
npm run typecheck
```

No network in tests. Early project: Grok + Codex stills, Grok video after privacy opt-in.

## License

[MIT](LICENSE)
