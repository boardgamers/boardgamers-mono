import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { interceptS3Fetches, makeS3Mock, seedS3Avatars } from "../../services/s3-mock.ts";
import { clearAvatarPublicProbeCache, s3Fetch, setS3ClientsForTests } from "../../services/s3.ts";
import { migration as avatarsToS3Migration } from "../../models/migrations/1.5.0-avatars-to-s3.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

// Pre-webp avatars are stored as JPEG/PNG with their mime — they must keep serving as-is.
const rawPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const rawJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const rawWebp = Buffer.from([...Buffer.from("RIFF", "ascii"), 0x00, 0x00, 0x00, 0x00, ...Buffer.from("WEBP", "ascii")]);

describe("User API — avatar", () => {
	const dicebearUserId = new ObjectId();
	let dicebearUsername = "";
	const uploadUserId = new ObjectId();
	let uploadUsername = "";
	const jpegUserId = new ObjectId();
	const webpUserId = new ObjectId();
	const hashedUserId = new ObjectId();
	// The sha256 the upload route would compute for rawWebp (16 hex chars).
	const webpHash = createHash("sha256").update(rawWebp).digest("hex").slice(0, 16);

	before(async () => {
		const dicebearUser = testUser({ _id: dicebearUserId, account: { avatar: "bottts" } });
		dicebearUsername = dicebearUser.account.username;
		await colls.users.insertOne(dicebearUser);

		const uploadUser = testUser({ _id: uploadUserId, account: { avatar: "upload" } });
		uploadUsername = uploadUser.account.username;
		await colls.users.insertOne(uploadUser);

		await colls.users.insertOne(testUser({ _id: jpegUserId, account: { avatar: "upload" } }));
		await colls.users.insertOne(testUser({ _id: webpUserId, account: { avatar: "upload" } }));
		await colls.users.insertOne(testUser({ _id: hashedUserId, account: { avatar: "upload" } }));

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
		// Avatar with the hash stored at upload time (the new-field path).
		await colls.images.insertOne({
			ref: hashedUserId,
			refType: "User",
			key: "avatar",
			formats: ["64x64"],
			images: { "64x64": { mime: "image/webp", raw: rawWebp, size: rawWebp.length, hash: webpHash } },
		});
	});

	it("returns a valid self-hosted SVG for a dicebear avatar", async () => {
		const res = await fetch(`${baseURL()}/api/user/${dicebearUserId.toHexString()}/avatar?size=64`);
		const body = await res.text();

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get("content-type"), "image/svg+xml");
		assert.ok(body.startsWith("<svg"), `expected an SVG body, got: ${body.slice(0, 80)}`);
		assert.ok(body.includes("</svg>"), "expected well-formed SVG markup");
		assert.ok(body.includes('width="64"'), "expected the requested size");
	});

	it("revalidates via ETag — 304 if unchanged, fresh SVG when the style changes", async () => {
		const url = `${baseURL()}/api/user/${dicebearUserId.toHexString()}/avatar`;

		const first = await fetch(url);
		assert.strictEqual(first.headers.get("cache-control"), "no-cache");
		const etag = first.headers.get("etag");
		assert.ok(etag, "expected an ETag");

		// Same content → 304, no body re-download
		const revalidate = await fetch(url, { headers: { "if-none-match": etag } });
		assert.strictEqual(revalidate.status, 304);

		// Style change → new content hash → new ETag (so the browser picks it up)
		await colls.users.updateOne({ _id: dicebearUserId }, { $set: { "account.avatar": "micah" } });
		const changed = await fetch(url, { headers: { "if-none-match": etag } });
		assert.strictEqual(changed.status, 200);
		assert.strictEqual(changed.headers.get("content-type"), "image/svg+xml");
		assert.notStrictEqual(changed.headers.get("etag"), etag);

		await colls.users.updateOne({ _id: dicebearUserId }, { $set: { "account.avatar": "bottts" } });
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
		const url = `${baseURL()}/api/user/byName/${encodeURIComponent(uploadUsername)}/avatar?size=64`;
		const res = await fetch(url);
		const body = Buffer.from(await res.arrayBuffer());

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get("content-type"), "image/png");
		assert.deepStrictEqual(body, rawPng);

		// Uploaded-by-name also revalidates via ETag (was missing before).
		const etag = res.headers.get("etag");
		assert.ok(etag, "expected an ETag");
		const revalidate = await fetch(url, { headers: { "if-none-match": etag } });
		assert.strictEqual(revalidate.status, 304);
	});

	it("uses the upload-time stored hash as the ETag (no re-hash per request)", async () => {
		const url = `${baseURL()}/api/user/${hashedUserId.toHexString()}/avatar?size=64`;
		const res = await fetch(url);

		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get("content-type"), "image/webp");
		assert.strictEqual(res.headers.get("etag"), `"${webpHash}"`);

		// Avatars without a stored hash (uploaded before the field existed) fall back
		// to computing it from the body — same value, just computed per request.
		const legacy = await fetch(`${baseURL()}/api/user/${webpUserId.toHexString()}/avatar?size=64`);
		assert.strictEqual(legacy.headers.get("etag"), `"${webpHash}"`);
	});

	it("404s for an unknown user", async () => {
		const res = await fetch(`${baseURL()}/api/user/${new ObjectId().toHexString()}/avatar`);
		assert.strictEqual(res.status, 404);

		const byName = await fetch(`${baseURL()}/api/user/byName/no-such-user/avatar`);
		assert.strictEqual(byName.status, 404);
	});

	after(() => db().dropDatabase());
});

