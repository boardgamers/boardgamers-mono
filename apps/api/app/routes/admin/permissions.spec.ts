// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testGame, testUser } from "../../config/test-helpers.ts";
import { createAdminToken } from "../../models/admintokens.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, headers?: Record<string, string>, body?: unknown) {
	const res = await fetch(`${baseURL()}${path}`, {
		method,
		headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data };
}

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], true);
	return { Authorization: `Bearer ${token}` };
}

const DAY_MS = 24 * 3600 * 1000;

async function insertGameInfo(game: string, version = 1) {
	await colls.gameInfos.insertOne({
		_id: { game, version },
		viewer: { url: `https://example.com/${game}/viewer.js` },
		public: false,
		meta: {},
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	// The gameinfo list is one entry per game, sourced from gameMetadatas.
	await colls.gameMetadatas.updateOne({ _id: game }, { $setOnInsert: { label: game, players: [2] } }, { upsert: true });
}

describe("Granular admin permissions", () => {
	const fullAdminId = new ObjectId();
	const newsletterAdminId = new ObjectId();
	const gameAdminAId = new ObjectId(); // gameinfo:game-a
	const gamesAdminId = new ObjectId(); // global "games"
	const usersAdminId = new ObjectId(); // global "users"
	const tokensAdminId = new ObjectId();
	const pagesAdminId = new ObjectId();
	const serverinfoAdminId = new ObjectId();
	const userId = new ObjectId();

	let fullAdmin: Record<string, string>;
	let newsletterAdmin: Record<string, string>;
	let gameAdminA: Record<string, string>;
	let gamesAdmin: Record<string, string>;
	let usersAdmin: Record<string, string>;
	let tokensAdmin: Record<string, string>;
	let pagesAdmin: Record<string, string>;
	let serverinfoAdmin: Record<string, string>;
	let regularUser: Record<string, string>;

	before(async () => {
		await colls.users.insertOne(testUser({ _id: fullAdminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: newsletterAdminId, adminGrants: ["newsletter"] }));
		await colls.users.insertOne(testUser({ _id: gameAdminAId, adminGrants: ["gameinfo:game-a"] }));
		await colls.users.insertOne(testUser({ _id: gamesAdminId, adminGrants: ["games"] }));
		await colls.users.insertOne(testUser({ _id: usersAdminId, adminGrants: ["users"] }));
		await colls.users.insertOne(testUser({ _id: tokensAdminId, adminGrants: ["tokens"] }));
		await colls.users.insertOne(testUser({ _id: pagesAdminId, adminGrants: ["pages"] }));
		await colls.users.insertOne(testUser({ _id: serverinfoAdminId, adminGrants: ["serverinfo"] }));
		await colls.users.insertOne(testUser({ _id: userId }));

		await insertGameInfo("game-a");
		await insertGameInfo("game-b");

		fullAdmin = await makeAuthHeaders(fullAdminId);
		newsletterAdmin = await makeAuthHeaders(newsletterAdminId);
		gameAdminA = await makeAuthHeaders(gameAdminAId);
		gamesAdmin = await makeAuthHeaders(gamesAdminId);
		usersAdmin = await makeAuthHeaders(usersAdminId);
		tokensAdmin = await makeAuthHeaders(tokensAdminId);
		pagesAdmin = await makeAuthHeaders(pagesAdminId);
		serverinfoAdmin = await makeAuthHeaders(serverinfoAdminId);
		regularUser = await makeAuthHeaders(userId);
	});

	after(() => db().dropDatabase());

	describe("GET /api/admin/me", () => {
		it("reports the full permission set to a full admin", async () => {
			const res = await api("GET", "/api/admin/me", fullAdmin);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const me = res.data as { fullAdmin: boolean; permissions: string[]; games: string[] };
			assert.strictEqual(me.fullAdmin, true);
			assert.ok(me.permissions.includes("newsletter"));
			assert.ok(me.permissions.includes("users"));
			assert.deepStrictEqual(me.games, []);
		});

		it("reports only their grants to a scoped admin", async () => {
			const res = await api("GET", "/api/admin/me", gameAdminA);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const me = res.data as { fullAdmin: boolean; permissions: string[]; games: string[] };
			assert.strictEqual(me.fullAdmin, false);
			assert.deepStrictEqual(me.permissions, []);
			assert.deepStrictEqual(me.games, ["game-a"]);
		});

		it("reports an empty set to a regular user, 401 when logged out", async () => {
			const res = await api("GET", "/api/admin/me", regularUser);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const me = res.data as { fullAdmin: boolean; permissions: string[]; games: string[] };
			assert.strictEqual(me.fullAdmin, false);
			assert.deepStrictEqual(me.permissions, []);
			assert.deepStrictEqual(me.games, []);

			assert.strictEqual((await api("GET", "/api/admin/me")).status, 401);
		});
	});

	describe("per-permission route gating", () => {
		it("users routes: allowed for full admin, denied for other scoped admins and regular users", async () => {
			assert.strictEqual((await api("GET", "/api/admin/users/stats", fullAdmin)).status, 200);
			assert.strictEqual((await api("GET", "/api/admin/users/stats", newsletterAdmin)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/users/stats", gameAdminA)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/users/stats", gamesAdmin)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/users/stats", regularUser)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/users/stats")).status, 403);
		});

		it("pages routes: allowed for the pages admin and per-boardgame admins, denied for others", async () => {
			assert.strictEqual((await api("GET", "/api/admin/page", pagesAdmin)).status, 200);
			assert.strictEqual((await api("GET", "/api/admin/page", fullAdmin)).status, 200);
			assert.strictEqual((await api("GET", "/api/admin/page", newsletterAdmin)).status, 403);
			// A per-boardgame admin reaches the (filtered) page list for their game.
			assert.strictEqual((await api("GET", "/api/admin/page", gameAdminA)).status, 200);
			assert.strictEqual((await api("GET", "/api/admin/page", regularUser)).status, 403);
		});

		it("changelog routes: denied for non-changelog scoped admins", async () => {
			assert.strictEqual((await api("GET", "/api/admin/changelog", fullAdmin)).status, 200);
			assert.strictEqual((await api("GET", "/api/admin/changelog", pagesAdmin)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/changelog", newsletterAdmin)).status, 403);
		});

		it("serverinfo routes: allowed for the serverinfo admin, denied for others", async () => {
			assert.strictEqual((await api("GET", "/api/admin/serverinfo", serverinfoAdmin)).status, 200);
			assert.strictEqual((await api("GET", "/api/admin/serverinfo", fullAdmin)).status, 200);
			assert.strictEqual((await api("GET", "/api/admin/serverinfo", newsletterAdmin)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/serverinfo", regularUser)).status, 403);
		});

		it("loki routes: denied for non-loki scoped admins", async () => {
			assert.strictEqual((await api("GET", "/api/admin/loki/labels", newsletterAdmin)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/loki/labels", serverinfoAdmin)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/loki/labels", regularUser)).status, 403);
		});

		it("feedback status: allowed for full admin, denied for scoped admins without the feedback grant", async () => {
			const { insertedId } = await colls.feedbackRequests.insertOne({
				kind: "site",
				title: "please fix",
				requestedBy: userId,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
			const path = `/api/feedback/${insertedId.toHexString()}/status`;
			const body = { status: "planned" };
			assert.strictEqual((await api("PATCH", path, newsletterAdmin, body)).status, 403);
			assert.strictEqual((await api("PATCH", path, regularUser, body)).status, 403);
			assert.strictEqual((await api("PATCH", path, fullAdmin, body)).status, 200);
		});
	});

	describe("newsletter permission isolation", () => {
		it("a newsletter admin reaches NO existing admin route", async () => {
			const routes: [string, string][] = [
				["GET", "/api/admin/users/stats"],
				["GET", "/api/admin/serverinfo"],
				["GET", "/api/admin/changelog"],
				["GET", "/api/admin/page"],
				["GET", "/api/admin/gameinfo"],
				["GET", "/api/admin/loki/labels"],
				["GET", "/api/admin/errors"],
			];
			for (const [method, path] of routes) {
				assert.strictEqual((await api(method, path, newsletterAdmin)).status, 403, `${method} ${path}`);
			}
		});

		it("a newsletter admin cannot escalate: authority/grants routes stay out of reach", async () => {
			const authority = await api(
				"POST",
				`/api/admin/users/${newsletterAdminId.toHexString()}/authority`,
				newsletterAdmin,
				{
					authority: "admin",
				},
			);
			assert.strictEqual(authority.status, 403);
			const grants = await api("PUT", `/api/admin/users/${newsletterAdminId.toHexString()}/grants`, newsletterAdmin, {
				adminGrants: ["users", "newsletter"],
			});
			assert.strictEqual(grants.status, 403);

			const doc = await colls.users.findOne({ _id: newsletterAdminId });
			assert.strictEqual(doc?.authority, undefined);
			assert.deepStrictEqual(doc?.adminGrants, ["newsletter"]);
		});
	});

	describe("per-boardgame scoping (gameinfo:<game>)", () => {
		it("gameinfo list is filtered to the granted games", async () => {
			const res = await api("GET", "/api/admin/gameinfo", gameAdminA);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const list = res.data as { _id: string }[];
			assert.ok(list.length > 0);
			assert.ok(
				list.every((v) => v._id === "game-a"),
				JSON.stringify(list),
			);

			const full = await api("GET", "/api/admin/gameinfo", fullAdmin);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const fullList = full.data as { _id: string }[];
			assert.ok(fullList.some((v) => v._id === "game-b"));
		});

		it("can upsert the granted game's versions, denied on another game", async () => {
			const own = await api("POST", "/api/admin/gameinfo/game-a/2", gameAdminA, {
				viewer: { url: "https://example.com/game-a/v2.js" },
				public: false,
			});
			assert.strictEqual(own.status, 200, JSON.stringify(own.data));

			const other = await api("POST", "/api/admin/gameinfo/game-b/2", gameAdminA, {
				viewer: { url: "https://example.com/game-b/v2.js" },
				public: false,
			});
			assert.strictEqual(other.status, 403);
			assert.strictEqual(await colls.gameInfos.countDocuments({ _id: { game: "game-b", version: 2 } }), 0);
		});

		it("can edit the granted game's metadata, denied on another game", async () => {
			const own = await api("PUT", "/api/admin/gameinfo/game-a/meta", gameAdminA, { label: "Game A" });
			assert.strictEqual(own.status, 200, JSON.stringify(own.data));

			const other = await api("PUT", "/api/admin/gameinfo/game-b/meta", gameAdminA, { label: "Game B" });
			assert.strictEqual(other.status, 403);
		});

		it("can manage beta users of the granted game only", async () => {
			const target = await colls.users.findOne({ _id: userId });
			assert.ok(target);

			const own = await api("POST", "/api/admin/gameinfo/game-a/beta-users", gameAdminA, {
				usernameOrEmail: target.account.username,
			});
			assert.strictEqual(own.status, 200, JSON.stringify(own.data));
			assert.ok(
				await colls.gamePreferences.findOne({ user: userId, game: "game-a", "access.maxVersion": { $exists: true } }),
			);

			const other = await api("POST", "/api/admin/gameinfo/game-b/beta-users", gameAdminA, {
				usernameOrEmail: target.account.username,
			});
			assert.strictEqual(other.status, 403);
			assert.strictEqual(await colls.gamePreferences.countDocuments({ user: userId, game: "game-b" }), 0);

			const del = await api("DELETE", `/api/admin/gameinfo/game-a/beta-users/${userId.toHexString()}`, gameAdminA);
			assert.strictEqual(del.status, 200);
			const delOther = await api("DELETE", `/api/admin/gameinfo/game-b/beta-users/${userId.toHexString()}`, gameAdminA);
			assert.strictEqual(delOther.status, 403);
		});

		it("the beta-users list is scoped to the granted game (it exposes usernames)", async () => {
			const own = await api("GET", "/api/admin/gameinfo/game-a/beta-users", gameAdminA);
			assert.strictEqual(own.status, 200, JSON.stringify(own.data));

			const other = await api("GET", "/api/admin/gameinfo/game-b/beta-users", gameAdminA);
			assert.strictEqual(other.status, 403);

			// The blanket gameinfo/games admin reads any game's beta users.
			assert.strictEqual((await api("GET", "/api/admin/gameinfo/game-b/beta-users", gamesAdmin)).status, 200);
		});

		it("can grant/revoke beta access through the user-centric routes for the granted game only", async () => {
			const grant = await api("POST", `/api/admin/users/${userId.toHexString()}/access/grant`, gameAdminA, {
				type: "game",
				game: "game-a",
				version: "latest",
			});
			assert.strictEqual(grant.status, 200, JSON.stringify(grant.data));

			const grantOther = await api("POST", `/api/admin/users/${userId.toHexString()}/access/grant`, gameAdminA, {
				type: "game",
				game: "game-b",
				version: "latest",
			});
			assert.strictEqual(grantOther.status, 403);

			const revoke = await api("DELETE", `/api/admin/users/${userId.toHexString()}/access/game-a`, gameAdminA);
			assert.strictEqual(revoke.status, 200);
			const revokeOther = await api("DELETE", `/api/admin/users/${userId.toHexString()}/access/game-b`, gameAdminA);
			assert.strictEqual(revokeOther.status, 403);

			// A global "users" admin manages beta grants for ANY game (user-centric view).
			const usersGrant = await api("POST", `/api/admin/users/${userId.toHexString()}/access/grant`, usersAdmin, {
				type: "game",
				game: "game-b",
				version: "latest",
			});
			assert.strictEqual(usersGrant.status, 200, JSON.stringify(usersGrant.data));
			const usersRevoke = await api("DELETE", `/api/admin/users/${userId.toHexString()}/access/game-b`, usersAdmin);
			assert.strictEqual(usersRevoke.status, 200);
		});

		it("cannot delete or archive another game's versions", async () => {
			assert.strictEqual((await api("DELETE", "/api/admin/gameinfo/game-b/1", gameAdminA)).status, 403);
			assert.strictEqual((await api("POST", "/api/admin/gameinfo/game-b/1/archive", gameAdminA, {})).status, 403);
			assert.strictEqual((await api("POST", "/api/admin/gameinfo/game-b/1/unarchive", gameAdminA, {})).status, 403);
			assert.ok(await colls.gameInfos.findOne({ _id: { game: "game-b", version: 1 } }));
		});

		it("a global games admin manages every game's info too", async () => {
			const res = await api("POST", "/api/admin/gameinfo/game-a/3", gamesAdmin, {
				viewer: { url: "https://example.com/game-a/v3.js" },
				public: false,
			});
			assert.strictEqual(res.status, 200, "global games admin manages every game's info too");
			await colls.gameInfos.deleteOne({ _id: { game: "game-a", version: 3 } });
		});
	});

	describe("per-boardgame CMS pages (gameinfo:<slug> → <slug>:<topic> pages)", () => {
		const pageBody = { title: "Maps", content: "# Maps" };

		async function insertPage(name: string, lang = "en") {
			await colls.pages.insertOne({
				_id: { name, lang },
				title: name,
				content: `# ${name}`,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
		}

		it("a per-boardgame admin can upsert/edit/delete their game's pages", async () => {
			const create = await api("PUT", "/api/admin/page/game-a:maps/en", gameAdminA, pageBody);
			assert.strictEqual(create.status, 200, JSON.stringify(create.data));
			assert.ok(await colls.pages.findOne({ _id: { name: "game-a:maps", lang: "en" } }));

			const edit = await api("PUT", "/api/admin/page/game-a:maps/en", gameAdminA, {
				...pageBody,
				content: "# Updated",
			});
			assert.strictEqual(edit.status, 200);

			const read = await api("GET", "/api/admin/page/game-a:maps/en", gameAdminA);
			assert.strictEqual(read.status, 200);

			const del = await api("DELETE", "/api/admin/page/game-a:maps/en", gameAdminA);
			assert.strictEqual(del.status, 200);
			assert.strictEqual(await colls.pages.countDocuments({ _id: { name: "game-a:maps", lang: "en" } }), 0);
		});

		it("can read page history for their game's pages", async () => {
			await api("PUT", "/api/admin/page/game-a:rules/en", gameAdminA, { title: "Rules", content: "v1" });
			await api("PUT", "/api/admin/page/game-a:rules/en", gameAdminA, { title: "Rules", content: "v2" });

			const history = await api("GET", "/api/admin/page/game-a:rules/en/history", gameAdminA);
			assert.strictEqual(history.status, 200, JSON.stringify(history.data));
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.ok((history.data as unknown[]).length >= 1);

			await api("DELETE", "/api/admin/page/game-a:rules/en", gameAdminA);
		});

		it("is DENIED on another game's pages and on non-game pages", async () => {
			// Another game's page (game-b is a real game, not granted to gameAdminA).
			assert.strictEqual((await api("PUT", "/api/admin/page/game-b:auction/en", gameAdminA, pageBody)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/page/game-b:auction/en", gameAdminA)).status, 403);
			assert.strictEqual((await api("DELETE", "/api/admin/page/game-b:auction/en", gameAdminA)).status, 403);
			assert.strictEqual(await colls.pages.countDocuments({ _id: { name: "game-b:auction", lang: "en" } }), 0);

			// A non-game page (no <slug>: prefix).
			assert.strictEqual((await api("PUT", "/api/admin/page/privacy-policy/en", gameAdminA, pageBody)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/page/privacy-policy/en", gameAdminA)).status, 403);
			assert.strictEqual((await api("DELETE", "/api/admin/page/privacy-policy/en", gameAdminA)).status, 403);

			// A <slug>: page whose slug is no game at all stays blanket-pages-only.
			assert.strictEqual(
				(await api("PUT", "/api/admin/page/game-badges:auction/en", gameAdminA, pageBody)).status,
				403,
			);
		});

		it("the blanket pages admin manages ALL pages (game pages and non-game)", async () => {
			assert.strictEqual((await api("PUT", "/api/admin/page/game-a:maps/en", pagesAdmin, pageBody)).status, 200);
			assert.strictEqual((await api("PUT", "/api/admin/page/game-b:auction/en", pagesAdmin, pageBody)).status, 200);
			assert.strictEqual((await api("PUT", "/api/admin/page/privacy-policy/en", pagesAdmin, pageBody)).status, 200);
			assert.strictEqual(
				(await api("PUT", "/api/admin/page/game-badges:auction/en", pagesAdmin, pageBody)).status,
				200,
			);

			await colls.pages.deleteMany({
				"_id.name": { $in: ["game-a:maps", "game-b:auction", "privacy-policy", "game-badges:auction"] },
			});
		});

		it("the GET list is filtered to the pages the scoped admin can manage", async () => {
			await insertPage("game-a:maps");
			await insertPage("game-b:auction");
			await insertPage("privacy-policy");

			const scoped = await api("GET", "/api/admin/page", gameAdminA);
			assert.strictEqual(scoped.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const scopedNames = (scoped.data as { _id: { name: string } }[]).map((p) => p._id.name);
			assert.ok(scopedNames.includes("game-a:maps"), JSON.stringify(scopedNames));
			assert.ok(!scopedNames.includes("game-b:auction"), "another game's page hidden");
			assert.ok(!scopedNames.includes("privacy-policy"), "non-game page hidden");

			const full = await api("GET", "/api/admin/page", pagesAdmin);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const fullNames = (full.data as { _id: { name: string } }[]).map((p) => p._id.name);
			assert.ok(
				fullNames.includes("game-a:maps") &&
					fullNames.includes("game-b:auction") &&
					fullNames.includes("privacy-policy"),
			);

			await colls.pages.deleteMany({ "_id.name": { $in: ["game-a:maps", "game-b:auction", "privacy-policy"] } });
		});
	});

	describe("games cancel scoping", () => {
		async function insertActiveGame(game: string) {
			const { insertedId } = await colls.games.insertOne(
				testGame({
					_id: new ObjectId().toHexString(),
					game: { name: game, version: 1 },
					status: "active",
					creator: new ObjectId(),
					players: [{ _id: new ObjectId(), name: "alice" }],
					currentPlayers: [{ _id: new ObjectId(), timerStart: new Date() }],
				}),
			);
			return insertedId.toString();
		}

		it("a per-boardgame admin cancels their game's games, not another game's", async () => {
			const ownGameId = await insertActiveGame("game-a");
			const own = await api("POST", `/api/admin/games/${ownGameId}/cancel`, gameAdminA);
			assert.strictEqual(own.status, 200, JSON.stringify(own.data));
			assert.strictEqual((await colls.games.findOne({ _id: ownGameId }))?.cancelled, true);

			const otherGameId = await insertActiveGame("game-b");
			const other = await api("POST", `/api/admin/games/${otherGameId}/cancel`, gameAdminA);
			assert.strictEqual(other.status, 403);
			assert.strictEqual((await colls.games.findOne({ _id: otherGameId }))?.status, "active");
		});

		it("a global games admin cancels any game; a newsletter admin none", async () => {
			const gameId = await insertActiveGame("game-b");
			assert.strictEqual((await api("POST", `/api/admin/games/${gameId}/cancel`, newsletterAdmin)).status, 403);
			assert.strictEqual((await api("POST", `/api/admin/games/${gameId}/cancel`, gamesAdmin)).status, 200);
		});

		it("game detail view follows the same scoping", async () => {
			const gameId = await insertActiveGame("game-a");
			assert.strictEqual((await api("GET", `/api/admin/games/${gameId}`, gameAdminA)).status, 200);

			const otherGameId = await insertActiveGame("game-b");
			assert.strictEqual((await api("GET", `/api/admin/games/${otherGameId}`, gameAdminA)).status, 403);
			assert.strictEqual((await api("GET", `/api/admin/games/${otherGameId}`, gamesAdmin)).status, 200);
		});
	});

	describe("non-admin game routes", () => {
		it("a per-boardgame admin can chat as a non-player in their game, not in another", async () => {
			const ownGameId = new ObjectId().toHexString();
			await colls.games.insertOne(
				testGame({
					_id: ownGameId,
					game: { name: "game-a", version: 1 },
					status: "active",
					creator: new ObjectId(),
					players: [{ _id: new ObjectId(), name: "alice" }],
				}),
			);
			const own = await api("POST", `/api/game/${ownGameId}/chat`, gameAdminA, {
				type: "text",
				data: { text: "admin looking in" },
			});
			assert.strictEqual(own.status, 200, JSON.stringify(own.data));

			const otherGameId = new ObjectId().toHexString();
			await colls.games.insertOne(
				testGame({
					_id: otherGameId,
					game: { name: "game-b", version: 1 },
					status: "active",
					creator: new ObjectId(),
					players: [{ _id: new ObjectId(), name: "alice" }],
				}),
			);
			const other = await api("POST", `/api/game/${otherGameId}/chat`, gameAdminA, {
				type: "text",
				data: { text: "should not land" },
			});
			assert.notStrictEqual(other.status, 200, "the chat message must not be accepted");
			assert.strictEqual(await colls.chatMessages.countDocuments({ room: otherGameId }), 0);
		});

		it("a per-boardgame admin can delete their game through the game route, not another's", async () => {
			const ownGameId = new ObjectId().toHexString();
			await colls.games.insertOne(
				testGame({
					_id: ownGameId,
					game: { name: "game-a", version: 1 },
					status: "active",
					creator: new ObjectId(),
					players: [{ _id: new ObjectId(), name: "alice" }],
				}),
			);
			assert.strictEqual((await api("DELETE", `/api/game/${ownGameId}`, gameAdminA)).status, 200);
			assert.strictEqual(await colls.games.countDocuments({ _id: ownGameId }), 0);

			const otherGameId = new ObjectId().toHexString();
			await colls.games.insertOne(
				testGame({
					_id: otherGameId,
					game: { name: "game-b", version: 1 },
					status: "active",
					creator: new ObjectId(),
					players: [{ _id: new ObjectId(), name: "alice" }],
				}),
			);
			assert.strictEqual((await api("DELETE", `/api/game/${otherGameId}`, gameAdminA)).status, 403);
			assert.strictEqual(await colls.games.countDocuments({ _id: otherGameId }), 1);

			assert.strictEqual((await api("DELETE", `/api/game/${otherGameId}`, regularUser)).status, 403);
		});
	});

	describe("admin tokens of scoped admins", () => {
		it("a scoped admin can mint a token, which only exercises their grants", async () => {
			const created = await api("POST", "/api/admin/tokens", tokensAdmin, { name: "scoped ci", ttlDays: 1 });
			assert.strictEqual(created.status, 201, JSON.stringify(created.data));
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { token } = created.data as { token: string };

			const bearer = { Authorization: `Bearer ${token}` };
			assert.strictEqual((await api("GET", "/api/admin/tokens", bearer)).status, 200);
			assert.strictEqual((await api("GET", "/api/admin/users/stats", bearer)).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/serverinfo", bearer)).status, 403);
		});

		it("a per-boardgame admin's token manages their game only", async () => {
			const { token } = await createAdminToken(gameAdminAId, "game-a-ci", DAY_MS);
			const bearer = { Authorization: `Bearer ${token}` };

			const list = await api("GET", "/api/admin/gameinfo", bearer);
			assert.strictEqual(list.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.ok((list.data as { _id: string }[]).every((v) => v._id === "game-a"));

			const denied = await api("POST", "/api/admin/gameinfo/game-b/9", bearer, {
				viewer: { url: "https://example.com/x.js" },
				public: false,
			});
			assert.strictEqual(denied.status, 403);
			assert.strictEqual((await api("GET", "/api/admin/users/stats", bearer)).status, 403);
		});

		it("a token dies when the owner's last grant is revoked, and a regular user cannot mint one", async () => {
			const { token } = await createAdminToken(tokensAdminId, "doomed", DAY_MS);
			const bearer = { Authorization: `Bearer ${token}` };
			assert.strictEqual((await api("GET", "/api/admin/tokens", bearer)).status, 200);

			await colls.users.updateOne({ _id: tokensAdminId }, { $unset: { adminGrants: "" } });
			assert.strictEqual((await api("GET", "/api/admin/tokens", bearer)).status, 403);

			await colls.users.updateOne({ _id: tokensAdminId }, { $set: { adminGrants: ["tokens"] } });
			assert.strictEqual((await api("GET", "/api/admin/tokens", bearer)).status, 200);

			assert.strictEqual((await api("POST", "/api/admin/tokens", regularUser, { name: "nope" })).status, 403);
		});
	});

	describe("authority & grants management routes", () => {
		it("grants can be set, deduplicated, and cleared", async () => {
			const targetId = new ObjectId();
			await colls.users.insertOne(testUser({ _id: targetId }));

			const set = await api("PUT", `/api/admin/users/${targetId.toHexString()}/grants`, fullAdmin, {
				adminGrants: ["newsletter", "gameinfo:game-a", "newsletter"],
			});
			assert.strictEqual(set.status, 200);
			assert.deepStrictEqual((await colls.users.findOne({ _id: targetId }))?.adminGrants, [
				"newsletter",
				"gameinfo:game-a",
			]);

			const clear = await api("PUT", `/api/admin/users/${targetId.toHexString()}/grants`, fullAdmin, {
				adminGrants: [],
			});
			assert.strictEqual(clear.status, 200);
			assert.strictEqual((await colls.users.findOne({ _id: targetId }))?.adminGrants, undefined);
		});

		it("rejects invalid grant values", async () => {
			const targetId = new ObjectId();
			await colls.users.insertOne(testUser({ _id: targetId }));

			for (const adminGrants of [["bogus"], ["gameinfo:"], ["gameinfo:BAD GAME"], [42]]) {
				const res = await api("PUT", `/api/admin/users/${targetId.toHexString()}/grants`, fullAdmin, { adminGrants });
				assert.strictEqual(res.status, 400, JSON.stringify(adminGrants));
			}
			assert.strictEqual((await colls.users.findOne({ _id: targetId }))?.adminGrants, undefined);
		});

		it("demoting to user clears authority AND grants atomically", async () => {
			const targetId = new ObjectId();
			await colls.users.insertOne(testUser({ _id: targetId, authority: "admin", adminGrants: ["newsletter"] }));

			const res = await api("POST", `/api/admin/users/${targetId.toHexString()}/authority`, fullAdmin, {
				authority: "user",
			});
			assert.strictEqual(res.status, 200);

			const doc = await colls.users.findOne({ _id: targetId });
			assert.strictEqual(doc?.authority, undefined);
			assert.strictEqual(doc?.adminGrants, undefined);
		});

		it("promoting to admin can carry grants; promoting without grants leaves them untouched", async () => {
			const withGrantsId = new ObjectId();
			await colls.users.insertOne(testUser({ _id: withGrantsId }));
			const res = await api("POST", `/api/admin/users/${withGrantsId.toHexString()}/authority`, fullAdmin, {
				authority: "admin",
				adminGrants: ["newsletter"],
			});
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual((await colls.users.findOne({ _id: withGrantsId }))?.adminGrants, ["newsletter"]);

			const plainId = new ObjectId();
			await colls.users.insertOne(testUser({ _id: plainId, adminGrants: ["pages"] }));
			const res2 = await api("POST", `/api/admin/users/${plainId.toHexString()}/authority`, fullAdmin, {
				authority: "admin",
			});
			assert.strictEqual(res2.status, 200);
			const doc = await colls.users.findOne({ _id: plainId });
			assert.strictEqual(doc?.authority, "admin");
			assert.deepStrictEqual(doc?.adminGrants, ["pages"]);
		});

		it("the grants route is users-permission gated", async () => {
			const targetId = new ObjectId();
			await colls.users.insertOne(testUser({ _id: targetId }));
			assert.strictEqual(
				(
					await api("PUT", `/api/admin/users/${targetId.toHexString()}/grants`, newsletterAdmin, {
						adminGrants: ["newsletter"],
					})
				).status,
				403,
			);
			assert.strictEqual(
				(await api("PUT", `/api/admin/users/${targetId.toHexString()}/grants`, regularUser, { adminGrants: [] }))
					.status,
				403,
			);
		});

		it("GET /admin/users/admins lists full and scoped admins with their grants", async () => {
			const res = await api("GET", "/api/admin/users/admins", fullAdmin);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const admins = res.data as { _id: string; authority?: string; adminGrants: string[] }[];

			const full = admins.find((a) => a._id === fullAdminId.toHexString());
			assert.strictEqual(full?.authority, "admin");

			const scoped = admins.find((a) => a._id === gameAdminAId.toHexString());
			assert.deepStrictEqual(scoped?.adminGrants, ["gameinfo:game-a"]);

			assert.ok(!admins.some((a) => a._id === userId.toHexString()), "regular users are not listed");
		});
	});
});
