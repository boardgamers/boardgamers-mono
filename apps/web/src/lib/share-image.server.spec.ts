import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
	renderOrigin,
	setS3ClientForTests,
	shareImageCacheKey,
	shareImageEtag,
	shareImageResponse,
} from "./share-image.server";

// Never launch a real Chromium: `launch` resolves to a fake browser whose screenshot
// returns a fixed PNG (sharp is real, so the render path still produces true webp).
// The fetch stub in beforeEach stands in for page.goto's navigation to the render
// origin, which doesn't exist in tests.
const png = await sharp({
	create: { width: 1200, height: 630, channels: 3, background: { r: 20, g: 30, b: 60 } },
})
	.png()
	.toBuffer();

const newPage = vi.fn();
vi.mock("playwright", () => ({
	chromium: {
		launch: () =>
			Promise.resolve({
				isConnected: () => true,
				on: () => {},
				newPage: (...args: unknown[]) => newPage(...args),
			}),
	},
}));

// The internal screenshot must always navigate to the app's own http loopback server,
// never the public https origin (prod node speaks plain http behind nginx — see the
// renderOrigin comment). Resolution order: OG_RENDER_ORIGIN > http://<HOST>:<PORT>
// (HOST normalized to a connectable loopback) > http://127.0.0.1:8612.
describe("renderOrigin", () => {
	afterEach(() => {
		delete process.env.OG_RENDER_ORIGIN;
		delete process.env.HOST;
		delete process.env.PORT;
	});

	it("defaults to the adapter-node default on the http loopback", () => {
		expect(renderOrigin()).toBe("http://127.0.0.1:8612");
	});

	it("uses the listen PORT", () => {
		process.env.PORT = "4123";
		expect(renderOrigin()).toBe("http://127.0.0.1:4123");
	});

	it("honors an IPv4 HOST", () => {
		process.env.HOST = "127.0.0.1";
		process.env.PORT = "8612";
		expect(renderOrigin()).toBe("http://127.0.0.1:8612");
	});

	it("brackets an IPv6 HOST", () => {
		process.env.HOST = "::1";
		expect(renderOrigin()).toBe("http://[::1]:8612");
	});

	it("accepts an already-bracketed IPv6 HOST", () => {
		process.env.HOST = "[::1]";
		expect(renderOrigin()).toBe("http://[::1]:8612");
	});

	it("maps the IPv4 wildcard to the IPv4 loopback", () => {
		process.env.HOST = "0.0.0.0";
		expect(renderOrigin()).toBe("http://127.0.0.1:8612");
	});

	it("maps the IPv6 wildcard to the IPv6 loopback", () => {
		process.env.HOST = "::";
		expect(renderOrigin()).toBe("http://[::1]:8612");
	});

	it("OG_RENDER_ORIGIN wins over HOST/PORT and is stripped of trailing slashes", () => {
		process.env.HOST = "::";
		process.env.PORT = "4123";
		process.env.OG_RENDER_ORIGIN = "http://localhost:9999/";
		expect(renderOrigin()).toBe("http://localhost:9999");
	});
});