describe("User API — avatar served from S3", () => {
	const s3Mock = makeS3Mock();
	// Lets s3Fetch() (and only it) resolve the mock's public object URLs.
	const restoreFetchInterceptor = interceptS3Fetches(s3Mock);
	const webpHash = createHash("sha256").update(rawWebp).digest("hex").slice(0, 16);
	const webpEtag = `"${webpHash}"`;

	const migratedUserId = new ObjectId();
	const unmigratedUserId = new ObjectId();
	const byNameUserId = new ObjectId();
	let byNameUsername = "";

	before(async () => {
		setS3ClientsForTests(s3Mock.client);
		s3Mock.reset();
		clearAvatarPublicProbeCache();

		const migratedUser = testUser({ _id: migratedUserId, account: { avatar: "upload" } });
		await colls.users.insertOne(migratedUser);
		await colls.users.insertOne(testUser({ _id: unmigratedUserId, account: { avatar: "upload" } }));
		const byNameUser = testUser({ _id: byNameUserId, account: { avatar: "upload" } });
		byNameUsername = byNameUser.account.username;
		await colls.users.insertOne(byNameUser);

		const images = {
			"64x64": { mime: "image/webp", raw: rawWebp, size: rawWebp.length, hash: webpHash },
			"128x128": { mime: "image/webp", raw: rawWebp, size: rawWebp.length, hash: webpHash },
			"256x256": { mime: "image/webp", raw: rawWebp, size: rawWebp.length, hash: webpHash },
		};
		await colls.images.insertOne({
			ref: migratedUserId,
			refType: "User",
			key: "avatar",
			formats: Object.keys(images),
			images,
			s3: true,
		});
		await colls.images.insertOne({
			ref: unmigratedUserId,
			refType: "User",
			key: "avatar",
			formats: Object.keys(images),
			images,
		});
		await colls.images.insertOne({
			ref: byNameUserId,
			refType: "User",
			key: "avatar",
			formats: Object.keys(images),
			images,
			s3: true,
		});

		// Migrated fixtures: the matching objects must exist in S3 for the
		// redirect target to serve bytes (the api never uploads on a GET).
		seedS3Avatars(s3Mock, [
			{ userId: migratedUserId.toHexString(), sizes: Object.keys(images), body: rawWebp },
			{ userId: byNameUserId.toHexString(), sizes: Object.keys(images), body: rawWebp },
		]);
	});

	after(async () => {
		setS3ClientsForTests(null);
		clearAvatarPublicProbeCache();
		restoreFetchInterceptor();
		await db().dropDatabase();
	});

	const getNoFollow = (path: string, headers?: Record<string, string>) =>
		fetch(`${baseURL()}${path}`, { redirect: "manual", headers });

	it("redirects a migrated avatar to the public S3 object URL, ETag preserved", async () => {
		const res = await getNoFollow(`/api/user/${migratedUserId.toHexString()}/avatar?size=64`);

		assert.strictEqual(res.status, 302);
		const location = res.headers.get("location");
		assert.ok(location, "expected a Location header");
		const url = new URL(location);
		assert.strictEqual(url.hostname, s3Mock.endpointHost);
		assert.strictEqual(url.pathname, `/${s3Mock.bucketName}/avatars/${migratedUserId.toHexString()}/64x64.webp`);
		// Public-read objects: plain URL, no signing params.
		assert.strictEqual(url.search, "");
		assert.strictEqual(res.headers.get("etag"), webpEtag);
		assert.strictEqual(res.headers.get("cache-control"), "no-cache");
	});

	it("a browser following the redirect gets the S3 bytes", async () => {
		const redirect = await getNoFollow(`/api/user/${migratedUserId.toHexString()}/avatar?size=128`);
		assert.strictEqual(redirect.status, 302);
		const fetched = await s3Fetch(redirect.headers.get("location")!);
		assert.strictEqual(fetched.status, 200);
		assert.strictEqual(fetched.headers.get("content-type"), "image/webp");
		assert.deepStrictEqual(Buffer.from(await fetched.arrayBuffer()), rawWebp);
	});

	it("304s on If-None-Match without a Location (no S3 involved)", async () => {
		const res = await getNoFollow(`/api/user/${migratedUserId.toHexString()}/avatar?size=64`, {
			"if-none-match": webpEtag,
		});
		assert.strictEqual(res.status, 304);
		assert.strictEqual(res.headers.get("location"), null);
		assert.strictEqual(res.headers.get("etag"), webpEtag);
	});

	it("serves a not-yet-migrated avatar from mongo even with S3 enabled", async () => {
		const res = await getNoFollow(`/api/user/${unmigratedUserId.toHexString()}/avatar?size=64`);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.headers.get("location"), null);
		assert.strictEqual(res.headers.get("content-type"), "image/webp");
		assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), rawWebp);
	});

	it("byName route redirects to S3 the same way", async () => {
		const res = await getNoFollow(`/api/user/byName/${encodeURIComponent(byNameUsername)}/avatar?size=64`);
		assert.strictEqual(res.status, 302);
		assert.ok(res.headers.get("location")?.includes(`/avatars/${byNameUserId.toHexString()}/64x64.webp`));
		assert.strictEqual(res.headers.get("etag"), webpEtag);

		const revalidate = await getNoFollow(`/api/user/byName/${encodeURIComponent(byNameUsername)}/avatar?size=64`, {
			"if-none-match": webpEtag,
		});
		assert.strictEqual(revalidate.status, 304);
	});

	it("serves from mongo while the object is NOT publicly reachable (private bucket / S3 down)", async () => {
		// Until the operator makes the bucket public (#218) — or while S3 is
		// erroring — the HEAD probe fails and the api keeps serving the blob.
		for (const state of ["private", "down"] as const) {
			clearAvatarPublicProbeCache();
			s3Mock.publiclyReadable = state !== "private";
			s3Mock.failing = state === "down";
			try {
				const res = await getNoFollow(`/api/user/${migratedUserId.toHexString()}/avatar?size=64`);
				assert.strictEqual(res.status, 200, `expected mongo serve with S3 ${state}`);
				assert.strictEqual(res.headers.get("location"), null);
				assert.strictEqual(res.headers.get("content-type"), "image/webp");
				assert.strictEqual(res.headers.get("etag"), webpEtag);
				assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), rawWebp);

				// Revalidation stays cheap and correct in that state.
				const revalidate = await getNoFollow(`/api/user/${migratedUserId.toHexString()}/avatar?size=64`, {
					"if-none-match": webpEtag,
				});
				assert.strictEqual(revalidate.status, 304);
			} finally {
				s3Mock.failing = false;
				s3Mock.publiclyReadable = true;
			}
		}

		// Once the probe passes again (bucket public), the same request 302s.
		clearAvatarPublicProbeCache();
		const res = await getNoFollow(`/api/user/${migratedUserId.toHexString()}/avatar?size=64`);
		assert.strictEqual(res.status, 302);
	});

	it("serves migrated avatars from mongo once S3 is disabled", async () => {
		setS3ClientsForTests(null);
		try {
			const res = await getNoFollow(`/api/user/${migratedUserId.toHexString()}/avatar?size=64`);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.headers.get("location"), null);
			assert.deepStrictEqual(Buffer.from(await res.arrayBuffer()), rawWebp);
		} finally {
			setS3ClientsForTests(s3Mock.client);
		}
	});

	it("metadata-only doc + S3 disabled (PR preview) → DiceBear fallback, no 500", async () => {
		// Shape of post-#224 uploads in a preview dump: s3:true, hash/size/mime,
		// no `raw` blob. Previews have no S3 → the generated avatar stands in.
		const metaOnlyUserId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: metaOnlyUserId, account: { avatar: "upload" } }));
		await colls.images.insertOne({
			ref: metaOnlyUserId,
			refType: "User",
			key: "avatar",
			formats: ["64x64"],
			images: { "64x64": { mime: "image/webp", size: rawWebp.length, hash: webpHash } },
			s3: true,
		});

		setS3ClientsForTests(null);
		try {
			const res = await getNoFollow(`/api/user/${metaOnlyUserId.toHexString()}/avatar?size=64`);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.headers.get("location"), null);
			assert.strictEqual(res.headers.get("content-type"), "image/svg+xml");
			const body = await res.text();
			assert.ok(body.startsWith("<svg"), `expected a DiceBear SVG fallback, got: ${body.slice(0, 80)}`);
			assert.ok(body.includes('width="64"'), "expected the requested size");
		} finally {
			setS3ClientsForTests(s3Mock.client);
		}

		// With S3 enabled AND the object publicly reachable, the same doc 302s as
		// usual (hash etag preserved).
		seedS3Avatars(s3Mock, [{ userId: metaOnlyUserId.toHexString(), sizes: ["64x64"], body: rawWebp }]);
		clearAvatarPublicProbeCache();
		const res = await getNoFollow(`/api/user/${metaOnlyUserId.toHexString()}/avatar?size=64`);
		assert.strictEqual(res.status, 302);
		assert.ok(res.headers.get("location")?.includes(`/avatars/${metaOnlyUserId.toHexString()}/64x64.webp`));
		assert.strictEqual(res.headers.get("etag"), webpEtag);
	});
});

