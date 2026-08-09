import { createHash } from "node:crypto";
import { error } from "@sveltejs/kit";
import { chromium, type Browser } from "playwright";
import sharp from "sharp";

// Screenshot renderer for the route-driven OG share images (/share.webp/<kind>/...). The
// browser is shared across requests and renders are serialized through a one-slot queue
// (a render is fast, and responses revalidate cheaply via ETag); failures just 503 —
// pages fall back to no image rather than a broken preview.
//
// --no-sandbox: the preview container runs rootless with --cap-drop ALL +
// no-new-privileges, so Chromium's setuid sandbox helper can't work. Chromium is only
// given same-origin URLs (our own /thumbnail cards), so the sandbox buys nothing here.
let browser: Browser | null = null;
let browserLaunch: Promise<Browser> | null = null;
let queue: Promise<unknown> = Promise.resolve();

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
	} finally {
		if (!browser) {
			browserLaunch = null;
		}
	}
}

// Chromium's screenshot is PNG-only; the cards are a CSS gradient + logo + text, which
// WebP compresses far better (~460KB PNG → ~40KB WebP at q80) with no visible loss.
async function renderWebp(origin: string, path: string): Promise<Buffer> {
	const b = await getBrowser();
	const page = await b.newPage({ viewport: { width: 1200, height: 630 } });
	try {
		await page.goto(`${origin}${path}`, { waitUntil: "networkidle", timeout: 10_000 });
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
	origin: string,
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

	const render = queue.then(() => renderWebp(origin, thumbnailPath));
	queue = render.catch(() => {});

	try {
		const webp = await render;
		return new Response(new Uint8Array(webp), {
			headers: { ...headers, "Content-Type": "image/webp" },
		});
	} catch (err) {
		console.error("share image render failed", err);
		throw error(503, "Share image unavailable");
	}
}
