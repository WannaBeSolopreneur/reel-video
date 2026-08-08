# Design: agent-canvas

*2026-08-08*

## What this is

An agent-operated canvas for making short videos with Grok Build. An agent adds
shots through a CLI and opens a pull request; a human reviews the result in a
browser, fixes prompts, and re-runs what needs re-running.

It replaces an earlier project (`canvas-studio`) that had the same goal and
three architectural faults, each of which is addressed below by construction
rather than by discipline.

## Requirements

- **Agents drive it.** Interface is a CLI, every command `--json`.
- **Humans stay in the loop.** They review and steer: read prompts, edit them,
  approve, re-run. They do not author graph structure by hand.
- **Open source.** No required infrastructure, no accounts, no hosted service.
  `git clone`, `grok login`, go.
- **The PR is the artifact.** Project state is one readable, diffable file.

## Decisions

### 1. A list of shots, not a node graph

`project.json` holds an ordered `shots` array. A video names its source image
with `from: "img-1"`. There are no edges, no x/y coordinates, and no
topological sort.

*Why:* the human's job is review, not authoring structure, so the freeform
canvas earned nothing. Dropping it removed React Flow, drag-and-drop, edge
management, and coordinate persistence — and made the file readable in a diff.

### 2. Server-rendered HTML, zero client JavaScript

`canvas serve` renders every page on the server. Interaction is plain form
POSTs. Progress refreshes with `<meta refresh>`, only while a run is in flight.

*Why:* the predecessor crashed the browser tab, repeatedly, and eventually made
an 8 GB machine unusable. Root cause was `assetUrl()` returning
`` `${path}?t=${Date.now()}` `` from inside a render body. Every re-render
produced a URL the browser had never seen — a fresh fetch and a fresh decode of
a 720×1280 bitmap (3.7 MB each), retained in the memory cache because each URL
was unique. Three images meant ~11 MB of new bitmaps per render generation, and
during a run SSE progress events re-rendered continuously.

The fix is structural, not careful: **asset URLs are content-addressed**
(`?v=<hash>`) and served `Cache-Control: immutable`, so each file is fetched and
decoded exactly once. With no client state there is nothing left to leak.
Measured on the running UI: 0 script tags, 10 MB heap, flat.

### 3. The agent generates; our code handles files

Grok gets **exactly one tool per call** — `image_gen` or `image_to_video` — with
`--disable-web-search`, a low `--max-turns`, and no permission bypass.

This required solving a real problem: `image_gen` takes no output path. It
generates into the session directory and leaves it there, so placing the file
somewhere specific needs a shell. Rather than grant one, we exploit the fact
that Grok accepts `--session-id` and lays sessions out predictably:

```
~/.grok/sessions/<encodeURIComponent(cwd)>/<sessionId>/images/1.jpg
```

We choose the session id, so we know the path in advance. The agent only
generates; `runner.ts` collects the bytes and decides where they belong.

*Why it matters:* the old runtime called
`grok -p "<english instructions>" --yolo --max-turns 12` and asked the agent to
make a file appear at a path. When the video API refused a request, the agent
did as instructed and improvised — standing up a local PUT receiver and a public
tunnel, then running out of turns. It left an unauthenticated upload endpoint
bound to every interface of the developer's laptop, publicly routable, running
long after the job died.

Measured on the same account and the same failing call:

| | `--yolo --max-turns 12` | `--tools image_to_video` |
|---|---|---|
| Outcome | public tunnel, no video | verbatim error, stopped |
| Turns | 12 | 2 |
| Cost | ~$0.50 | $0.054 |
| Side effects | orphaned receiver + tunnel | none |

It also closes a supply-chain hole. Prompts arrive by pull request; in the old
design a prompt was interpolated into instructions for an agent holding a shell,
making a hostile PR an RCE primitive. Now a prompt reaches an image generator
and nothing else.

### 4. `blocked` is a first-class status

Distinct from `error`. An error might succeed on retry; `blocked` means the
account or configuration forbids it, so automatic retry only burns money.

The motivating case: Zero Data Retention teams cannot generate video without
supplying `output.upload_url`. The runner records the API's own words and moves
on. `--force` overrides. See [zdr.md](zdr.md).

**The governing rule: never require infrastructure the user does not already
have, and never invent infrastructure on their behalf.**

### 5. One package, no runtime dependencies

The predecessor was seven npm workspaces for ~2,100 lines. This is one package
with seven modules and zero runtime dependencies — `node:http` serves, `node:test`
tests.

## Components

| Module | Responsibility |
|---|---|
| `types.ts` | Shot and project shapes |
| `project.ts` | Load/save `project.json`, mutate shots, hashing, skip logic |
| `session-paths.ts` | Derive Grok's session dir; collect generated media |
| `grok.ts` | The narrow doorway: one tool, no shell, structured result |
| `runner.ts` | Orchestrate shots, own every filesystem decision |
| `server.ts` | `canvas serve` — HTTP, no framework |
| `views.ts` | HTML strings |
| `cli.ts` | Agent interface, `--json` everywhere |

## Data flow

```
agent: canvas add image --prompt "..." --json
        └─> project.json (status: pending)

agent: canvas run --json
        └─> runner picks pending shots, images before videos
             └─> grok.ts: one tool, chosen --session-id
                  └─> agent generates into the session dir
             └─> runner copies bytes to canvas/assets/<id>.jpg
             └─> project.json (status: ready, hash: <inputs>)

human: canvas serve  →  reads project.json, renders HTML
        └─> edits a prompt (form POST) → status: pending
        └─> Regenerate (form POST) → background run, page self-refreshes
```

## Error handling

Failures are recorded on the shot, never thrown away. A run continues past a
failed shot. Every failure surfaces in three places identically: CLI text, CLI
`--json`, and the review page. Upstream API errors are quoted verbatim rather
than paraphrased — the ZDR message is what told us what was actually wrong.

## Testing

`node:test`, no network, no credentials, so CI runs anywhere. Tests cover the
behaviours that actually bit us: hash invalidation when a prompt changes or a
source image is re-rolled, refusing to orphan a video's source frame, `blocked`
not being retried, and parsing Grok's JSON output when it appends
`Error: max turns reached` after the closing brace.

## Verified end to end

`init` → `add image` → `add video` → `run`:

- `img-1` ready, 720×1280, 312 KB on disk
- `vid-1` blocked, quoting the ZDR error, run continued
- $0.0981 total
- **zero listeners or tunnels created**

## Not built yet

- Codex image provider (stubbed, reports `blocked`)
- ~~`CANVAS_UPLOAD_URL` / `CANVAS_S3_*` relay for ZDR teams~~ (implemented — R2)
- Thumbnails — full-resolution images are served with `immutable` caching and
  `loading="lazy"`, which is sufficient at current shot counts
