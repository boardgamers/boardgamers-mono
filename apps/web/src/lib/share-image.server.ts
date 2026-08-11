import { createHash } from "node:crypto";
import { Readable } from "node:stream";
// Side-effect import first: loads apps/web/.env into process.env (no-op when absent),
// so the S3_* vars are set before s3Config() reads them — regardless of cwd.
import "./server-env";
import { GetObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { error } from "@sveltejs/kit";
import { chromium, type Browser } from "playwright";
import sharp from "sharp";

// Screenshot renderer for the route-driven OG share images (/share.webp/<kind>/...). The
// browser is shared across requests and renders are bounded to 2 concurrent
// (a render is fast, and responses revalidate cheaply via ETag); failures just 503 —
// pages fall back to no image rather than a broken preview.
//
// Requires a Playwright Chromium on the host — `pnpm install` does NOT fetch one.
// Prod (PM2 on the host) gets it via scripts/deploy-remote.sh; previews bake it into
// the image. If Chromium is missing, the launch below fails and we 503 with a clear
// log instead of crashing — the rest of the app keeps serving normally.
//
// --no-sandbox: the preview container runs rootless with --cap-drop ALL +
// no-new-privileges, so Chromium's setuid sandbox helper can't work. Chromium is only
// given same-origin URLs (our own /thumbnail cards), so the sandbox buys nothing here.
let browser: Browser | null = null;
let browserLaunch: Promise<Browser> | null = null;
// At most CONCURRENCY renders run at once — a screenshot is mostly waiting on Chromium,
// so 2 lanes overlap nicely, but we stay bounded to avoid resource spikes on the
// (small) preview container. A tiny semaphore: each render takes a permit, releases on
// done; waiters queue on the next free permit.
const CONCURRENCY = 2;
let free = CONCURRENCY;
const waiters: Array<() => void> = [];
function acquire(): Promise<void> {
	if (free > 0) {
		free--;
		return Promise.resolve();
	}
	return new Promise((resolve) => waiters.push(resolve));
}
function release(): void {
	const next = waiters.shift();
	if (next) {
		next();
	} else {
		free++;
	}
}

async function getBrowser(): Promise<Browser> {
	if (browser?.isConnected()) {
		return browser;
	}
	browserLaunch ??= chromium.launch({ args: ["--no-sandbox"] }).then((b) => {
		browser = b;
		b.on("disconnected", () => {
			browser = null;
			browserLaunch = null;
		});
		return b;
	});
	try {
		return await browserLaunch;
	} catch (err) {
		// Missing/unrunnable browser is an operator problem, not a request bug — surface a
		// clear, actionable message and let the caller turn it into a 503.
		console.error(
			"OG image renderer unavailable: Chromium failed to launch (not installed?). Run `pnpm --filter @bgs/web exec playwright install --with-deps chromium`.",
			err instanceof Error ? err.message : err,
		);
		throw err;
	} finally {
		if (!browser) {
			browserLaunch = null;
		}
	}
}

// Loopback base for the internal screenshot navigation — NOT the public request
// origin. In prod the node server speaks plain http on 127.0.0.1:8612 (TLS terminates
// at the nginx upstream), so navigating headless Chromium to the public
// `https://<host>` dies with ERR_SSL_PROTOCOL_ERROR. Always render over our own http
// server instead: OG_RENDER_ORIGIN overrides (envs with an unusual internal setup),
// otherwise reuse the adapter-node listen HOST/PORT (default 127.0.0.1:8612, matching
// ecosystem.config.cjs). Only the screenshot uses this — the public og:image URL keeps
// the request's https origin (see routes/+layout.svelte).
export function renderOrigin(): string {
	const override = process.env.OG_RENDER_ORIGIN;
	if (override) {
		return override.replace(/\/+$/, "");
	}
	return `http://${loopbackAddress(process.env.HOST)}:${process.env.PORT ?? 8612}`;
}

// A connectable loopback address for the server's own listen HOST. Wildcards
// (0.0.0.0 / ::) aren't connectable — map them to the matching loopback. IPv6 hosts
// must be bracketed in a URL.
function loopbackAddress(host: string | undefined): string {
	const h = (host ?? "127.0.0.1").trim().toLowerCase();
	if (h === "0.0.0.0" || h === "::" || h === "[::]" || h === "") {
		// Wildcard: connect via the IPv4 loopback unless explicitly an IPv6 wildcard.
		return h === "::" || h === "[::]" ? "[::1]" : "127.0.0.1";
	}
	// Strip existing brackets, then re-add for IPv6 (anything with a colon).
	const bare = h.replace(/^\[|\]$/g, "");
	return bare.includes(":") ? `[${bare}]` : bare;
}

// Chromium's screenshot is PNG-only; the cards are a CSS gradient + logo + text, which
// WebP compresses far better (~460KB PNG → ~40KB WebP at q80) with no visible loss.
async function renderWebp(path: string): Promise<Buffer> {
	const b = await getBrowser();
	const page = await b.newPage({ viewport: { width: 1200, height: 630 } });
	try {
		await page.goto(`${renderOrigin()}${path}`, { waitUntil: "networkidle", timeout: 10_000 });
		// Clip to the card exactly: any stray page margin must not leak into the image.
		const png = await page.screenshot({ type: "png", timeout: 10_000, clip: { x: 0, y: 0, width: 1200, height: 630 } });
		return await sharp(png).webp({ quality: 80 }).toBuffer();
	} finally {
		await page.close().catch(() => {});
	}
}

// ETag over the exact data the card is derived from: any change to the entity (players
// joined, round advanced, karma changed…) changes the tag, so a conditional revalidation
// (If-None-Match) returns 304 without re-rendering, and a changed entity re-renders.
export function shareImageEtag(data: unknown): string {
	return `"${createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16)}"`;
}

// -- S3 cache ------------------------------------------------------------------
//
// Rendered thumbnails are cached in an S3 bucket (Scaleway in prod) keyed by ETag —
// see shareImageCacheKey. A cold request renders once via Chromium and the webp is
// stored; later requests (any process, after restarts) re-serve the stored object
// without re-rendering. The cache is best-effort: it is only active when the S3_*
// env vars are set, and any S3 error falls back to a plain render. The S3_* secrets
// live in the gitignored apps/web/.env on prod, auto-loaded by ./server-env (real
// process.env values win, so PM2-injected env still takes precedence). Never commit
// them to ecosystem.config.cjs, which is git-tracked.
// Enabled when ALL three are set; otherwise exactly today's render-every-time behavior.
function s3Config(): S3ClientConfig | null {
	const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
	if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
		return null;
	}
	return {
		region: process.env.S3_REGION || "fr-par",
		endpoint: process.env.S3_ENDPOINT || "https://s3.fr-par.scw.cloud",
		// Scaleway (and most S3-compatible stores) want path-style URLs.
		forcePathStyle: true,
		credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
	};
}

