import type { RequestHandler } from "./$types";
import { siteName } from "@/lib/seo";
import { error } from "@sveltejs/kit";
import { chromium, type Browser } from "playwright";

// OG share-image renderer: screenshots the SSR'd /og card at 1200x630. The browser is
// shared across requests and renders are serialized through a one-slot queue (a render is
// fast, and cards are cached downstream); failures just 503 — callers fall back to no
// image rather than a broken preview.
//
// --no-sandbox: the preview container runs rootless with --cap-drop ALL +
// no-new-privileges, so Chromium's setuid sandbox helper can't work. Chromium is only
// given same-origin localhost URLs (the /og card), so the sandbox buys nothing here.
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

async function renderPng(origin: string, card: Record<string, string>): Promise<Buffer> {
	const b = await getBrowser();
	const page = await b.newPage({ viewport: { width: 1200, height: 630 } });
	try {
		const params = new URLSearchParams(Object.entries(card).filter(([, value]) => value));
		await page.goto(`${origin}/og?${params}`, { waitUntil: "networkidle", timeout: 10_000 });
		// Clip to the card exactly: any stray page margin must not leak into the image.
		return await page.screenshot({ type: "png", timeout: 10_000, clip: { x: 0, y: 0, width: 1200, height: 630 } });
	} finally {
		await page.close().catch(() => {});
	}
}

export const GET: RequestHandler = async ({ url }) => {
	// The default card shares the site name, so a missing title is fine — anything longer
	// would just overflow the card.
	const title = (url.searchParams.get("title") ?? siteName).slice(0, 90) || siteName;
	const subtitle = (url.searchParams.get("subtitle") ?? "").slice(0, 140);
	const game = (url.searchParams.get("game") ?? "").slice(0, 60);
	const description = (url.searchParams.get("description") ?? "").slice(0, 140);
	const players = (url.searchParams.get("players") ?? "").slice(0, 40);
	const pace = (url.searchParams.get("pace") ?? "").slice(0, 40);

	// TODO: cache rendered PNGs to S3 keyed by title+subtitle+game+description+players+pace once
	// S3 is available, so cards aren't recomputed per unique query string (see WORKAROUNDS.md).
	const render = queue.then(() => renderPng(url.origin, { title, subtitle, game, description, players, pace }));
	queue = render.catch(() => {});

	try {
		const png = await render;
		return new Response(new Uint8Array(png), {
			headers: {
				"Content-Type": "image/png",
				// Crawlers and chat apps refetch rarely; a day of caching keeps renders cheap
				// while letting per-page cards (player counts…) stay fresh enough.
				"Cache-Control": "public, max-age=86400",
			},
		});
	} catch (err) {
		console.error("og image render failed", err);
		throw error(503, "Share image unavailable");
	}
};
