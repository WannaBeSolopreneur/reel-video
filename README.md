# Reel Video

**Reel Video is an open-source AI video canvas for coding agents.**

It lets Claude Code, Codex, Cursor, Grok Build, and other coding agents turn a plain-language idea into a storyboard, scene keyframes, and short AI-generated videos.

Reel Video runs locally, uses your existing Grok Build and optional Codex login, and does not require separate API keys or another AI subscription.

No new subscription. No second token bill. Files stay on your machine.

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a>
  &nbsp;·&nbsp;
  <a href="#how-does-reel-video-work">How it works</a>
  &nbsp;·&nbsp;
  <a href="#how-to-use-reel-video-with-an-agent">Use with an agent</a>
  &nbsp;·&nbsp;
  <a href="#faq">FAQ</a>
  &nbsp;·&nbsp;
  <a href="LICENSE">MIT</a>
</p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-green.svg?style=flat-square" />
  <img alt="agents" src="https://img.shields.io/badge/for-coding%20agents-111.svg?style=flat-square" />
  <img alt="grok" src="https://img.shields.io/badge/Grok%20Build-images%20%2B%20video-111.svg?style=flat-square" />
  <img alt="codex" src="https://img.shields.io/badge/Codex-optional%20stills-6b6.svg?style=flat-square" />
</p>

---

<p align="center">
  <img src="docs/media/hero.gif" alt="Reel Video example: storyboard to keyframes to short AI video of a cat in the fridge" width="720" />
</p>

<p align="center">
  <em>Prompt: &quot;I want to make a pixar short for a owner running looking for her cat and it was in the fridge the whole time&quot;</em>
</p>

<p align="center">
  <img src="docs/media/ui.gif" alt="Reel Video local browser review board with storyboard and scene nodes" width="900" />
</p>

<p align="center">
  <em>Local review board. The agent scaffolds. You review and generate.</em>
</p>

---

## What is Reel Video?

Reel Video is a local-first TypeScript CLI and browser review interface for agent-driven AI video creation.

The workflow is:

```text
Idea → Storyboard → Scenes → First / Middle / Last Frames → AI Video
```

- **Grok Build** generates images and 6- or 10-second videos.
- **Codex** can optionally generate storyboard and scene stills.
- **Your coding agent** runs the CLI, scaffolds the project, and keeps prompts editable.
- **You** review in the browser and decide what to generate.

Reel Video is not a hosted AI video SaaS. It is an open-source canvas that sits on tools you already use.

---

## Who is Reel Video for?

Reel Video is for people who:

- Already use a coding agent (Claude Code, Codex, Cursor, Grok Build, and similar)
- Already pay for Grok Build and/or Codex
- Want short, style-locked clips from a storyboard instead of one-off chat generations
- Want project files on disk (`canvas/project.json`) that an agent can edit and a human can review

If you want a chat box that returns one mystery clip, this is not that product. If you want an agent to structure a short and leave you a review board, this is.

---

## How does Reel Video work?

```text
Storyboard (one multi-panel still)
   └── Scene (~6 second beat)
         ├── first frame
         ├── middle frame
         ├── last frame
         └── video   (Grok reference_to_video on those three stills)
```

1. The agent creates a **storyboard** image (full plot, style, characters).
2. The agent adds **scenes**. Each scene is one short chapter of the story.
3. Each scene gets **three full-frame stills** locked to the board.
4. Grok turns those stills into a **6s or 10s** video.
5. Longer stories use more scenes, not longer single clips.

Media lands in `canvas/assets/`. State lives in `canvas/project.json`. Both stay local.

---

## Does Reel Video cost extra?

**No separate Reel Video subscription and no Reel Video API keys.**

You pay for the providers you already use:

| What | Provider | How you auth |
|---|---|---|
| Images + video | Grok Build | `grok login` |
| Optional stills | Codex | `codex login` |
| This repo | Open source (MIT) | Free |

Provider plan limits still apply. Reel Video does not add a second token meter on top.

---

## Quick start

One-time setup on your machine. After that, open the repo in your agent and talk in plain language.

### 1. Install Reel Video

```bash
git clone https://github.com/AsadMoulviDev/reel-video.git
cd reel-video
npm install
```