let s3Client: S3Client | null = null;
// Exported for tests — spec files can't set env vars before module import reliably,
// so they inject a mock client (or null to reset).
export function setS3ClientForTests(client: S3Client | null): void {
	s3Client = client;
}

export function s3CacheEnabled(): boolean {
	const config = s3Config();
	if (!config) {
		return false;
	}
	s3Client ??= new S3Client(config);
	return true;
}

// Deterministic key per (route, etag): the etag already changes when the underlying
// entity changes, so a changed entity renders to a NEW key and no stale object is ever
// served. e.g. share/thumbnail/game/abc123.d41d8cd98f00b204.webp — old keys are left
// for the bucket's lifecycle rules to expire.
export function shareImageCacheKey(thumbnailPath: string, etag: string): string {
	const path = thumbnailPath.replace(/\/+$/, "").replace(/[^\w.-]+/g, "_");
	const tag = etag.replace(/[^\w.-]+/g, "");
	return `share${path}.${tag}.webp`;
}

function client(): S3Client {
	if (!s3Client) {
		throw new Error("S3 cache accessed while disabled");
	}
	return s3Client;
}

// Bound S3 latency: a slow/flaky store must fail fast into the render path rather than
// add multi-second tail latency to crawler-facing OG requests. Errors already fall back
// to rendering; this just caps how long we wait.
const S3_TIMEOUT_MS = 3000;

// Stored webp for this key, or null on a miss. S3 failures are logged and treated as a
// miss — the cache must never break a request.
async function cachedThumbnail(key: string): Promise<Buffer | null> {
	try {
		const res = await client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), {
			abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS),
		});
		if (!res.Body) {
			return null;
		}
		const body = res.Body as Readable & { transformToByteArray(): Promise<Uint8Array> };
		return Buffer.from(await body.transformToByteArray());
	} catch (err) {
		if ((err as { name?: string })?.name !== "NoSuchKey") {
			console.warn("share image cache read failed, rendering instead:", (err as Error)?.message ?? err);
		}
		return null;
	}
}

async function storeThumbnail(key: string, webp: Buffer): Promise<void> {
	try {
		await client().send(
			new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: webp, ContentType: "image/webp" }),
			{ abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) },
		);
	} catch (err) {
		console.warn("share image cache write failed:", (err as Error)?.message ?? err);
	}
}

export async function shareImageResponse(
	thumbnailPath: string,
	etag: string,
	ifNoneMatch: string | null,
): Promise<Response> {
	const headers = {
		ETag: etag,
		// Short max-age + revalidation: scrapers/CDNs re-check with If-None-Match
		// (cheap, no screenshot) and get a fresh card as soon as the entity changes.
		"Cache-Control": "public, max-age=300, must-revalidate",
	};

	if (ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers });
	}

	const body = (webp: Buffer) =>
		new Response(new Uint8Array(webp), {
			headers: { ...headers, "Content-Type": "image/webp" },
		});

	if (s3CacheEnabled()) {
		const key = shareImageCacheKey(thumbnailPath, etag);
		const cached = await cachedThumbnail(key);
		if (cached) {
			return body(cached);
		}
		const webp = await render(thumbnailPath);
		// Awaited rather than fire-and-forget so callers (and tests) can rely on the
		// write being issued; storeThumbnail never throws.
		await storeThumbnail(key, webp);
		return body(webp);
	}

	return body(await render(thumbnailPath));
}

async function render(thumbnailPath: string): Promise<Buffer> {
	try {
		await acquire();
		try {
			return await renderWebp(thumbnailPath);
		} finally {
			release();
		}
	} catch (err) {
		console.error("share image render failed", err);
		throw error(503, "Share image unavailable");
	}
}