describe("avatars-to-s3 migration", () => {
	const s3Mock = makeS3Mock();
	const pendingUserId = new ObjectId();
	const doneUserId = new ObjectId();
	const rawWebp2 = Buffer.from([...rawWebp, 0x01]);

	before(async () => {
		setS3ClientsForTests(s3Mock.client);
		s3Mock.reset();
		await colls.images.insertOne({
			ref: pendingUserId,
			refType: "User",
			key: "avatar",
			formats: ["64x64"],
			images: { "64x64": { mime: "image/webp", raw: rawWebp, size: rawWebp.length } },
		});
		// Already migrated — must be skipped.
		await colls.images.insertOne({
			ref: doneUserId,
			refType: "User",
			key: "avatar",
			formats: ["64x64"],
			images: { "64x64": { mime: "image/webp", raw: rawWebp2, size: rawWebp2.length } },
			s3: true,
		});
	});

	after(async () => {
		setS3ClientsForTests(null);
		await db().dropDatabase();
	});

	it("uploads pending avatars to S3, flags them, keeps the mongo bytes", async () => {
		await avatarsToS3Migration.up();

		const doc = await colls.images.findOne({ ref: pendingUserId });
		assert.strictEqual(doc?.s3, true);
		assert.ok(doc?.images["64x64"]?.raw, "mongo blob must NOT be deleted");
		assert.deepStrictEqual(
			s3Mock.buckets.get(s3Mock.bucketName)?.get(`avatars/${pendingUserId.toHexString()}/64x64.webp`)?.body,
			rawWebp,
		);

		// The already-migrated doc was skipped (nothing re-uploaded for it).
		assert.strictEqual(
			s3Mock.buckets.get(s3Mock.bucketName)?.has(`avatars/${doneUserId.toHexString()}/64x64.webp`),
			false,
		);
	});

	it("is idempotent — a second run is a no-op", async () => {
		s3Mock.reset();
		await avatarsToS3Migration.up();
		assert.strictEqual(s3Mock.buckets.size, 0, "no re-upload once every doc is flagged");
		const doc = await colls.images.findOne({ ref: pendingUserId });
		assert.strictEqual(doc?.s3, true);
		assert.ok(doc?.images["64x64"]?.raw);
	});

	it("no-ops when S3 is disabled", async () => {
		setS3ClientsForTests(null);
		try {
			await colls.images.insertOne({
				ref: new ObjectId(),
				refType: "User",
				key: "avatar",
				formats: ["64x64"],
				images: { "64x64": { mime: "image/webp", raw: rawWebp, size: rawWebp.length } },
			});
			await avatarsToS3Migration.up();
			// Docs stay unmigrated (so enabling S3 later can still pick them up via a
			// manual re-run) and nothing throws.
			assert.strictEqual(await colls.images.countDocuments({ s3: { $ne: true } }), 1);
		} finally {
			setS3ClientsForTests(s3Mock.client);
		}
	});
});
