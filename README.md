# agent-canvas

An agent-operated canvas for making short videos with **Grok Build**.

An agent opens a pull request that adds shots to a canvas. You review them in a
browser, fix the prompts that missed, and re-run the ones worth re-running.

- **Auth is CLI login.** No API keys. `grok login` (and optional `codex login`).
- **Everything stays local.** Generated media lands in `canvas/assets/`.
- **No runtime dependencies.** Node 20+, and that's the whole list.
- **Providers:** images = Grok or Codex; video = Grok `reference_to_video`.

## Requirements (read this before `canvas run`)

Video uses **Grok Build** on your account. Two account-side settings matter;
**agent-canvas cannot set them for you.**

### 1. Coding data retention — required for most personal accounts

If **Coding data, retention, and training** is **opted out**, the video API
often returns:

```text
Zero Data Retention teams must provide output.upload_url for video generation.
```

even when team ZDR is off. Fix it **once** in the interactive Grok TUI (not
`grok -p`):

```bash
grok                 # open the interactive UI
/privacy             # Settings → Coding data, retention, and training
# choose: Opt in
```

Headless runs never show that chooser. On **team** accounts only a **team
admin** may change it; if the row says `Admin Managed` or `ZDR`, ask an admin.

This setting lives on **your xAI/Grok account**, not in this repo. Every
machine/user that logs in may need to do it once.

### 2. Team Zero Data Retention (optional path)

If the team has **ZDR** enabled for real (`is_zdr: true`), opting in may be
locked. Then configure Grok Build to mint upload URLs into S3/R2 via
`~/.grok/config.toml` — see [docs/zdr.md](docs/zdr.md).

Images always work without either of the above. Only **video** is affected.

## How it works

Structure in the project and UI:

```
Storyboard (1 multi-panel image)
  └── Scene (~6s beat)
        ├── first frame · middle frame · last frame  (style-locked to board)
        └── video  →  reference_to_video([first, mid, last])
```

```bash
canvas add image --provider codex --prompt "8-panel Pixar storyboard…"
canvas storyboard set img-1
canvas scene add --name "Ride and trip" --panels 1-4
# creates 3 keyframe images + 1 video under scene-1
```

Shots still live in `canvas/project.json` (now `version: 3` with `storyboardId` + `scenes`):

```json
{
  "version": 2,
  "name": "goat ad",
  "shots": [
    { "id": "img-1", "kind": "image", "prompt": "a goat on a hill at golden hour",
      "aspect": "9:16", "provider": "grok", "status": "ready",
      "asset": "assets/img-1.jpg", "hash": "8b1c…" },
    { "id": "vid-1", "kind": "video", "prompt": "slow push in",
      "from": "img-1", "duration": 6, "status": "pending", "asset": null }
  ]
}
```

There is no node graph and there are no coordinates. A video's only dependency
is the image it animates, named directly by `from`. That removes edges,
positions, topological sorting, and drag-and-drop — and it makes the file
something you can actually read in a PR diff.

## Quick start

```bash
npm install
grok login                       # once — install Grok Build first if needed

# once per account (interactive TUI — see Requirements above)
grok
# then type: /privacy  →  Opt in

npm run canvas -- init "goat ad"
npm run canvas -- add image --prompt "a goat on a hill at golden hour" --aspect 9:16
npm run canvas -- add video --from img-1 --prompt "slow cinematic push-in"
npm run canvas -- run            # uses Grok reference_to_video
npm run canvas -- serve          # → http://localhost:4180 (opens browser)
```

## For agents

Every command takes `--json` and prints one machine-readable object. Exit codes
are meaningful: `0` success, `1` failure, `2` usage error.

```bash
canvas add image --prompt "..." --json
# {"ok":true,"shot":{"id":"img-1","status":"pending",...}}

canvas run --json
# {"ok":true,"summary":{"ready":2,"skipped":0,"failed":0,"blocked":0,"costUsd":0.11},"events":[...]}
```

A typical agent contribution is: `init` → `add` a few shots → `run` → commit
`canvas/project.json` → open a PR. The media is gitignored; the project file is
the reviewable artifact.

## For humans

`canvas serve` renders a **node-style board** (images left, videos right, edges
for `from` links) inspired by the old React Flow UI — without shipping a client
framework. Each image node has a **Grok / Codex** provider control. Editing a
prompt is a form POST. Progress refreshes with `<meta refresh>` only while a
run is in flight. Asset URLs are content-addressed and `immutable` so media is
decoded once (the old canvas re-fetched multi-MB bitmaps every re-render).

This is not minimalism for its own sake. The predecessor to this project was a
React Flow canvas that recomputed image URLs during render with a `Date.now()`
cache-buster. Every re-render produced a URL the browser had never seen: a
fresh download and a fresh decode of a 3.7 MB bitmap, retained in the memory
cache. During a run, progress events re-rendered continuously and the renderer
process was killed. Asset URLs here are content-addressed and served
`immutable`, so each file is fetched and decoded exactly once.

## Safety

The runner grants the model **exactly one tool per call** — `image_gen` or
`reference_to_video` — with no web access, no terminal, and no permission bypass.

It cannot move a file, open a port, or install anything, because it is never
given the means. Generated media is collected by *our* code from a session
directory whose path we choose via `--session-id`; the agent is never asked to
place a file.

That constraint is load-bearing. See [docs/zdr.md](docs/zdr.md) for what
happened when an earlier version ran `--yolo` and asked an agent to solve a
filesystem problem on its own.

It also closes a supply-chain hole. Prompts arrive via pull request, and in the
old design a prompt was interpolated into instructions for an agent holding a
shell. A hostile PR was a remote code execution primitive. Now a prompt reaches
an image generator and nothing else.

## Commands

```
canvas init [name]                        Create canvas/project.json
canvas add image --prompt <text>          [--aspect 9:16|1:1|16:9|4:3|3:4]
                                          [--provider grok] [--id <id>]
canvas add video --from <id> --prompt <t> [--duration 6|10] [--id <id>]
canvas set <id> --prompt <text>           Rewrite a prompt (marks it pending)
canvas rm <id>                            Remove a shot
canvas run [--shot <id>] [--force]        Generate pending shots
canvas status                             Show every shot
canvas serve [--port 4180]                Human review UI

--root <dir>   Project root (default: cwd)
--json         Machine-readable output
```

## Shot status

| Status | Meaning |
|---|---|
| `pending` | Needs generating |
| `running` | In flight |
| `ready` | Has an asset matching its current prompt |
| `error` | Failed; retrying might work |
| `blocked` | Configuration forbids it; retrying will not help until you change something |

Re-running skips shots whose inputs haven't changed. Editing a prompt marks the
shot pending; re-rolling an image invalidates any video animating it.

## Video permissions and Zero Data Retention

| Situation | What to do |
|---|---|
| Fresh install, personal account | `grok` → `/privacy` → **Opt in** (see Requirements) |
| Video fails with `output.upload_url` / ZDR text | Same `/privacy` step, or team admin ZDR + R2 config |
| Team has real ZDR on | Configure `tools.zdr_video_output_s3` in `~/.grok/config.toml` — [docs/zdr.md](docs/zdr.md) |

If video is blocked, the shot is marked `blocked` with the API's own error text
and the run moves on. The tool will **never** invent a public tunnel or upload
endpoint for you.

## Development

```bash
npm test        # node:test, no network
npm run typecheck
```

Tests never call the model, so CI needs no credentials.

## Status

Early. Images: Grok and Codex. Video: Grok `reference_to_video` once coding-data
retention is opted in (or ZDR + R2 is configured).

## License

MIT
