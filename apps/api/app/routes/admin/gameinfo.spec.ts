import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testGame, testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

const baseInfo = {
	label: " 💎 Splendor",
	players: [2, 3, 4],
	viewer: { url: "//example.com/viewer.js" },
	public: true,
	meta: {},
};

// The gameinfo list is one entry per GAME ({ _id: slug, label, alias }) — a game
// with N versions appears once (the per-version list broke keyed {#each} blocks
// in the admin panel). The per-version view lives on /:game/versions instead.
describe("Admin gameinfo API — game list, one entry per game", () => {
	let headers: Record<string, string>;

	before(async () => {
		headers = await makeAdminHeaders();
		await colls.gameInfos.insertMany([
			{ _id: { game: "multigame", version: 1 }, viewer: { url: "//v1" }, public: true, meta: {} },
			{ _id: { game: "multigame", version: 2 }, viewer: { url: "//v2" }, public: true, meta: {} },
			{ _id: { game: "multigame", version: 3 }, viewer: { url: "//v3" }, public: true, meta: { archived: true } },
			{ _id: { game: "singlegame", version: 1 }, viewer: { url: "//v1" }, public: true, meta: {} },
		]);
		await colls.gameMetadatas.insertMany([
			{ _id: "multigame", label: "Multi Game", alias: "MG", players: [2] },
			{ _id: "singlegame", label: "Single Game", players: [2] },
			{ _id: "requestedgame", label: "Requested Game", players: [], status: "requested" },
		]);
	});

	after(() => db().dropDatabase());

	it("lists one entry per game, whatever its version count", async () => {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo`, { headers });
		assert.strictEqual(res.status, 200);
		const list = z
			.array(z.object({ _id: z.string(), label: z.string(), alias: z.string().optional() }))
			.parse(await res.json());
		assert.deepStrictEqual(
			list.filter((g) => g._id === "multigame"),
			[{ _id: "multigame", label: "Multi Game", alias: "MG" }],
		);
		assert.deepStrictEqual(
			list.filter((g) => g._id === "singlegame"),
			[{ _id: "singlegame", label: "Single Game" }],
		);
		// Whole-game requests (#340) show on the requests page, not the game list.
		assert.ok(!list.some((g) => g._id === "requestedgame"));
	});

	it("GET /:game/versions returns that game's versions, latest first, with archived flags", async () => {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/multigame/versions`, { headers });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(await res.json(), [
			{ version: 3, archived: true },
			{ version: 2, archived: false },
			{ version: 1, archived: false },
		]);

		const single = await fetch(`${baseURL()}/api/admin/gameinfo/singlegame/versions`, { headers });
		assert.deepStrictEqual(await single.json(), [{ version: 1, archived: false }]);
	});
});

async function makeAdminHeaders() {
	const adminId = new ObjectId();
	await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
	const code = generateRefreshCode();
	const tokenDoc = { user: adminId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], true);
	return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