Requirements: **Node 20+**, [Grok Build](https://grok.x.ai/) CLI, optional [Codex](https://openai.com/codex) CLI.

### 2. Log in once

```bash
grok login          # required for images + video
codex login         # optional stills
```

### 3. Enable Grok video once

Video generation needs coding-data retention opted **in**. Use the interactive Grok app (not `grok -p`):

```bash
grok
# type: /privacy
# Coding data, retention, and training → Opt in
```

Details: [docs/zdr.md](docs/zdr.md)

### 4. Install the agent skill

So Claude Code, Grok, Codex, Cursor, and similar tools load the workflow:

```bash
# Grok Build
mkdir -p ~/.grok/skills/reel-video
cp -R .grok/skills/reel-video/* ~/.grok/skills/reel-video/

# Claude Code
mkdir -p ~/.claude/skills/reel-video
cp -R .grok/skills/reel-video/* ~/.claude/skills/reel-video/

# Codex / agent skills home
mkdir -p ~/.agents/skills/reel-video
cp -R .grok/skills/reel-video/* ~/.agents/skills/reel-video/
```

Skill file: [`.grok/skills/reel-video/SKILL.md`](.grok/skills/reel-video/SKILL.md)

### 5. Open the repo in your coding agent

Point your agent at this project. You are ready to make a short.

---

## How to use Reel Video with an agent

### What you say

```text
Open this reel-video project, serve the canvas, and make a Pixar short
about an owner looking for her cat who was in the fridge the whole time.
```

Or:

```text
Scaffold a new short: 8-panel storyboard and two 6-second scenes.
Leave shots pending so I can generate in the UI.
```

Demo prompt from the GIF above:

```text
I want to make a pixar short for a owner running looking for her cat
and it was in the fridge the whole time
```

### What the agent does

1. Runs `canvas init` if needed  
2. Starts **`canvas serve`** (review UI at http://localhost:4180)  
3. Scaffolds storyboard + scenes with the CLI  
4. Leaves shots **pending** unless you ask it to generate  
5. Tells you to refresh the board and click Generate  

### What you do

1. Review prompts in the browser  
2. Generate in order: storyboard → scene frames → scene video  
3. Ask the agent for the next scene when the look is right  

Preferred loop: **agent scaffolds, human generates in the UI.** Only run full `canvas run` when you ask the agent to.

---

## What commands does the agent run?

You usually do not type these. Your agent does.

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
| `canvas init [name]` | Create `canvas/project.json` |
| `canvas serve` | Open the local review UI |
| `canvas storyboard set <id>` | Mark the master board |
| `canvas scene add --name …` | Scaffold first / mid / last + video |
| `canvas add image` / `add video` | Free shots |
| `canvas set` / `rm` / `run` / `status` | Edit, remove, generate, inspect |

Add `--json` for machine-readable output. Exit codes: `0` success, `1` failure, `2` usage error.

---

## Rules for agents

Source of truth: [`.grok/skills/reel-video/SKILL.md`](.grok/skills/reel-video/SKILL.md)

1. Serve the UI first. Do not unprompted `canvas run` while the human is generating in the browser.  
2. Keep scene frames referenced to the storyboard so style does not drift.  
3. `reference_to_video` takes **images only** (2-7 stills), never prior `.mp4` files.  
4. Video duration is only **6 or 10** seconds. Longer story means more scenes.  
5. Never invent tunnels or public upload endpoints for ZDR. See [docs/zdr.md](docs/zdr.md).  
6. Commit `canvas/project.json`. Media under `canvas/assets/` is gitignored.  

---

## FAQ

### Is Reel Video free?

The software is free and open source under the [MIT license](LICENSE). Image and video generation use your Grok Build and optional Codex accounts. There is no Reel Video usage meter.

### Do I need API keys?

No. Auth is CLI login: `grok login` and optional `codex login`.

### Where do videos and images go?

On your machine under `canvas/assets/`. Project structure is `canvas/project.json`.

### Can I make videos longer than 10 seconds?

Not as one clip. Add another scene. Each video shot is 6 or 10 seconds only.

### Why did video fail with output.upload_url or ZDR?

Most personal accounts need coding-data retention opted in via `grok` → `/privacy`. Team Zero Data Retention may need S3/R2 config. See [docs/zdr.md](docs/zdr.md).

### Which coding agents work with Reel Video?

Any agent that can run shell commands and read the skill: Claude Code, Codex, Cursor, Grok Build, and similar tools.

### Is this a replacement for Remotion or CapCut?

No. Reel Video is an agent-operated canvas for AI stills and short generative clips with a storyboard lock. It is not a full NLE or motion-graphics framework.

---

## If video fails

| Problem | Fix |
|---|---|
| `output.upload_url` / ZDR | `grok` → `/privacy` → Opt in ([docs/zdr.md](docs/zdr.md)) |
| Team ZDR on | Admin configures R2/S3 in `~/.grok/config.toml` |
| Style drifts across shots | Always ref the storyboard (`scene add` does this) |
| Need a longer story | Add another scene |
| Codex wrote no image | `codex login`, re-Generate in the UI |

Images often still work when video is blocked. Reel Video never invents a public tunnel for you.

---

## Safety

The runner grants the model **one media tool per call** (`image_gen` or `reference_to_video`). No shell, no web, no free filesystem for the model.

More: [docs/zdr.md](docs/zdr.md) · [docs/design.md](docs/design.md)

---

## Develop

```bash
npm test
npm run typecheck
```

Tests do not call the model. Early project: Grok + Codex stills, Grok video after privacy opt-in.

## License

[MIT](LICENSE)
