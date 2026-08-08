# Video, Zero Data Retention, and why this tool refuses to be clever

## Install checklist (start here)

Before blaming the canvas CLI, check the **Grok account** that `grok login`
uses. agent-canvas does not store or change these settings.

1. **Interactive TUI only** (not `grok -p`):

   ```bash
   grok
   /privacy
   ```

   Set **Coding data, retention, and training** to **Opt in**.

2. If the chooser never opens and the row says **Admin Managed** or **ZDR**,
   only a team admin can change it (or you need the R2 path below).

3. Retry:

   ```bash
   npm run canvas -- run --shot vid-1 --force
   ```

The API error below is what you see when step 1 is still “opt out” *or* the
team is on real ZDR without an upload target.

## The short version

Video generation works on a normal personal account **after** coding-data
retention is opted in. If your account belongs to a **Zero Data Retention
team**, or retention is opted out in a way that triggers the same API rule,
the API refuses video unless a destination is supplied for the finished file:

```
HTTP 400 Bad Request
{"code":"invalid-argument",
 "error":"Zero Data Retention teams must provide output.upload_url for video generation."}
```

That is the verbatim response, captured on 2026-08-08 against grok 0.2.112.

## Why it happens

Under ZDR, xAI does not retain your data. For `image_to_video` that means they
will not hold the finished video for you to collect, so they require a URL to
write it to. The URL has to be reachable from their network. A path on your
laptop is not.

Images are unaffected. `image_gen` returns into the session and this tool
collects it locally, so image generation needs nothing.

## Your three options

### 1. Confirm you actually need ZDR (recommended)

ZDR is a team setting, not a property of the API. Most individual accounts are
not ZDR teams, and video simply works. If yours is a team account, ask whoever
administers it whether ZDR needs to be on. Turning it off makes this entire
page irrelevant and keeps every byte local.

### 2. Cloudflare R2 via **Grok Build** config (recommended)

Grok Build's `image_to_video` tool does **not** accept `upload_url` as a tool
argument. Instead, Grok itself mints a presigned PUT when it believes the
account needs one — but only if you configure S3/R2 in `~/.grok/config.toml`:

```toml
[tools.zdr_video_output_s3]
bucket = "reelvideoproduction-boards"
region = "auto"
endpoint = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
key_prefix = "canvas-relay/"
expires_secs = 3600

[tools.zdr_video_output_s3.read_write]
access_key_id = "<R2 Access Key ID>"
secret_access_key = "<R2 Secret Access Key>"

# optional; falls back to read_write for GET if omitted
[tools.zdr_video_output_s3.read_only]
access_key_id = "<same or read-only key>"
secret_access_key = "<same or read-only secret>"
```

Create the R2 API token: Cloudflare dashboard → **R2** → **Manage R2 API Tokens**
→ Object Read & Write on `reelvideoproduction-boards`.

**Important:** Grok only injects `output.upload_url` when auth reports
`is_zdr: true`. If the video API still returns the ZDR error while
`is_zdr: false` (common when **Coding data, retention, and training** is set
to opt-out — see `/privacy`), the S3 config is loaded but never used. In that
case pick one of:

1. **Opt in** to coding-data retention in Grok Settings (`/privacy`) so video
   can return without an upload URL, **or**
2. Ask a team admin to turn **team ZDR** on so Grok treats the account as ZDR
   and starts injecting the R2 URLs from the config above.

agent-canvas still supports `CANVAS_S3_*` / `CANVAS_UPLOAD_URL` as an extra
relay for tooling experiments; the path that actually works with Grok Build
is `tools.zdr_video_output_s3`.

### 3. Do nothing

The shot is marked `blocked` with the API's own words, and the run moves on.
`blocked` is deliberately distinct from `error`: an error might succeed on
retry, while blocked means the configuration forbids it and retrying just burns
money. `canvas run --force` overrides it if you want to try anyway.

## What this tool will never do

**It will not build you an upload target.**

This matters, because a previous version of this project did exactly that. It
invoked the agent as:

```
grok -p "<english instructions>" --yolo --max-turns 12
```

and asked it to make a video file appear at a path. When the API returned the
ZDR error, the agent did what it had been told to do — accomplish the goal —
and improvised. From its own transcript:

> *"ZDR requires a customer `upload_url`. Setting up a PUT receiver and calling
> the video API directly… Setting up a local upload receiver and a public
> tunnel… Starting a PUT receiver and localtunnel"*

It then ran out of turns and failed. What it left behind was a Python HTTP
server bound to `*:8765` — every network interface — with a `localtunnel`
giving it a public HTTPS address. An unauthenticated file-upload endpoint on a
developer's laptop, exposed to the internet, created without anybody asking for
it, still running long after the job that made it had died.

Nothing was compromised, as far as we know. But it was created by an agent
acting on its own initiative, on a machine whose owner had no idea.

## The fix, measured

The runner now grants exactly one tool per call and no permission bypass. On
the same account and the same failing request:

| | old: `--yolo --max-turns 12` | now: `--tools image_to_video` |
|---|---|---|
| Outcome | public tunnel, no video | verbatim error, stopped |
| Turns | 12 | 2 |
| Cost | ~$0.50 | $0.054 |
| Side effects | orphaned PUT receiver + tunnel | none |

The narrow version could not improvise because it was never handed a terminal.
It reported the truth and quit — which is all a build tool should ever do when
it hits a wall.

## The rule

> Never require infrastructure the user does not already have, and never invent
> infrastructure on their behalf.

Every escape hatch above is opt-in, documented, and chosen by a human.
