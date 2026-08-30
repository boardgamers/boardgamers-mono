import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import sharp from "sharp";
import {
	SOCIAL_AVATAR_MAX_BYTES,
	fetchSocialAvatar,
	fetchSocialAvatarBytes,
	setSocialAvatarFetchForTests,
	validSocialAvatarUrl,
} from "./socialavatar.ts";

describe("validSocialAvatarUrl — provider CDN whitelist", () => {
	it("accepts https URLs on each provider's known CDN host", () => {
		for (const [provider, url] of [
			["discord", "https://cdn.discordapp.com/avatars/123/abc.png?size=256"],
			["google", "https://lh3.googleusercontent.com/a/token=s96-c"],
			["github", "https://avatars.githubusercontent.com/u/123?v=4"],
			["github", "https://avatars0.githubusercontent.com/u/123"],
			["huggingface", "https://cdn-avatars.huggingface.co/v1/production/uploads/x.jpeg"],
			["huggingface", "https://huggingface.co/avatars/abc.svg"],
		] as const) {
			assert.strictEqual(validSocialAvatarUrl(provider, url), url, `${provider} should accept ${url}`);
		}
	});

	it("rejects non-https schemes", () => {
		assert.strictEqual(validSocialAvatarUrl("discord", "http://cdn.discordapp.com/avatars/1/a.png"), undefined);
		// oxlint-disable-next-line no-script-url -- that's the point
		assert.strictEqual(validSocialAvatarUrl("discord", "javascript:alert(1)"), undefined);
	});

	it("rejects hosts off the provider's whitelist — including other providers' CDNs and lookalikes", () => {
		for (const url of [
			"https://evil.example/avatar.png",
			"https://avatars.githubusercontent.com/u/1", // right host, wrong provider
			"https://cdn.discordapp.com.evil.example/a.png", // suffix lookalike
			"https://xcdn.discordapp.com/a.png", // prefix lookalike
			"https://169.254.169.254/latest/meta-data", // cloud metadata endpoint
		]) {
			assert.strictEqual(validSocialAvatarUrl("discord", url), undefined, `should reject ${url}`);
		}
	});

	it("rejects explicit ports and URL credentials", () => {
		assert.strictEqual(validSocialAvatarUrl("discord", "https://cdn.discordapp.com:8443/a.png"), undefined);
		assert.strictEqual(validSocialAvatarUrl("discord", "https://user:pass@cdn.discordapp.com/a.png"), undefined);
	});

	it("never accepts anything for facebook (phased out, #99) or garbage input", () => {
		assert.strictEqual(validSocialAvatarUrl("facebook", "https://platform-lookaside.fbsbx.com/x"), undefined);
		assert.strictEqual(validSocialAvatarUrl("discord", "not a url"), undefined);
		assert.strictEqual(validSocialAvatarUrl("discord", undefined), undefined);
	});
});

describe("fetchSocialAvatar — whitelist enforced before any network access", () => {
	it("refuses a stored URL that is no longer whitelist-clean, without fetching", async () => {
		let fetched = 0;
		setSocialAvatarFetchForTests(async () => {
			fetched++;
			return Buffer.alloc(0);
		});
		try {
			await assert.rejects(
				fetchSocialAvatar("discord", "https://evil.example/avatar.png"),
				/not on discord's known CDN/,
			);
			assert.strictEqual(fetched, 0, "must not fetch a non-whitelisted URL");
		} finally {
			setSocialAvatarFetchForTests(null);
		}
	});
});

describe("fetchSocialAvatarBytes — transport guards (local server; loopback allowed outside production)", () => {
	let baseUrl = "";
	let png: Buffer;
	const server = createServer(async (req, res) => {
		switch (req.url) {
			case "/ok.png":
				res.writeHead(200, { "content-type": "image/png" });
				res.end(png);
				return;
			case "/huge.png": {
				res.writeHead(200, { "content-type": "image/png" });
				res.end(Buffer.alloc(SOCIAL_AVATAR_MAX_BYTES + 1));
				return;
			}
			case "/page.html":
				res.writeHead(200, { "content-type": "text/html" });
				res.end("<html>not an image</html>");
				return;
			case "/redirect":
				res.writeHead(302, { location: `${baseUrl}/ok.png` });
				res.end();
				return;
			default:
				res.writeHead(404);
				res.end();
		}
	});

	before(async () => {
		png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3366cc" } })
			.png()
			.toBuffer();
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		assert.ok(address && typeof address === "object", "server must be bound to a port");
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	after(() => new Promise((resolve) => server.close(resolve)));

	it("returns the bytes of a healthy image response", async () => {
		const body = await fetchSocialAvatarBytes(`${baseUrl}/ok.png`);
		assert.deepStrictEqual(body, png);
	});

	it("rejects a response over the size cap", async () => {
		await assert.rejects(fetchSocialAvatarBytes(`${baseUrl}/huge.png`), /body too large/);
	});

	it("rejects a non-image content-type", async () => {
		await assert.rejects(fetchSocialAvatarBytes(`${baseUrl}/page.html`), /non-image content-type/);
	});

	it("does not follow redirects (a 302 is a failure, not a hop)", async () => {
		await assert.rejects(fetchSocialAvatarBytes(`${baseUrl}/redirect`), /avatar fetch failed \(302\)/);
	});

	it("rejects a non-200 status", async () => {
		await assert.rejects(fetchSocialAvatarBytes(`${baseUrl}/missing.png`), /avatar fetch failed \(404\)/);
	});
});
