import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFirstJsonObject } from "../src/grok.ts";
import { sessionDirFor } from "../src/session-paths.ts";

test("parses grok output that has trailing non-JSON appended", () => {
  // Observed verbatim from grok 0.2.112: a JSON object, then a plain-text line.
  // JSON.parse on the whole stream throws "Extra data".
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
  // This derivation is what lets us collect generated media without giving the
  // agent a shell to move files with. Verified against grok 0.2.112.
  const dir = sessionDirFor("/Users/a/proj", "abc-123");
  assert.ok(dir.endsWith("/.grok/sessions/%2FUsers%2Fa%2Fproj/abc-123"), dir);
});
