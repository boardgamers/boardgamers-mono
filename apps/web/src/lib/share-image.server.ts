import { createHash } from "node:crypto";
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

	let webp: Buffer;
	try {
		await acquire();
		try {
			webp = await renderWebp(thumbnailPath);
		} finally {
			release();
		}
	} catch (err) {
		console.error("share image render failed", err);
		throw error(503, "Share image unavailable");
	}

	return new Response(new Uint8Array(webp), {
		headers: { ...headers, "Content-Type": "image/webp" },
	});
}