describe("Admin gameinfo API — alias (issue #106)", () => {
	let headers: Record<string, string>;

	before(async () => {
		headers = await makeAdminHeaders();
	});

	after(() => db().dropDatabase());

	async function put(body: Record<string, unknown>) {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/splendor/1`, {
			method: "PUT",
			headers,
			body: JSON.stringify(body),
		});
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));
		// `alias` is game-level metadata (#298) — it lives on the per-game metadata
		// doc, served back merged through the public endpoints (asserted below).
		return colls.gameMetadatas.findOne({ _id: "splendor" });
	}

	it("sets the alias, serves it on the public endpoints, and clears it on null", async () => {
		let doc = await put({ ...baseInfo, alias: "Gem Trader" });
		assert.strictEqual(doc?.alias, "Gem Trader");

		// The public list + single-doc endpoints expose the alias (web renders it everywhere).
		const listSchema = z.array(z.object({ _id: z.object({ game: z.string() }), alias: z.string().optional() }));
		const list = listSchema.parse(await (await fetch(`${baseURL()}/api/boardgame/info`)).json());
		assert.strictEqual(list.find((g) => g._id.game === "splendor")?.alias, "Gem Trader");
		const single = z
			.object({ alias: z.string().optional() })
			.parse(await (await fetch(`${baseURL()}/api/boardgame/splendor`)).json());
		assert.strictEqual(single.alias, "Gem Trader");

		// null clears the alias (JSON can't carry undefined — GameEdit sends null).
		doc = await put({ ...baseInfo, alias: null });
		assert.strictEqual(doc && "alias" in doc, false, "alias field is removed from the doc");

		// Omitting the field entirely leaves a previously-set alias untouched.
		await put({ ...baseInfo, alias: "Gem Trader" });
		doc = await put(baseInfo);
		assert.strictEqual(doc?.alias, "Gem Trader");
	});
});

// The version-page upsert writes version fields to `gameInfos` and game-level
// fields to `gameMetadatas` (#298). A save that omits metadata fields must NOT
// clear them (the split-upsert clearing bug): only fields actually present in the
// body are written, everything else is left untouched.
describe("Admin gameinfo API — split upsert (#298)", () => {
	let headers: Record<string, string>;

	before(async () => {
		headers = await makeAdminHeaders();
	});

	after(() => db().dropDatabase());

	async function put(game: string, version: number, body: Record<string, unknown>) {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/${game}/${version}`, {
			method: "PUT",
			headers,
			body: JSON.stringify(body),
		});
		const text = await res.text();
		assert.strictEqual(res.status, 200, text);
		return JSON.parse(text) as unknown;
	}

	it("a version-page save omitting metadata fields does not clear them", async () => {
		// Create with full metadata.
		await put("splitgame", 1, {
			label: "Split Game",
			alias: "Split Alias",
			description: "a description",
			rules: "the rules",
			credits: "the credits",
			players: [2, 3],
			viewer: { url: "//v1" },
			public: true,
			meta: {},
		});
		let meta = await colls.gameMetadatas.findOne({ _id: "splitgame" });
		assert.strictEqual(meta?.label, "Split Game");
		assert.strictEqual(meta?.description, "a description");
		assert.strictEqual(meta?.credits, "the credits", "credits routed to the game metadata doc (#351)");

		// A re-PUT carrying only version fields (what the version page sends after
		// GameEdit strips game-level metadata) must leave the metadata doc intact.
		await put("splitgame", 1, { viewer: { url: "//v1-updated" }, public: true, meta: {} });
		meta = await colls.gameMetadatas.findOne({ _id: "splitgame" });
		assert.strictEqual(meta?.label, "Split Game", "label not cleared by a metadata-less save");
		assert.strictEqual(meta?.alias, "Split Alias", "alias not cleared");
		assert.strictEqual(meta?.description, "a description", "description not cleared");
		assert.strictEqual(meta?.credits, "the credits", "credits not cleared");
		assert.deepEqual(meta?.players, [2, 3], "players not cleared");

		// The version doc got the version-field update and never held game-level fields.
		const version = await colls.gameInfos.findOne({ _id: { game: "splitgame", version: 1 } });
		assert.strictEqual(version?.viewer.url, "//v1-updated");
		assert.ok(version && !("label" in version), "version doc does not carry the label");
	});

	it("creating a second version shares the one metadata doc", async () => {
		await put("splitgame", 2, { viewer: { url: "//v2" }, public: true, meta: {} });
		const metas = await colls.gameMetadatas.find({ _id: "splitgame" }).toArray();
		assert.strictEqual(metas.length, 1, "still a single metadata doc for the game");
		assert.strictEqual(metas[0].label, "Split Game");
	});

	it("a round-tripped likeCount never lands on the version doc nor overwrites the counter", async () => {
		await colls.gameMetadatas.updateOne({ _id: "splitgame" }, { $set: { likeCount: 5 } });

		// The version page GETs the *merged* doc, so a save/duplicate round-trips
		// likeCount (and timestamps) in the PUT body — all must be stripped.
		await put("splitgame", 1, { viewer: { url: "//v1" }, public: true, meta: {}, likeCount: 3 });

		const version = await colls.gameInfos.findOne({ _id: { game: "splitgame", version: 1 } });
		assert.ok(version && !("likeCount" in version), "likeCount not $set onto the version doc");
		const meta = await colls.gameMetadatas.findOne({ _id: "splitgame" });
		assert.strictEqual(meta?.likeCount, 5, "counter untouched by a version-page save");
	});

	it("the meta PUT ignores round-tripped server-managed fields and 404s on unknown games", async () => {
		await colls.gameMetadatas.updateOne({ _id: "splitgame" }, { $set: { likeCount: 5 } });

		// The boardgames editor round-trips the GET response: _id, timestamps and a
		// (possibly stale) likeCount must all be ignored by the PUT.
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/splitgame/meta`, {
			method: "PUT",
			headers,
			body: JSON.stringify({
				_id: "splitgame",
				label: "Split Game (edited)",
				credits: "- Ported by [@someone](/user/someone)",
				likeCount: 3,
				createdAt: new Date(0).toISOString(),
				updatedAt: new Date(0).toISOString(),
			}),
		});
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));

		const meta = await colls.gameMetadatas.findOne({ _id: "splitgame" });
		assert.strictEqual(meta?.label, "Split Game (edited)");
		assert.strictEqual(meta?.credits, "- Ported by [@someone](/user/someone)", "the meta PUT accepts credits (#351)");
		assert.strictEqual(meta?.likeCount, 5, "stale round-tripped likeCount does not clobber the counter");
		assert.notDeepEqual(meta?.updatedAt, new Date(0), "timestamps stay wrapper-managed");

		// No version doc for the game ⇒ no orphan metadata doc.
		const missing = await fetch(`${baseURL()}/api/admin/gameinfo/no-such-game/meta`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ label: "Ghost" }),
		});
		assert.strictEqual(missing.status, 404);
		assert.strictEqual(await colls.gameMetadatas.findOne({ _id: "no-such-game" }), null);
	});
});

// likeCount is game-scoped (#289): it lives on the single per-game metadata doc
// and surfaces on the merged game-info the web client reads for the like badge +
// popularity sort. The like/unlike service ($inc on gamemetadatas) lands with the
// likes feature; here we assert the read join surfaces a metadata-side likeCount.
describe("Boardgame info — likeCount surfaces from game metadata (#289/#298)", () => {
	after(() => db().dropDatabase());

	it("the public list and single-doc endpoints expose the metadata likeCount", async () => {
		await colls.gameInfos.insertOne({
			_id: { game: "likedgame", version: 1 },
			viewer: { url: "//v1" },
			public: true,
			meta: {},
		});
		await colls.gameMetadatas.insertOne({ _id: "likedgame", label: "Liked Game", players: [2], likeCount: 7 });

		const list = z
			.array(z.object({ _id: z.object({ game: z.string() }), likeCount: z.number().optional() }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/info`)).json());
		assert.strictEqual(list.find((g) => g._id.game === "likedgame")?.likeCount, 7);

		const single = z
			.object({ likeCount: z.number().optional() })
			.parse(await (await fetch(`${baseURL()}/api/boardgame/likedgame`)).json());
		assert.strictEqual(single.likeCount, 7);
	});
});

