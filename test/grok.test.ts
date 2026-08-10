import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  loadGrokAuth,
  parseFirstJsonObject,
} from "../src/grok.ts";
import { sessionDirFor } from "../src/session-paths.ts";

test("parses grok output that has trailing non-JSON appended", () => {
  // Legacy CLI: a JSON object, then a plain-text line.
  const raw = `{
  "text": "done",
  "num_turns": 3,
  "total_cost_usd": 0.0654252
}
Error: max turns reached`;
  assert.throws(() => JSON.parse(raw), /Unexpected|Extra data/);

  const parsed = parseFirstJsonObject(raw);
  assert.equal(parsed?.text, "done");
  assert.equal(parsed?.num_turns, 3);
});

test("brace counting is not fooled by braces inside strings", () => {
  const raw = `{"text":"a } b { c","num_turns":1} trailing`;
  assert.equal(parseFirstJsonObject(raw)?.text, "a } b { c");
});

test("escaped quotes inside strings do not end the string early", () => {
  const raw = String.raw`{"text":"he said \"hi\" }","num_turns":2}`;
  const parsed = parseFirstJsonObject(raw);
  assert.equal(parsed?.text, 'he said "hi" }');
  assert.equal(parsed?.num_turns, 2);
});

test("returns null when there is no JSON at all", () => {
  assert.equal(parseFirstJsonObject("command not found"), null);
});

test("session directory is keyed by encodeURIComponent of the cwd", () => {
  const dir = sessionDirFor("/Users/a/proj", "abc-123");
  assert.ok(dir.endsWith("/.grok/sessions/%2FUsers%2Fa%2Fproj/abc-123"), dir);
});

test("loadGrokAuth reads OIDC key from auth.json shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvas-auth-"));
  const path = join(dir, "auth.json");
  await writeFile(
    path,
    JSON.stringify({
      "https://auth.x.ai::client": {
        key: "test-session-token-abc",
        auth_mode: "oidc",
        refresh_token: "refresh",
      },
    }),
  );
  const prevKey = process.env.XAI_API_KEY;
  const prevCanvas = process.env.CANVAS_XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.CANVAS_XAI_API_KEY;
  try {
    const auth = loadGrokAuth(path);
    assert.equal(auth.source, "session");
    assert.equal(auth.token, "test-session-token-abc");
  } finally {
    if (prevKey !== undefined) process.env.XAI_API_KEY = prevKey;
    if (prevCanvas !== undefined) process.env.CANVAS_XAI_API_KEY = prevCanvas;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadGrokAuth prefers XAI_API_KEY over session file", () => {
  const prev = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "xai-from-env";
  try {
    const auth = loadGrokAuth("/nonexistent/auth.json");
    assert.equal(auth.source, "api_key");
    assert.equal(auth.token, "xai-from-env");
  } finally {
    if (prev === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prev;
  }
});
