import assert from "node:assert/strict";
import { test } from "node:test";
import { presign, type S3Config } from "../src/s3.ts";

const config: S3Config = {
  endpoint: "https://abc123.r2.cloudflarestorage.com",
  bucket: "my-bucket",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "auto",
};

test("presign PUT builds a virtual-hosted R2 URL with signature params", () => {
  const { url, key } = presign(config, "PUT", "canvas-relay/vid-1.mp4", 3600);
  assert.equal(key, "canvas-relay/vid-1.mp4");
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.host, "my-bucket.abc123.r2.cloudflarestorage.com");
  assert.equal(parsed.pathname, "/canvas-relay/vid-1.mp4");
  assert.equal(parsed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.ok(parsed.searchParams.get("X-Amz-Credential")?.includes("/auto/s3/"));
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "3600");
  assert.equal(parsed.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.match(parsed.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
});

test("presign path-style puts the bucket in the path", () => {
  const { url } = presign(
    { ...config, forcePathStyle: true },
    "GET",
    "a/b.mp4",
    600,
  );
  const parsed = new URL(url);
  assert.equal(parsed.host, "abc123.r2.cloudflarestorage.com");
  assert.equal(parsed.pathname, "/my-bucket/a/b.mp4");
});

test("keys with spaces are percent-encoded in the path", () => {
  const { url } = presign(config, "PUT", "canvas-relay/has space.mp4", 60);
  assert.ok(new URL(url).pathname.includes("has%20space.mp4"));
});