const withEngine = (name: string, version = "1.0.0") => ({
	label: "Evil",
	engine: { package: { name, version }, entryPoint: "dist/index.js" },
});

// Issue #270: the game-server installer builds `npm install <name>@<version>` from
// engine.package — before validation, a package name with shell metacharacters
// (`x$(touch …)`, `;`, backticks) reached the spawn and executed on the game-server
// host. The upsert route must reject such payloads with 400 and store nothing.
describe("Admin gameinfo API — engine.package validation (#270)", () => {
	let headers: Record<string, string>;

	before(async () => {
		headers = await makeAdminHeaders();
	});

	after(() => db().dropDatabase());

	async function upsert(body: unknown) {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/evilgame/1`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		return { status: res.status, body: await res.text() };
	}

	it("rejects package names with shell metacharacters and stores nothing", async () => {
		for (const name of ["x$(touch /tmp/pwned)", "a;touch /tmp/pwned", "`touch /tmp/pwned`", "a && id", "a|id"]) {
			const res = await upsert(withEngine(name));
			assert.strictEqual(res.status, 400, `expected 400 for ${JSON.stringify(name)}, got ${res.status}: ${res.body}`);
		}
		assert.strictEqual(await colls.gameInfos.findOne({ _id: { game: "evilgame", version: 1 } }), null);
	});

	it("rejects versions that are not pinned semver", async () => {
		for (const version of ["$(id)", "^1.0.0", "1.0.0 || wget evil.sh", "latest"]) {
			const res = await upsert(withEngine("evil-engine", version));
			assert.strictEqual(
				res.status,
				400,
				`expected 400 for version ${JSON.stringify(version)}, got ${res.status}: ${res.body}`,
			);
		}
		assert.strictEqual(await colls.gameInfos.findOne({ _id: { game: "evilgame", version: 1 } }), null);
	});

	it("accepts a valid scoped/unscoped package name and semver version", async () => {
		for (const name of ["@gaia-project/engine", "container-engine", "@boardgamers/powergrid-engine"]) {
			const res = await upsert(withEngine(name));
			assert.strictEqual(res.status, 200, `expected 200 for ${name}, got ${res.status}: ${res.body}`);
		}
		const doc = await colls.gameInfos.findOne({ _id: { game: "evilgame", version: 1 } });
		assert.strictEqual(doc?.engine?.package.name, "@boardgamers/powergrid-engine");

		const ranged = await upsert(withEngine("evil-engine", "1.2.3-beta.1+build.5"));
		assert.strictEqual(ranged.status, 200, ranged.body);
	});

	it("keeps the loose-record behavior for payloads without an engine", async () => {
		const res = await upsert({ label: "No engine", customField: { nested: [1, 2] } });
		assert.strictEqual(res.status, 200, res.body);
	});
});

const archInfo = (version: number) => ({
	_id: { game: "archgame", version },
	label: "Archive game",
	players: [2],
	viewer: { url: "//example.com/viewer.js" },
	public: true,
	meta: {},
});

// meta.archived marks a retired version: skipped by the game-server installer
// and never the latest public pick, but its viewer keeps being served. It is
// only toggled by the archive/unarchive actions (hard-blocked while the version
// is the latest public one; ongoing games need a force override) — never by a
// loose-record save.
describe("Admin gameinfo API — archive/unarchive", () => {
	let headers: Record<string, string>;

	before(async () => {
		headers = await makeAdminHeaders();
	});

	after(() => db().dropDatabase());

	async function post(action: string, version: number, body: Record<string, unknown> = {}) {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/archgame/${version}/${action}`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
		return { status: res.status, body: await res.text() };
	}

	it("archives a non-latest version with no ongoing games, and unarchives it", async () => {
		await colls.gameInfos.insertMany([archInfo(1), archInfo(2)]);

		const res = await post("archive", 1);
		assert.strictEqual(res.status, 200, res.body);
		let doc = await colls.gameInfos.findOne({ _id: { game: "archgame", version: 1 } });
		assert.strictEqual(doc?.meta?.archived, true);

		const un = await post("unarchive", 1);
		assert.strictEqual(un.status, 200, un.body);
		doc = await colls.gameInfos.findOne({ _id: { game: "archgame", version: 1 } });
		assert.strictEqual(doc?.meta && "archived" in doc.meta, false, "archived flag is removed from the doc");
	});

	it("rejects archiving the latest public version with 409", async () => {
		const res = await post("archive", 2);
		assert.strictEqual(res.status, 409, res.body);
		assert.match(res.body, /latest public version/);
	});

	it("soft-blocks archiving a version with ongoing games unless forced", async () => {
		await colls.games.insertOne(testGame({ _id: "arch-ongoing", game: { name: "archgame", version: 1 } }));

		// No force: 409 with a structured body naming the ongoing-games count.
		const res = await post("archive", 1);
		assert.strictEqual(res.status, 409, res.body);
		const conflict = z
			.object({ error: z.literal("ongoing_games"), count: z.number(), message: z.string() })
			.parse(JSON.parse(res.body));
		assert.strictEqual(conflict.count, 1);
		assert.match(conflict.message, /ongoing game/);
		let doc = await colls.gameInfos.findOne({ _id: { game: "archgame", version: 1 } });
		assert.strictEqual(doc?.meta && "archived" in doc.meta, false, "not archived without force");

		// force: true archives despite the ongoing game.
		const forced = await post("archive", 1, { force: true });
		assert.strictEqual(forced.status, 200, forced.body);
		doc = await colls.gameInfos.findOne({ _id: { game: "archgame", version: 1 } });
		assert.strictEqual(doc?.meta?.archived, true);
		await colls.gameInfos.updateOne({ _id: { game: "archgame", version: 1 } }, { $unset: { "meta.archived": true } });

		// Ended games don't block archiving.
		await colls.games.updateOne({ _id: "arch-ongoing" }, { $set: { status: "ended" } });
		const ok = await post("archive", 1);
		assert.strictEqual(ok.status, 200, ok.body);
	});

	it("404s on an unknown version", async () => {
		const res = await post("archive", 99);
		assert.strictEqual(res.status, 404, res.body);
	});

	it("an archived version is excluded from latest-public picks and the public list", async () => {
		// v1 is archived from the previous test; v2 is the current public version.
		const boardgame = z
			.object({ _id: z.object({ version: z.number() }) })
			.parse(await (await fetch(`${baseURL()}/api/boardgame/archgame`)).json());
		assert.strictEqual(boardgame._id.version, 2);

		const list = z
			.array(z.object({ _id: z.object({ game: z.string(), version: z.number() }) }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/info`)).json());
		assert.deepStrictEqual(
			list.filter((g) => g._id.game === "archgame").map((g) => g._id.version),
			[2],
		);

		// The versioned read path is untouched: old games on v1 stay replayable.
		const versioned = await fetch(`${baseURL()}/api/boardgame/archgame/info/1`);
		assert.strictEqual(versioned.status, 200);
	});

	it("blocks new-game creation on an archived version with 409", async () => {
		const res = await fetch(`${baseURL()}/api/game/new-game`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				game: { game: "archgame", version: 1 },
				gameId: "arch-new",
				players: 2,
				timePerGame: 86400,
				timePerMove: 3600,
			}),
		});
		assert.strictEqual(res.status, 409, await res.text().catch(() => ""));
	});

	it("the upsert body cannot set or clear meta.archived", async () => {
		await fetch(`${baseURL()}/api/admin/gameinfo/archgame/1`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ ...archInfo(1), meta: { archived: false } }),
		});
		let doc = await colls.gameInfos.findOne({ _id: { game: "archgame", version: 1 } });
		assert.strictEqual(doc?.meta?.archived, true, "save must not clear the archived flag");

		await fetch(`${baseURL()}/api/admin/gameinfo/archgame/2`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ ...archInfo(2), meta: { archived: true } }),
		});
		doc = await colls.gameInfos.findOne({ _id: { game: "archgame", version: 2 } });
		assert.strictEqual(doc?.meta && "archived" in doc.meta, false, "save must not set the archived flag");
	});
});

// Per-version ongoing-games counts (open + active), one aggregation — feeds the
// badges on the admin game page's version tabs. Same semantics as the archive
// route's ongoing-games check.
describe("Admin gameinfo API — ongoing-games counts", () => {
	let headers: Record<string, string>;

	before(async () => {
		headers = await makeAdminHeaders();
		await colls.games.insertMany([
			testGame({ _id: "og-1", game: { name: "countgame", version: 1 }, status: "open" }),
			testGame({ _id: "og-2", game: { name: "countgame", version: 1 }, status: "active" }),
			testGame({ _id: "og-3", game: { name: "countgame", version: 2 }, status: "active" }),
			testGame({ _id: "og-4", game: { name: "countgame", version: 2 }, status: "ended" }),
			testGame({ _id: "og-5", game: { name: "othergame", version: 1 }, status: "active" }),
		]);
	});

	after(() => db().dropDatabase());

	async function get(game: string, withAuth = true) {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/${game}/ongoing-games`, withAuth ? { headers } : {});
		return { status: res.status, data: res.status === 200 ? await res.json() : null };
	}

	it("rejects non-admin callers", async () => {
		assert.strictEqual((await get("countgame", false)).status, 403);
	});

	it("returns per-version counts of open + active games only", async () => {
		const res = await get("countgame");
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, [
			{ version: 1, count: 2, gameIds: ["og-1", "og-2"] },
			{ version: 2, count: 1, gameIds: ["og-3"] },
		]);
	});

	it("returns an empty list for a game with no ongoing games", async () => {
		const res = await get("no-such-game");
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, []);
	});

	it("is not swallowed by the /:game/:version route (#319 ordering)", async () => {
		// If "ongoing-games" were routed as :version, the handler would coerce it
		// to NaN and answer 404 — a 200 array proves the static segment wins.
		const res = await get("othergame");
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, [{ version: 1, count: 1, gameIds: ["og-5"] }]);
	});

	it("caps gameIds at 10 per version while the count stays exact", async () => {
		await colls.games.insertMany(
			Array.from({ length: 12 }, (_, i) =>
				testGame({ _id: `og-many-${i}`, game: { name: "manygame", version: 1 }, status: "active" }),
			),
		);
		const res = await get("manygame");
		assert.strictEqual(res.status, 200);
		assert.strictEqual(res.data.length, 1);
		assert.strictEqual(res.data[0].version, 1);
		assert.strictEqual(res.data[0].count, 12, "count stays exact past the cap");
		assert.strictEqual(res.data[0].gameIds.length, 10, "gameIds are capped");
		assert.ok(
			res.data[0].gameIds.every((id: unknown) => typeof id === "string" && id.startsWith("og-many-")),
			"gameIds are the games' string _ids",
		);
	});
});

