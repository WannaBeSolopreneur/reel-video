/**
 * Minimal S3-compatible client for the ZDR video relay.
 *
 * Zero runtime dependencies: AWS Signature Version 4 with node:crypto only.
 * Enough for R2 / Railway / S3: presign PUT, authenticated GET, DELETE.
 *
 * Virtual-hosted URLs (`https://bucket.endpoint/key`) are the default.
 * Set forcePathStyle when the store requires path-style
 * (`https://endpoint/bucket/key`) — R2 accepts either; Railway tells you which.
 */

import { createHmac, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  /** When true, use path-style URLs. Default false (virtual-hosted). */
  forcePathStyle?: boolean;
}

export interface PresignedUrl {
  url: string;
  /** Object key this URL refers to. */
  key: string;
  expiresIn: number;
}

function requireConfig(): S3Config | null {
  const endpoint = process.env.CANVAS_S3_ENDPOINT?.trim();
  const bucket = process.env.CANVAS_S3_BUCKET?.trim();
  const accessKeyId = process.env.CANVAS_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.CANVAS_S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.CANVAS_S3_REGION?.trim() || "auto",
    forcePathStyle: process.env.CANVAS_S3_FORCE_PATH_STYLE === "1",
  };
}

/** True when S3/R2 credentials are present for minting relay URLs. */
export function hasS3Config(): boolean {
  return requireConfig() !== null;
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDate(date: Date): { amz: string; day: string } {
  const iso = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { amz: iso, day: iso.slice(0, 8) };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode each path segment; keep `/` separators. */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

function hostAndPath(
  config: S3Config,
  key: string,
): { host: string; path: string; canonicalUri: string } {
  const endpointUrl = new URL(config.endpoint);
  const encodedKey = encodeKey(key);
  if (config.forcePathStyle) {
    const path = `/${config.bucket}/${encodedKey}`;
    return {
      host: endpointUrl.host,
      path,
      canonicalUri: path,
    };
  }
  // Virtual-hosted: bucket as subdomain of the endpoint host.
  const host = `${config.bucket}.${endpointUrl.host}`;
  const path = `/${encodedKey}`;
  return { host, path, canonicalUri: path };
}

function signingKey(
  secret: string,
  day: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secret}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Presign a URL for a single method. Query-string auth so xAI can PUT without
 * our headers.
 */
export function presign(
  config: S3Config,
  method: "GET" | "PUT" | "DELETE",
  key: string,
  expiresIn = 3600,
): PresignedUrl {
  const region = config.region ?? "auto";
  const service = "s3";
  const now = new Date();
  const { amz, day } = amzDate(now);
  const { host, path, canonicalUri } = hostAndPath(config, key);
  const credential = `${config.accessKeyId}/${day}/${region}/${service}/aws4_request`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k]!)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const payloadHash = "UNSIGNED-PAYLOAD";
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "host",
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    `${day}/${region}/${service}/aws4_request`,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = hmac(
    signingKey(config.secretAccessKey, day, region, service),
    stringToSign,
  ).toString("hex");

  const endpointUrl = new URL(config.endpoint);
  const url = `${endpointUrl.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return { url, key, expiresIn };
}

/** Authenticated GET of an object; writes bytes to destPath. */
export async function getObjectToFile(
  config: S3Config,
  key: string,
  destPath: string,
): Promise<void> {
  const { url } = presign(config, "GET", key, 600);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `S3 GET failed (${res.status}) for ${key}: ${body.slice(0, 300) || res.statusText}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}

/** Best-effort delete; ignores 404. */
export async function deleteObject(config: S3Config, key: string): Promise<void> {
  const { url } = presign(config, "DELETE", key, 600);
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `S3 DELETE failed (${res.status}) for ${key}: ${body.slice(0, 300) || res.statusText}`,
    );
  }
}

/**
 * Mint a short-lived PUT URL for a unique object key under canvas-relay/.
 * Returns null when S3 env is not configured.
 */
export function mintRelayPut(keySuffix: string): {
  config: S3Config;
  putUrl: string;
  key: string;
} | null {
  const config = requireConfig();
  if (!config) return null;
  const key = `canvas-relay/${keySuffix}`;
  const { url } = presign(config, "PUT", key, 3600);
  return { config, putUrl: url, key };
}