describe("shareImageCacheKey", () => {
	it("is deterministic and derives from path + etag", () => {
		expect(shareImageCacheKey("/thumbnail/game/abc123", '"d41d8cd98f00b204"')).toBe(
			"share_thumbnail_game_abc123.d41d8cd98f00b204.webp",
		);
		expect(shareImageCacheKey("/thumbnail", '"0123456789abcdef"')).toBe("share_thumbnail.0123456789abcdef.webp");
	});

	it("produces a new key when the etag changes (no stale cache)", () => {
		const a = shareImageCacheKey("/thumbnail/user/bob", shareImageEtag({ karma: 10 }));
		const b = shareImageCacheKey("/thumbnail/user/bob", shareImageEtag({ karma: 11 }));
		expect(a).not.toBe(b);
		expect(a).toMatch(/^share_thumbnail_user_bob\.[0-9a-f]{16}\.webp$/);
	});

	it("sanitizes characters that are awkward in object keys", () => {
		const key = shareImageCacheKey("/thumbnail/game/a b@c?d", '"quoted+tag/"');
		expect(key).toMatch(/^share[\w./-]+$/);
		expect(key).not.toMatch(/[\s?"+]/);
	});
});

describe("shareImageResponse S3 cache", () => {
	const etag = '"0011223344556677"';
	const path = "/thumbnail/game/abc123";
	const cacheKey = shareImageCacheKey(path, etag);

	type Send = ReturnType<typeof vi.fn>;
	let send: Send;

	const s3Env = {
		S3_BUCKET: "bgs-assets",
		S3_ACCESS_KEY_ID: "id",
		S3_SECRET_ACCESS_KEY: "secret",
	};

	function enableS3(s: Send, { publicUrl }: { publicUrl?: string } = {}) {
		Object.assign(process.env, s3Env);
		if (publicUrl) {
			process.env.S3_PUBLIC_URL = publicUrl;
		}
		setS3ClientForTests({ send: s } as never);
	}

	beforeEach(() => {
		send = vi.fn();
		// page.goto's internal navigation hits the (absent) render origin via fetch.
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>")));
		// Fresh fake Chromium page per render: screenshot yields the fixed PNG.
		newPage.mockReset();
		newPage.mockResolvedValue({
			goto: vi.fn().mockResolvedValue(null),
			screenshot: vi.fn().mockResolvedValue(png),
			close: vi.fn().mockResolvedValue(undefined),
		});
	});

	afterEach(() => {
		setS3ClientForTests(null);
		for (const key of [...Object.keys(s3Env), "S3_PUBLIC_URL", "S3_PUBLIC_ENDPOINT"]) {
			delete process.env[key];
		}
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renders on a miss and stores the webp under the etag key", async () => {
		enableS3(send);
		const notFound = Object.assign(new Error("nope"), { name: "NoSuchKey" });
		send.mockRejectedValueOnce(notFound).mockResolvedValueOnce({});

		const res = await shareImageResponse(path, etag, null);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/webp");
		expect(res.headers.get("ETag")).toBe(etag);
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, must-revalidate");
		expect(send).toHaveBeenCalledTimes(2);
		expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: "bgs-assets", Key: cacheKey });
		expect(send.mock.calls[1][0].input).toMatchObject({
			Bucket: "bgs-assets",
			Key: cacheKey,
			ContentType: "image/webp",
		});
		expect(Buffer.from(send.mock.calls[1][0].input.Body).length).toBeGreaterThan(0);
	});

	it("passes a fail-fast abort signal to S3 calls (bounds crawler-facing latency)", async () => {
		enableS3(send);
		send.mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NoSuchKey" })).mockResolvedValueOnce({});

		await shareImageResponse(path, etag, null);

		// Every S3 send carries a ~3s AbortSignal.timeout so a slow store fails into
		// the render path quickly instead of tailing on a crawler request.
		for (const call of send.mock.calls) {
			const signal = call[1]?.abortSignal;
			expect(signal).toBeInstanceOf(AbortSignal);
			expect(signal.aborted).toBe(false);
		}
	});

	it("serves the stored object on a hit without rendering (private bucket: proxy bytes)", async () => {
		enableS3(send);
		const stored = Buffer.from("cached-webp");
		send.mockResolvedValueOnce({
			Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(stored)) },
		});

		const res = await shareImageResponse(path, etag, null);

		expect(res.status).toBe(200);
		expect(Buffer.from(await res.arrayBuffer()).equals(stored)).toBe(true);
		expect(res.headers.get("ETag")).toBe(etag);
		// Exactly one S3 call (the GetObject) — no render, no PutObject.
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("redirects to the public object URL on a hit when S3_PUBLIC_URL is set", async () => {
		enableS3(send, { publicUrl: "https://s3.fr-par.scw.cloud/" });
		// HeadObject success — the object exists.
		send.mockResolvedValueOnce({});

		const res = await shareImageResponse(path, etag, null);

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(`https://s3.fr-par.scw.cloud/bgs-assets/${cacheKey}`);
		expect(res.headers.get("ETag")).toBe(etag);
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, must-revalidate");
		expect(await res.text()).toBe("");
		// Exactly one S3 call: a HeadObject, NOT a GetObject — no bytes are proxied.
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0].constructor.name).toBe("HeadObjectCommand");
		expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: "bgs-assets", Key: cacheKey });
	});

	it("renders + stores + serves bytes on a miss even when S3_PUBLIC_URL is set (no redirect on the cold path)", async () => {
		enableS3(send, { publicUrl: "https://s3.fr-par.scw.cloud" });
		send.mockRejectedValueOnce(Object.assign(new Error("nope"), { name: "NotFound" })).mockResolvedValueOnce({});

		const res = await shareImageResponse(path, etag, null);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/webp");
		// HeadObject (miss) + PutObject — the freshly rendered bytes are served directly.
		expect(send).toHaveBeenCalledTimes(2);
		expect(send.mock.calls[0][0].constructor.name).toBe("HeadObjectCommand");
		expect(send.mock.calls[1][0].constructor.name).toBe("PutObjectCommand");
	});

	it("falls back to rendering when the HeadObject check fails (public mode never 500s on S3 errors)", async () => {
		enableS3(send, { publicUrl: "https://s3.fr-par.scw.cloud" });
		send.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const res = await shareImageResponse(path, etag, null);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/webp");
		expect(warn).toHaveBeenCalledOnce();
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("falls back to rendering when S3 read fails", async () => {
		enableS3(send);
		send.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const res = await shareImageResponse(path, etag, null);

		expect(res.status).toBe(200);
		expect(warn).toHaveBeenCalledOnce();
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("304s on If-None-Match without touching S3 or rendering", async () => {
		enableS3(send);

		const res = await shareImageResponse(path, etag, etag);

		expect(res.status).toBe(304);
		expect(send).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("renders without any S3 call when S3 is not configured", async () => {
		const res = await shareImageResponse(path, etag, null);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/webp");
		expect(res.headers.get("ETag")).toBe(etag);
		expect(send).not.toHaveBeenCalled();
	});
});