const betaInfo = (version: number, isPublic: boolean) => ({
	_id: { game: "secretgame", version },
	label: "Secret Game",
	players: [2],
	viewer: { url: "//example.com/viewer.js" },
	public: isPublic,
	meta: {},
});

// Private-beta management: the grants listed/created/revoked here are the same
// per-(user, game) access.maxVersion docs the user-centric routes manage —
// these are keyed by game, for the admin boardgame page.
describe("Admin gameinfo API — private beta users", () => {
	let headers: Record<string, string>;
	const memberId = new ObjectId();
	const inviteeId = new ObjectId();
	const emailInviteeId = new ObjectId();

	async function req(method: string, path: string, body?: unknown, withAuth = true) {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/${path}`, {
			method,
			...(withAuth ? { headers } : {}),
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
		const text = await res.text();
		let data: unknown = text;
		try {
			data = JSON.parse(text);
		} catch {
			// not JSON (empty 200)
		}
		return { status: res.status, data };
	}

	before(async () => {
		headers = await makeAdminHeaders();
		await colls.gameInfos.insertMany([betaInfo(1, true), betaInfo(2, false)]);
		await colls.gameMetadatas.insertOne({ _id: "secretgame", label: "Secret Game", players: [2] });
		await colls.users.insertOne(
			testUser({ _id: memberId, account: { username: "beta-member" }, security: { slug: "beta-member" } }),
		);
		await colls.users.insertOne(
			testUser({ _id: inviteeId, account: { username: "beta-invitee" }, security: { slug: "beta-invitee" } }),
		);
		await colls.users.insertOne(
			testUser({
				_id: emailInviteeId,
				account: { username: "beta-email-invitee", email: "beta-email@test.com" },
				security: { slug: "beta-email-invitee" },
			}),
		);
		await colls.gamePreferences.insertOne({ user: memberId, game: "secretgame", access: { maxVersion: 2 } });
		// Elo-only doc: no grant, must not be listed.
		await colls.gamePreferences.insertOne({ user: inviteeId, game: "secretgame", elo: { value: 1000, games: 1 } });
	});

	after(() => db().dropDatabase());

	it("rejects non-admin callers", async () => {
		assert.strictEqual((await req("GET", "secretgame/beta-users", undefined, false)).status, 403);
		assert.strictEqual((await req("POST", "secretgame/beta-users", { usernameOrEmail: "x" }, false)).status, 403);
		assert.strictEqual(
			(await req("DELETE", `secretgame/beta-users/${memberId.toHexString()}`, undefined, false)).status,
			403,
		);
	});

	it("404s for an unknown game", async () => {
		assert.strictEqual((await req("GET", "no-such-game/beta-users")).status, 404);
		assert.strictEqual((await req("POST", "no-such-game/beta-users", { usernameOrEmail: "beta-member" })).status, 404);
		assert.strictEqual((await req("DELETE", `no-such-game/beta-users/${memberId.toHexString()}`)).status, 404);
	});

	it("lists users holding a grant, with username and maxVersion", async () => {
		const res = await req("GET", "secretgame/beta-users");
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, [{ userId: memberId.toHexString(), username: "beta-member", maxVersion: 2 }]);
	});

	it("invites by username: grants access to the latest (non-public) version", async () => {
		const res = await req("POST", "secretgame/beta-users", { usernameOrEmail: "beta-invitee" });
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, {
			userId: inviteeId.toHexString(),
			username: "beta-invitee",
			maxVersion: 2,
		});

		const pref = await colls.gamePreferences.findOne({ user: inviteeId, game: "secretgame" });
		assert.strictEqual(pref?.access?.maxVersion, 2);
		// The elo already on the doc is untouched by the grant.
		assert.strictEqual(pref?.elo?.value, 1000);
	});

	it("invites by email", async () => {
		const res = await req("POST", "secretgame/beta-users", { usernameOrEmail: "beta-email@test.com" });
		assert.strictEqual(res.status, 200);

		const pref = await colls.gamePreferences.findOne({ user: emailInviteeId, game: "secretgame" });
		assert.strictEqual(pref?.access?.maxVersion, 2);
	});

	it("404s inviting an unknown user", async () => {
		assert.strictEqual((await req("POST", "secretgame/beta-users", { usernameOrEmail: "no-such-user" })).status, 404);
		assert.strictEqual(
			(await req("POST", "secretgame/beta-users", { usernameOrEmail: "nobody@test.com" })).status,
			404,
		);
	});

	it("revokes a user's grant", async () => {
		const res = await req("DELETE", `secretgame/beta-users/${memberId.toHexString()}`);
		assert.strictEqual(res.status, 200);

		const pref = await colls.gamePreferences.findOne({ user: memberId, game: "secretgame" });
		assert.strictEqual(pref?.access?.maxVersion, undefined);

		const list = await req("GET", "secretgame/beta-users");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const usernames = (list.data as { username: string }[]).map((u) => u.username);
		assert.ok(!usernames.includes("beta-member"));
	});

	it("does not grant when the latest version is public", async () => {
		await colls.gameInfos.insertOne(betaInfo(3, true));

		const res = await req("POST", "secretgame/beta-users", { usernameOrEmail: "beta-member" });
		assert.strictEqual(res.status, 200);

		const pref = await colls.gamePreferences.findOne({ user: memberId, game: "secretgame" });
		assert.strictEqual(pref?.access?.maxVersion, undefined, "no grant stored for a public latest version");
	});
});

// Uploading the first version of a requested game (#340) moves it to "beta": it
// KEEPS its place on the requests page (votes included) until a version is
// publicly released — only then does it leave the page and join the regular
// game list.
describe("Admin gameinfo API — requested game enters beta, then leaves on public release (#340)", () => {
	let headers: Record<string, string>;

	before(async () => {
		headers = await makeAdminHeaders();
		await colls.gameMetadatas.insertOne({
			_id: "requested-flip",
			label: "Requested Flip",
			players: [],
			status: "requested",
			likeCount: 3,
		});
	});

	after(() => db().dropDatabase());

	it("flips status to beta on the first (non-public) version upsert, staying on the requests page", async () => {
		// While requested, the game is absent from the public list.
		const before1 = z
			.array(z.object({ _id: z.object({ game: z.string() }) }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/info`)).json());
		assert.ok(!before1.some((g) => g._id.game === "requested-flip"));

		const res = await fetch(`${baseURL()}/api/admin/gameinfo/requested-flip/1`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ label: "Requested Flip", players: [2], viewer: { url: "//v1" }, public: false, meta: {} }),
		});
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));

		const meta = await colls.gameMetadatas.findOne({ _id: "requested-flip" });
		assert.strictEqual(meta?.status, "beta");
		assert.strictEqual(meta?.likeCount, 3, "votes are kept");

		// Still nothing public: absent from the public game list…
		const list = z
			.array(z.object({ _id: z.object({ game: z.string() }) }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/info`)).json());
		assert.ok(!list.some((g) => g._id.game === "requested-flip"));

		// …but present on the requests listing, flagged beta, votes intact.
		const requests = z
			.array(z.object({ _id: z.string(), status: z.string().optional(), likeCount: z.number() }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/requests`)).json());
		const entry = requests.find((r) => r._id === "requested-flip");
		assert.strictEqual(entry?.status, "beta");
		assert.strictEqual(entry?.likeCount, 3);
	});

	it("clears the status once a version is saved public: the game leaves the requests page", async () => {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/requested-flip/1`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ label: "Requested Flip", players: [2], viewer: { url: "//v1" }, public: true, meta: {} }),
		});
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));

		const meta = await colls.gameMetadatas.findOne({ _id: "requested-flip" });
		assert.strictEqual(meta?.status, undefined, "a public release clears the status (absent = implemented)");
		assert.strictEqual(meta?.likeCount, 3, "votes are kept");

		// It now appears in the public game list…
		const list = z
			.array(z.object({ _id: z.object({ game: z.string() }), likeCount: z.number().optional() }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/info`)).json());
		assert.strictEqual(list.find((g) => g._id.game === "requested-flip")?.likeCount, 3);

		// …and is gone from the requests listing.
		const requests = z
			.array(z.object({ _id: z.string() }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/requests`)).json());
		assert.ok(!requests.some((r) => r._id === "requested-flip"));
	});

	it("flips back to beta if the only public version is un-published", async () => {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/requested-flip/1`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ label: "Requested Flip", players: [2], viewer: { url: "//v1" }, public: false, meta: {} }),
		});
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));

		const meta = await colls.gameMetadatas.findOne({ _id: "requested-flip" });
		assert.strictEqual(meta?.status, "beta");
	});

	it("a game first uploaded public (never requested) is auto-unlisted and pinned to implemented", async () => {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/direct-public/1`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ label: "Direct Public", players: [2], viewer: { url: "//v1" }, public: true, meta: {} }),
		});
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));

		const meta = await colls.gameMetadatas.findOne({ _id: "direct-public" });
		assert.strictEqual(meta?.unlisted, true, "admin-created games opt out of the requests page by default");
		assert.strictEqual(meta?.status, "implemented", "unlisted pins the status (it never lands on the requests page)");
	});

	it('deleting a beta game\'s last version returns it to "requested"', async () => {
		// requested-flip is currently beta (v1 non-public, from the tests above).
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/requested-flip/1`, { method: "DELETE", headers });
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));

		const meta = await colls.gameMetadatas.findOne({ _id: "requested-flip" });
		assert.strictEqual(meta?.status, "requested");
		assert.strictEqual(meta?.likeCount, 3, "votes are kept");

		// Back on the requests page as a plain request (no beta flag).
		const requests = z
			.array(z.object({ _id: z.string(), status: z.string().optional() }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/requests`)).json());
		const entry = requests.find((r) => r._id === "requested-flip");
		assert.strictEqual(entry?.status, "requested");
	});

	it("deleting the last version of a released game returns it to a plain request", async () => {
		// direct-public is currently implemented (v1 public, auto-unlisted): first
		// opt it back into the requests page so the delete re-derive has something
		// to recompute (unlisted pins "implemented" regardless of versions).
		const list = await fetch(`${baseURL()}/api/admin/gameinfo/direct-public/meta`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ unlisted: null }),
		});
		assert.strictEqual(list.status, 200, await list.text().catch(() => ""));
		assert.strictEqual((await colls.gameMetadatas.findOne({ _id: "direct-public" }))?.status, undefined);

		const res = await fetch(`${baseURL()}/api/admin/gameinfo/direct-public/1`, { method: "DELETE", headers });
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));

		const meta = await colls.gameMetadatas.findOne({ _id: "direct-public" });
		assert.strictEqual(meta?.status, "requested", "no version left at all → back to a plain request");
	});

	it("a brand-new game created from the admin panel is auto-unlisted (no associated request)", async () => {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/pet-project/1`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ label: "Pet Project", players: [2], viewer: { url: "//v1" }, public: false, meta: {} }),
		});
		assert.strictEqual(res.status, 200, await res.text().catch(() => ""));

		const meta = await colls.gameMetadatas.findOne({ _id: "pet-project" });
		assert.strictEqual(meta?.unlisted, true, "admin-created games opt out of the requests page by default");
		assert.strictEqual(meta?.status, "implemented", "unlisted pins the status to implemented");

		// It does not show on the requests page despite having no public version.
		const requests = z
			.array(z.object({ _id: z.string() }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/requests`)).json());
		assert.ok(!requests.some((r) => r._id === "pet-project"));
	});

	it('unlisted games stay pinned to "implemented" across version edits', async () => {
		// pet-project is unlisted from the test above (v1 non-public).
		const put = await fetch(`${baseURL()}/api/admin/gameinfo/pet-project/2`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ label: "Pet Project", players: [2], viewer: { url: "//v2" }, public: false, meta: {} }),
		});
		assert.strictEqual(put.status, 200, await put.text().catch(() => ""));
		assert.strictEqual((await colls.gameMetadatas.findOne({ _id: "pet-project" }))?.status, "implemented");

		const del = await fetch(`${baseURL()}/api/admin/gameinfo/pet-project/2`, { method: "DELETE", headers });
		assert.strictEqual(del.status, 200, await del.text().catch(() => ""));
		assert.strictEqual((await colls.gameMetadatas.findOne({ _id: "pet-project" }))?.status, "implemented");
	});

	it("the metadata route toggles unlisted and re-derives the status", async () => {
		// Opt back into the requests page: unlisted cleared → beta (no public version).
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/pet-project/meta`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ unlisted: null }),
		});
		assert.strictEqual(res.status, 200);
		const body = z.object({ unlisted: z.boolean().optional(), status: z.string().optional() }).parse(await res.json());
		assert.strictEqual(body.unlisted, undefined);
		assert.strictEqual(body.status, "beta");

		const meta = await colls.gameMetadatas.findOne({ _id: "pet-project" });
		assert.strictEqual(meta?.unlisted, undefined);
		assert.strictEqual(meta?.status, "beta");

		// And it shows on the requests page now.
		const requests = z
			.array(z.object({ _id: z.string(), status: z.string().optional() }))
			.parse(await (await fetch(`${baseURL()}/api/boardgame/requests`)).json());
		assert.strictEqual(requests.find((r) => r._id === "pet-project")?.status, "beta");

		// Opt back out: unlisted → pinned to implemented again.
		const off = await fetch(`${baseURL()}/api/admin/gameinfo/pet-project/meta`, {
			method: "PUT",
			headers,
			body: JSON.stringify({ unlisted: true }),
		});
		assert.strictEqual(off.status, 200);
		const offBody = z
			.object({ unlisted: z.boolean().optional(), status: z.string().optional() })
			.parse(await off.json());
		assert.strictEqual(offBody.unlisted, true);
		assert.strictEqual(offBody.status, "implemented");
	});
});

