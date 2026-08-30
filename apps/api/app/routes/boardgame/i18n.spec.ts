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

const optionLike = z.object({
	name: z.string(),
	label: z.string(),
	items: z
		.array(z.object({ name: z.string(), label: z.string() }))
		.nullable()
		.optional(),
});

const optionInfo = z.object({
	_id: z.object({ game: z.string(), version: z.number() }),
	options: z.array(optionLike).optional(),
	settings: z.array(optionLike).optional(),
	preferences: z.array(optionLike).optional(),
	expansions: z.array(z.object({ name: z.string(), label: z.string() })).optional(),
});

describe("Boardgame API — localized option/setting/preference/expansion labels (#306 follow-up)", () => {
	before(async () => {
		await colls.gameInfos.insertOne({
			_id: { game: "opt-game", version: 1 },
			viewer: { url: "//test.com/opt-game" },
			public: true,
			options: [
				{
					name: "map",
					label: "Map layout",
					type: "select",
					items: [
						{ name: "random", label: "Random" },
						{ name: "fixed", label: "Fixed" },
					],
				},
				{ name: "fast", label: "Fast mode", type: "checkbox" },
			],
			settings: [{ name: "autoplay", label: "Auto-play", type: "checkbox" }],
			preferences: [{ name: "sound", label: "Sound effects", type: "checkbox" }],
			expansions: [{ name: "cities", label: "The Cities" }],
		});
		await colls.gameMetadatas.insertOne({
			_id: "opt-game",
			label: "Opt Game",
			players: [2],
			description: "EN desc",
			// Name-keyed, game-level overlay: survives version-doc replacement.
			// "options.fast" is deliberately absent → per-string English fallback.
			optionTranslations: {
				fr: {
					"options.map": { label: "Disposition de la carte", translatedFrom: { hash: "0" } },
					"options.map.items.random": { label: "Aléatoire", translatedFrom: { hash: "0" } },
					"settings.autoplay": { label: "Jeu automatique", translatedFrom: { hash: "0" } },
					"preferences.sound": { label: "Effets sonores", translatedFrom: { hash: "0" } },
					"expansions.cities": { label: "Les Cités", translatedFrom: { hash: "0" } },
				},
			},
		});
	});

	after(() => db().dropDatabase());

	it("serves English labels without a language hint, and never leaks the overlay", async () => {
		const res = await api("/api/boardgame/opt-game/info");
		assert.strictEqual(res.status, 200);
		const info = optionInfo.parse(res.data);
		assert.strictEqual(info.options?.[0].label, "Map layout");
		assert.strictEqual(info.expansions?.[0].label, "The Cities");
		assert.strictEqual("optionTranslations" in res.data, false);
	});

	it("serves translated labels for the request language, with per-string English fallback", async () => {
		const res = await api("/api/boardgame/opt-game/info", { Cookie: "lang=fr" });
		assert.strictEqual(res.status, 200);
		const info = optionInfo.parse(res.data);
		assert.strictEqual(info.options?.[0].label, "Disposition de la carte");
		assert.strictEqual(info.options?.[0].items?.[0].label, "Aléatoire");
		assert.strictEqual(info.options?.[0].items?.[1].label, "Fixed", "untranslated item falls back to English");
		assert.strictEqual(info.options?.[1].label, "Fast mode", "untranslated option falls back to English");
		assert.strictEqual(info.settings?.[0].label, "Jeu automatique");
		assert.strictEqual(info.preferences?.[0].label, "Effets sonores");
		assert.strictEqual(info.expansions?.[0].label, "Les Cités");
		assert.strictEqual("optionTranslations" in res.data, false);
	});

	it("localizes the catalog list and the version-specific route too", async () => {
		const listed = z
			.array(optionInfo)
			.parse((await api("/api/boardgame/info", { Cookie: "lang=fr" })).data)
			.find((i) => i._id.game === "opt-game");
		assert.strictEqual(listed?.options?.[0].label, "Disposition de la carte");

		const versioned = optionInfo.parse((await api("/api/boardgame/opt-game/info/1", { Cookie: "lang=fr" })).data);
		assert.strictEqual(versioned.settings?.[0].label, "Jeu automatique");
	});

	it("survives an engine-version upload: renamed options fall back, stable names stay translated", async () => {
		// A new version replaces the version doc wholesale (as engine uploads
		// do): "map" was renamed to "board", "autoplay" survives.
		await colls.gameInfos.insertOne({
			_id: { game: "opt-game", version: 2 },
			viewer: { url: "//test.com/opt-game-v2" },
			public: true,
			options: [{ name: "board", label: "Board layout", type: "select" }],
			settings: [{ name: "autoplay", label: "Auto-play", type: "checkbox" }],
		});

		const res = await api("/api/boardgame/opt-game/info", { Cookie: "lang=fr" });
		const info = optionInfo.parse(res.data);
		assert.strictEqual(info._id.version, 2);
		assert.strictEqual(info.options?.[0].label, "Board layout", "renamed option has no overlay entry → English");
		assert.strictEqual(info.settings?.[0].label, "Jeu automatique", "name-keyed overlay survives the upload");

		// The old version keeps its translations where names match.
		const v1 = optionInfo.parse((await api("/api/boardgame/opt-game/info/1", { Cookie: "lang=fr" })).data);
		assert.strictEqual(v1.options?.[0].label, "Disposition de la carte");
	});
});
