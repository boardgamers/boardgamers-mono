// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { z } from "zod";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(path: string, headers?: Record<string, string>) {
	const res = await fetch(`${baseURL()}${path}`, { headers });
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data };
}

const localizedInfo = z.object({
	_id: z.object({ game: z.string(), version: z.number() }),
	description: z.string().optional(),
	rules: z.string().optional(),
	credits: z.string().optional(),
});

describe("Boardgame API — localized game metadata (#306)", () => {
	before(async () => {
		await colls.gameInfos.insertOne({
			_id: { game: "i18n-game", version: 1 },
			viewer: { url: "//test.com/i18n-game" },
			public: true,
		});
		await colls.gameMetadatas.insertOne({
			_id: "i18n-game",
			label: "i18n-game",
			players: [2],
			description: "English desc",
			rules: "EN rules",
			credits: "EN credits",
			translations: {
				de: { description: "Deutsche Beschreibung" },
			},
		});
	});

	it("serves the English/base text without any language hint", async () => {
		const res = await api("/api/boardgame/i18n-game/info");
		assert.strictEqual(res.status, 200);
		const info = localizedInfo.parse(res.data);
		assert.strictEqual(info.description, "English desc");
		assert.strictEqual(info.rules, "EN rules");
		// The translations map is storage, not response shape.
		assert.strictEqual("translations" in res.data, false);
	});

	it("serves the German translation on Accept-Language, with per-field en fallback", async () => {
		const res = await api("/api/boardgame/i18n-game/info", { "Accept-Language": "de-AT,de;q=0.9" });
		assert.strictEqual(res.status, 200);
		const info = localizedInfo.parse(res.data);
		assert.strictEqual(info.description, "Deutsche Beschreibung");
		assert.strictEqual(info.rules, "EN rules", "rules has no de translation — falls back to the base text");
		assert.strictEqual(info.credits, "EN credits");
	});

	it("serves the German translation on a lang cookie", async () => {
		const res = await api("/api/boardgame/i18n-game/info", { Cookie: "lang=de" });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(localizedInfo.parse(res.data).description, "Deutsche Beschreibung");
	});

	it("extracts the base subtag of a regional lang cookie", async () => {
		const res = await api("/api/boardgame/i18n-game/info", { Cookie: "lang=de-AT" });
		assert.strictEqual(localizedInfo.parse(res.data).description, "Deutsche Beschreibung");
	});

	it("prefers the lang cookie over Accept-Language", async () => {
		const res = await api("/api/boardgame/i18n-game/info", { Cookie: "lang=de", "Accept-Language": "fr" });
		assert.strictEqual(localizedInfo.parse(res.data).description, "Deutsche Beschreibung");
	});

	it("ignores a junk lang cookie without erroring", async () => {
		const res = await api("/api/boardgame/i18n-game/info", { Cookie: "lang=<script>alert(1)</script>" });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(localizedInfo.parse(res.data).description, "English desc");
	});

	it("serves the base text for a language without translations", async () => {
		const res = await api("/api/boardgame/i18n-game/info", { "Accept-Language": "fr" });
		assert.strictEqual(localizedInfo.parse(res.data).description, "English desc");
	});

	it("localizes the single-game endpoint too", async () => {
		const res = await api("/api/boardgame/i18n-game", { "Accept-Language": "de" });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(localizedInfo.parse(res.data).description, "Deutsche Beschreibung");
	});

	it("localizes the catalog list route", async () => {
		const anonymous = z
			.array(localizedInfo)
			.parse((await api("/api/boardgame/info")).data)
			.find((i) => i._id.game === "i18n-game");
		assert.strictEqual(anonymous?.description, "English desc");

		const german = z
			.array(localizedInfo)
			.parse((await api("/api/boardgame/info", { "Accept-Language": "de" })).data)
			.find((i) => i._id.game === "i18n-game");
		assert.strictEqual(german?.description, "Deutsche Beschreibung");
		assert.strictEqual(german?.rules, "EN rules");
	});

	it("localizes the version-specific info route", async () => {
		const res = await api("/api/boardgame/i18n-game/info/1", { Cookie: "lang=de" });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(localizedInfo.parse(res.data).description, "Deutsche Beschreibung");
	});

	after(() => db().dropDatabase());
});
