import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

describe("User API — avatar", () => {
	const dicebearUserId = new ObjectId();
	let dicebearUsername = "";
	const uploadUserId = new ObjectId();
	let uploadUsername = "";
	const jpegUserId = new ObjectId();
	const webpUserId = new ObjectId();
	// Pre-webp avatars are stored as JPEG/PNG with their mime — they must keep serving as-is.
	const rawPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const rawJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
	const rawWebp = Buffer.from([
		...Buffer.from("RIFF", "ascii"),
		0x00,
		0x00,
		0x00,
		0x00,
		...Buffer.from("WEBP", "ascii"),
	]);

	before(async () => {
		const dicebearUser = testUser({ _id: dicebearUserId, account: { avatar: "bottts" } });
		dicebearUsername = dicebearUser.account.username;
		await colls.users.insertOne(dicebearUser);

		const uploadUser = testUser({ _id: uploadUserId, account: { avatar: "upload" } });
		uploadUsername = uploadUser.account.username;
		await colls.users.insertOne(uploadUser);

		await colls.users.insertOne(testUser({ _id: jpegUserId, account: { avatar: "upload" } }));
		await colls.users.insertOne(testUser({ _id: webpUserId, account: { avatar: "upload" } }));

		await colls.images.insertOne({
			ref: uploadUserId,
			refType: "User",
			key: "avatar",
			formats: ["64x64"],
			images: { "64x64": { mime: "image/png", raw: rawPng, size: rawPng.length } },
		});
		await colls.images.insertOne({
			ref: jpegUserId,
			refType: "User",
			key: "avatar",
			formats: ["256x256", "128x128", "64x64"],
			images: {
				"256x256": { mime: "image/jpeg", raw: rawJpeg, size: rawJpeg.length },
				"128x128": { mime: "image/jpeg", raw: rawJpeg, size: rawJpeg.length },
				"64x64": { mime: "image/jpeg", raw: rawJpeg, size: rawJpeg.length },
			},
		});
		await colls.images.insertOne({
			ref: webpUserId,
			refType: "User",
			key: "avatar",
			formats: ["256x256", "128x128", "64x64"],
			images: {
				"256x256": { mime: "image/webp", raw: rawWebp, size: rawWebp.length },
				"128x128": { mime: "image/webp", raw: rawWebp, size: rawWebp.length },
				"64x64": { mime: "image/webp", raw: rawWebp, size: rawWebp.length },
			},
		});
	});

	it("returns a valid self-hosted SVG for a dicebear avatar", async () => {
		const res = await fetch(`${baseURL()}/api/user/${dicebearUserId.toHexString()}/avatar?size=64`);
		const body = await res.text();

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get("content-type"), "image/svg+xml");
		assert.ok(res.headers.get("cache-control")?.includes("max-age"), "expected cache headers");
		assert.ok(body.startsWith("<svg"), `expected an SVG body, got: ${body.slice(0, 80)}`);
		assert.ok(body.includes("</svg>"), "expected well-formed SVG markup");
		assert.ok(body.includes('width="64"'), "expected the requested size");
	});

	it("is deterministic per username + style", async () => {
		const url = `${baseURL()}/api/user/${dicebearUserId.toHexString()}/avatar`;
		const [a, b] = await Promise.all([fetch(url).then((r) => r.text()), fetch(url).then((r) => r.text())]);
		assert.strictEqual(a, b);

		// A different username (same style) produces a different avatar
		const byName = await fetch(
			`${baseURL()}/api/user/byName/${encodeURIComponent(uploadUsername)}/avatar?style=bottts`,
		);
		assert.strictEqual(byName.status, 200);
		assert.notStrictEqual(await byName.text(), a);
	});

	it("falls back to a valid SVG for unknown or removed style names", async () => {
		// "gridy" existed in DiceBear v4 but was removed in v9
		for (const style of ["gridy", "not-a-style", "../../etc/passwd"]) {
			const res = await fetch(
				`${baseURL()}/api/user/byName/${encodeURIComponent(dicebearUsername)}/avatar?style=${encodeURIComponent(style)}`,
			);
			const body = await res.text();

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.headers.get("content-type"), "image/svg+xml");
			assert.ok(body.startsWith("<svg"), `expected an SVG body for style ${style}, got: ${body.slice(0, 80)}`);
		}
	});

	it("serves an avatar by username without a style override", async () => {
		const res = await fetch(`${baseURL()}/api/user/byName/${encodeURIComponent(dicebearUsername)}/avatar`);
		const body = await res.text();

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get("content-type"), "image/svg+xml");
		assert.ok(body.startsWith("<svg"));

		const byId = await fetch(`${baseURL()}/api/user/${dicebearUserId.toHexString()}/avatar`);
		assert.strictEqual(body, await byId.text());
	});

	it("returns the stored bytes for an uploaded avatar", async () => {
		const res = await fetch(`${baseURL()}/api/user/${uploadUserId.toHexString()}/avatar?size=64`);
		const body = Buffer.from(await res.arrayBuffer());

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get("content-type"), "image/png");
		assert.deepStrictEqual(body, rawPng);
	});

	it("serves a webp avatar with the image/webp content type", async () => {
		for (const size of [256, 128, 64]) {
			const res = await fetch(`${baseURL()}/api/user/${webpUserId.toHexString()}/avatar?size=${size}`);
			const body = Buffer.from(await res.arrayBuffer());

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.headers.get("content-type"), "image/webp");
			assert.deepStrictEqual(body, rawWebp);
		}
	});

	it("serves a legacy JPEG-stored avatar as image/jpeg (no migration needed)", async () => {
		for (const size of [64, 128, 256]) {
			const res = await fetch(`${baseURL()}/api/user/${jpegUserId.toHexString()}/avatar?size=${size}`);
			const body = Buffer.from(await res.arrayBuffer());

			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.headers.get("content-type"), "image/jpeg");
			assert.deepStrictEqual(body, rawJpeg);
		}
	});

	it("returns the stored bytes for an uploaded avatar by username", async () => {
		const res = await fetch(`${baseURL()}/api/user/byName/${encodeURIComponent(uploadUsername)}/avatar?size=64`);
		const body = Buffer.from(await res.arrayBuffer());

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get("content-type"), "image/png");
		assert.deepStrictEqual(body, rawPng);
	});

	it("404s for an unknown user", async () => {
		const res = await fetch(`${baseURL()}/api/user/${new ObjectId().toHexString()}/avatar`);
		assert.strictEqual(res.status, 404);

		const byName = await fetch(`${baseURL()}/api/user/byName/no-such-user/avatar`);
		assert.strictEqual(byName.status, 404);
	});

	after(() => db().dropDatabase());
});