// LLM translation of the game-level free-text metadata (description/rules/
// credits) into the `translations` overlay (#306). A stub OpenAI-compatible
// server echoes a recognizable translation; the tests assert the overlay is
// written per language and the base (English) fields stay untouched.
describe("Admin gameinfo API — metadata translation (#306)", () => {
	let headers: Record<string, string>;
	let llm: http.Server;

	before(async () => {
		headers = await makeAdminHeaders();
		await colls.gameInfos.insertOne({
			_id: { game: "transgame", version: 1 },
			viewer: { url: "//v1" },
			public: true,
			meta: {},
		});
		await colls.gameMetadatas.insertOne({
			_id: "transgame",
			label: "Trans Game",
			players: [2],
			description: "A **great** game.",
			rules: "Build first.",
			// no credits — only fields with a base string are translated
		});

		llm = http.createServer((req, res) => {
			let raw = "";
			req.on("data", (chunk) => (raw += chunk));
			req.on("end", () => {
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse is any; fields are defaulted below
				const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
				const user = body.messages.find((m) => m.role === "user")?.content ?? "";
				res.setHeader("content-type", "application/json");
				res.end(
					JSON.stringify({
						choices: [{ message: { content: `[de] ${user.split("\n\n").at(-1)}` }, finish_reason: "stop" }],
					}),
				);
			});
		});
		await new Promise<void>((resolve) => llm.listen(0, "127.0.0.1", resolve));
		env.translation.apiKey = "test-key";
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listen(0, "127.0.0.1") binds a TCP port, so the address is an AddressInfo
		env.translation.baseUrl = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
	});

	after(async () => {
		env.translation.apiKey = "";
		env.translation.baseUrl = "https://openrouter.ai/api/v1";
		await new Promise((resolve) => llm.close(resolve));
		await db().dropDatabase();
	});

	it("translates description+rules into targetLang, leaving base fields and missing credits untouched", async () => {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/transgame/meta/translate`, {
			method: "POST",
			headers,
			body: JSON.stringify({ targetLang: "de" }),
		});
		const resBody = await res.text();
		assert.strictEqual(res.status, 200, resBody);
		const doc = z
			.object({
				description: z.string(),
				rules: z.string(),
				translations: z
					.record(
						z.string(),
						z.object({
							description: z.string().optional(),
							rules: z.string().optional(),
							translatedFrom: z.object({ updatedAt: z.coerce.date() }).optional(),
						}),
					)
					.optional(),
			})
			.parse(JSON.parse(resBody));
		// Base (English) fields untouched.
		assert.strictEqual(doc.description, "A **great** game.");
		assert.strictEqual(doc.rules, "Build first.");
		// Overlay written for de, only for the fields that had a source.
		assert.strictEqual(doc.translations?.de?.description, "[de] A **great** game.");
		assert.strictEqual(doc.translations?.de?.rules, "[de] Build first.");
		assert.strictEqual(doc.translations?.de && "credits" in doc.translations.de, false);
		// Stamped with the source doc's updatedAt so the dashboard can track outdatedness.
		const stored = await colls.gameMetadatas.findOne({ _id: "transgame" });
		assert.ok(stored?.updatedAt, "the source doc has an updatedAt");
		assert.strictEqual(doc.translations?.de?.translatedFrom?.updatedAt?.getTime(), stored.updatedAt.getTime());
	});

	it("translate-all fills every missing UI locale and skips existing ones", async () => {
		// de already exists from the previous test — translate-all must skip it.
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/transgame/meta/translate-all`, {
			method: "POST",
			headers,
			body: JSON.stringify({}),
		});
		const resBody = await res.text();
		assert.strictEqual(res.status, 200, resBody);
		const body = z
			.object({ translated: z.number(), errors: z.array(z.object({ lang: z.string() })) })
			.parse(JSON.parse(resBody));
		assert.strictEqual(body.errors.length, 0);
		// 10 UI locales → 9 non-en base subtags; de already done → 8 new.
		assert.strictEqual(body.translated, 8);

		const doc = await colls.gameMetadatas.findOne({ _id: "transgame" });
		assert.strictEqual(doc?.translations?.de?.description, "[de] A **great** game.");
		assert.strictEqual(doc?.translations?.fr?.description, "[de] A **great** game."); // stub echoes [de] regardless
		assert.strictEqual(Object.keys(doc?.translations ?? {}).length, 9);
		// Every overlay carries a translatedFrom stamp. It can't equal the doc's
		// final updatedAt: each overlay write bumps it (withAutoUpdatedAt), so a
		// stamp is the source's updatedAt as of that language's write.
		assert.ok(doc?.updatedAt);
		for (const [lang, overlay] of Object.entries(doc?.translations ?? {})) {
			assert.ok(overlay.translatedFrom?.updatedAt, `stamp for ${lang}`);
			assert.ok(overlay.translatedFrom.updatedAt.getTime() <= doc.updatedAt.getTime(), `stamp for ${lang}`);
		}
	});

	it("rejects a scoped admin of a DIFFERENT game and an unauthenticated caller", async () => {
		// Per-boardgame admin of another game: paid LLM endpoint, so cross-game must 403.
		const otherId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: otherId, adminGrants: ["gameinfo:othergame"] }));
		const code = generateRefreshCode();
		const tokenDoc = { user: otherId, codeHash: hashRefreshCode(code), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const otherHeaders = { Authorization: `Bearer ${await createAccessToken(tokenDoc, ["all"], true)}` };

		const scoped = await fetch(`${baseURL()}/api/admin/gameinfo/transgame/meta/translate`, {
			method: "POST",
			headers: otherHeaders,
			body: JSON.stringify({ targetLang: "de" }),
		});
		assert.strictEqual(scoped.status, 403);

		const anon = await fetch(`${baseURL()}/api/admin/gameinfo/transgame/meta/translate`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ targetLang: "de" }),
		});
		// Unauthenticated: 401 (no user) or 403 (mount gate) — either way rejected.
		assert.ok(anon.status === 401 || anon.status === 403, `expected 401/403, got ${anon.status}`);
	});

	it("400s on an invalid targetLang", async () => {
		const res = await fetch(`${baseURL()}/api/admin/gameinfo/transgame/meta/translate`, {
			method: "POST",
			headers,
			body: JSON.stringify({ targetLang: "../../etc" }),
		});
		assert.strictEqual(res.status, 400);
	});

	it("404s on an unknown game and 400s when there's nothing to translate", async () => {
		const notFound = await fetch(`${baseURL()}/api/admin/gameinfo/nogame/meta/translate`, {
			method: "POST",
			headers,
			body: JSON.stringify({ targetLang: "de" }),
		});
		assert.strictEqual(notFound.status, 404);

		await colls.gameInfos.insertOne({
			_id: { game: "emptygame", version: 1 },
			viewer: { url: "//v1" },
			public: true,
			meta: {},
		});
		await colls.gameMetadatas.insertOne({ _id: "emptygame", label: "Empty", players: [2] });
		const empty = await fetch(`${baseURL()}/api/admin/gameinfo/emptygame/meta/translate`, {
			method: "POST",
			headers,
			body: JSON.stringify({ targetLang: "de" }),
		});
		assert.strictEqual(empty.status, 400);
	});
});
