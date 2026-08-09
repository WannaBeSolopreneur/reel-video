# Reel Video

**Make short AI videos with your coding agent, on the Grok and Codex plans you already pay for.**

No new subscription. No API keys. No second token bill. Just `grok login` (and optional `codex login`).

You talk in plain language. The agent scaffolds the storyboard and scenes. You review in the browser and generate what you want. Files stay on your machine.

Works with **Grok Build**, **Claude Code**, **Codex**, **Cursor**, and any agent that can run a shell.

<p align="center">
  <a href="#get-started"><strong>Get started</strong></a>
  &nbsp;·&nbsp;
  <a href="#talk-to-your-agent">Talk to your agent</a>
  &nbsp;·&nbsp;
  <a href="#agent-skill">Agent skill</a>
  &nbsp;·&nbsp;
  <a href="#if-video-fails">If video fails</a>
  &nbsp;·&nbsp;
  <a href="LICENSE">MIT</a>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-green.svg?style=flat-square" />
  <img alt="agents" src="https://img.shields.io/badge/run%20by-agents-111.svg?style=flat-square" />
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
  <em>Agent scaffolds. You review and generate in the local board.</em>
</p>

---

## How it works

```
You (plain language)
   └── Agent (scaffold + CLI)
         └── Storyboard (one multi-panel image)
               └── Scene (~6s beat)
                     ├── first / middle / last frame
                     └── video  (Grok morphs the three stills)
```

Longer story? Another scene. Clips are only **6s or 10s**.

**Grok Build** = images + video. **Codex** = optional stills. Reel Video is free (MIT) and does not add a meter on top.

---

## Get started

One-time setup on your machine. After that, open the repo in your agent and talk.

### 1. Install

```bash
git clone https://github.com/AsadMoulviDev/reel-video.git
cd reel-video
npm install
```

Needs **Node 20+**, [Grok Build](https://grok.x.ai/) CLI, optional [Codex](https://openai.com/codex) CLI.

### 2. Log in (once)

```bash
grok login          # images + video
codex login         # optional stills
```

### 3. Enable video (once per account)

Video needs coding-data retention opted **in**. Interactive Grok only (not `grok -p`):

```bash
grok
# type: /privacy
# Coding data, retention, and training → Opt in
```

If video fails later with `output.upload_url` / ZDR, redo this or see [docs/zdr.md](docs/zdr.md).

### 4. Install the agent skill

Copy the skill so your agent knows the workflow:

```bash
# Grok Build
mkdir -p ~/.grok/skills/reel-video
cp -R .grok/skills/reel-video/* ~/.grok/skills/reel-video/

# Claude Code
mkdir -p ~/.claude/skills/reel-video
cp -R .grok/skills/reel-video/* ~/.claude/skills/reel-video/

# Codex / other agents (skills under ~/.agents/skills)
mkdir -p ~/.agents/skills/reel-video
cp -R .grok/skills/reel-video/* ~/.agents/skills/reel-video/
```

Skill source: [`.grok/skills/reel-video/SKILL.md`](.grok/skills/reel-video/SKILL.md)

### 5. Open the project in your agent

Point Grok / Claude / Codex / Cursor at this repo. Then go to the next section.

---

## Talk to your agent

This is the product. You do not need to memorize the CLI.

**Say something like:**

> Open the reel-video project, serve the canvas, and make a Pixar short about an owner looking for her cat who was in the fridge the whole time.

Or shorter:

> Scaffold a new short: 8-panel storyboard + two 6s scenes. Leave everything pending so I can generate in the UI.

**What the agent should do:**

1. `canvas init` (if needed) and **`canvas serve`** (open the review board)
2. Scaffold storyboard + scenes (`add image`, `storyboard set`, `scene add`)
3. Leave shots **pending** for you (or generate only if you ask)
4. Tell you to refresh **http://localhost:4180** and click Generate

**You:**

- Fix prompts that missed  
- Click Generate in order: board → scene frames → scene video  
- Ask for the next scene when you like the look  

Example of what we used for the demo above:

```text
I want to make a pixar short for a owner running looking for her cat
and it was in the fridge the whole time
```

---

## Agent skill

Agents should treat this skill as the source of truth: [`.grok/skills/reel-video/SKILL.md`](.grok/skills/reel-video/SKILL.md)

**Rules:**

1. **Serve first.** Prefer the human generating in the UI. Do not unprompted `canvas run`.
2. Scaffold structure; do not invent free-floating keyframes without storyboard refs.
3. Video input is **images only** (2-7 stills). Never feed prior `.mp4` into `reference_to_video`.
4. Duration is only **6 or 10**. Longer story = more scenes.
5. Never invent tunnels or public upload endpoints for ZDR.
6. Every command supports `--json`. Exit `0` ok, `1` fail, `2` usage error.

**What the agent runs (you usually do not type these):**

```bash
npm run canvas -- init "my short"
npm run canvas -- serve

npm run canvas -- add image --provider codex --aspect 16:9 --id img-1 \
  --prompt "ONE single image: 8-panel storyboard … same character … NO text"
npm run canvas -- storyboard set img-1
npm run canvas -- scene add --name "Opening" --panels 1-4 --provider codex --duration 6

npm run canvas -- status
```

| Command | Purpose |
|---|---|
| `canvas init [name]` | New project |
| `canvas serve` | Review UI |
| `canvas storyboard set <id>` | Mark master board |
| `canvas scene add --name …` | 3 frames + video |
| `canvas add image / video …` | Free shots |
| `canvas set / rm / run / status` | Edit, remove, generate, inspect |

---

## If video fails

| Problem | Fix |
|---|---|
| `output.upload_url` / ZDR | `grok` → `/privacy` → Opt in ([docs/zdr.md](docs/zdr.md)) |
| Team ZDR on | Admin R2/S3 in `~/.grok/config.toml` |
| Style drifts | Always ref the storyboard |
| Want longer than 10s | Add another scene |
| Codex wrote no image | `codex login`, re-Generate |

Images often work when video is blocked. This tool never invents public tunnels.

---

## Safety

One media tool per call (`image_gen` or `reference_to_video`). No shell, no web, no free filesystem for the model. [docs/zdr.md](docs/zdr.md) · [docs/design.md](docs/design.md)

---

## Develop

```bash
npm test
npm run typecheck
```

No network in tests. Early project.

## License

[MIT](LICENSE)
