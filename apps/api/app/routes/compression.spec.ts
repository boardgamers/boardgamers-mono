// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { after, describe, it } from "node:test";
import { colls, db } from "../config/db.ts";
import env from "../config/env.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

describe("Response compression (issue #127)", () => {
	after(() => db().dropDatabase());

	it("gzip-encodes a large JSON response when the client accepts gzip", async () => {
		// koa-compress only encodes bodies above its threshold (1 KiB by default) —
		// pad the fixture so the /boardgame/info payload clears it.
		await colls.gameInfos.insertOne({
			_id: { game: "compression-test", version: 1 },
			label: "Compression Test — ".repeat(100),
			viewer: { url: "//test.com/compression-test", topLevelVariable: "compressionTest" },
			players: [2],
			meta: { public: true, needOwnership: false },
		});

		// Raw undici request: fetch's automatic decompression would strip the
		// content-encoding header before we could assert on it.
		const { request } = await import("undici");
		const res = await request(`${baseURL()}/api/boardgame/info`, {
			headers: { "accept-encoding": "gzip" },
		});

		assert.strictEqual(res.statusCode, 200);
		assert.strictEqual(res.headers["content-encoding"], "gzip");
		assert.ok(!("content-length" in res.headers), "compressed responses are chunked, not length-delimited");

		const compressed = Buffer.concat(await res.body.toArray());
		const parsed: unknown = JSON.parse(gunzipSync(compressed).toString());
		assert.ok(Array.isArray(parsed));
		assert.ok(parsed.length >= 1);
	});

	it("leaves the response unencoded when the client does not accept gzip", async () => {
		const { request } = await import("undici");
		const res = await request(`${baseURL()}/api/boardgame/info`, {
			headers: { "accept-encoding": "identity" },
		});

		assert.strictEqual(res.statusCode, 200);
		assert.ok(!("content-encoding" in res.headers));
	});
});
