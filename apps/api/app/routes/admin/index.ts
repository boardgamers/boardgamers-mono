import checkDiskSpace from "check-disk-space";
import fs from "node:fs";
import createError from "http-errors";
import type { Context, Next } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import path from "node:path";
import { env } from "../../config/index.ts";
import { colls, nodebbColls, type NodebbObject } from "../../config/db.ts";
import {
	authEmailOnCooldown,
	findByEmail,
	findByUsername,
	generateConfirmKey,
	hashUserSecret,
	markAuthEmailSent,
	recalculateKarma,
	sendConfirmationEmail,
} from "../../models/index.ts";
import { sendAuthInfo } from "../account/index.ts";
import { z } from "zod";
import { grantSatisfies, isGameAdminGrant, userPermissions, type AdminPermission } from "@bgs/models";
import { requirePermission } from "../utils.ts";
import changelogRouter from "./changelog.ts";
import feedbackRouter from "./feedback.ts";
import gameInfo from "./gameinfo.ts";
import gamesRouter from "./games.ts";
import loki from "./loki.ts";
import pagesRouter from "./pages.ts";
import tokensRouter from "./tokens.ts";
import usersRouter from "./users.ts";

const router = new Router<Application.DefaultState, Context>();

// Each sub-router declares the permission it needs. The mount-level gate is a
// SUBSET check — the caller must hold at least one grant satisfying the
// permission (grantSatisfies: a full admin holds them all; a per-boardgame
// `gameinfo:<game>` grant also satisfies gameinfo/games/users/pages, for the
// per-game routes inside those routers). Blanket enforcement then happens
// inside the sub-router: gameinfo/games re-check the grant against the target
// game of every write, users blanket-gates everything but the beta-grant
// routes, pages re-checks the page's game slug, and the other routers are
// blanket-gated with requirePermission.
const requireSomeGrant = (permission: AdminPermission) => {
	return async (ctx: Context, next: Next) => {
		const permissions = userPermissions(ctx.state.user);
		if (![...permissions].some((grant) => grantSatisfies(grant, permission))) {
			throw createError(403, `Missing admin permission: ${permission}`);
		}
		await next();
	};
};

router.use("/changelog", requirePermission("changelog"), changelogRouter.routes(), changelogRouter.allowedMethods());
router.use("/feedback", requirePermission("feedback"), feedbackRouter.routes(), feedbackRouter.allowedMethods());
router.use("/gameinfo", requireSomeGrant("gameinfo"), gameInfo.routes(), gameInfo.allowedMethods());
router.use("/games", requireSomeGrant("games"), gamesRouter.routes(), gamesRouter.allowedMethods());
router.use("/loki", requirePermission("loki"), loki.routes(), loki.allowedMethods());
// /page gets the subset gate: a per-boardgame admin (gameinfo:<slug>) manages
// their game's CMS pages — every route inside re-checks the page's slug.
router.use("/page", requireSomeGrant("pages"), pagesRouter.routes(), pagesRouter.allowedMethods());
router.use("/tokens", requirePermission("tokens"), tokensRouter.routes(), tokensRouter.allowedMethods());
// /users gets the subset gate, not the blanket one: the per-game beta-grant
// routes inside (/:userId/access/*) are reachable by per-boardgame admins —
// everything else in the router is blanket-gated on "users".
router.use("/users", requireSomeGrant("users"), usersRouter.routes(), usersRouter.allowedMethods());

// GET /api/admin/me — the caller's own admin permissions (drives the admin
// panel's gating). Any authenticated user may ask; non-admins get an empty set.
router.get("/me", async (ctx) => {
	const user = ctx.state.user;
	if (!user) {
		throw createError(401, "You need to be logged in");
	}
	const permissions = userPermissions(user);
	ctx.body = {
		fullAdmin: user.authority === "admin",
		permissions: [...permissions].filter((p) => !isGameAdminGrant(p)),
		games: [...permissions].flatMap((p) => (isGameAdminGrant(p) ? [p.slice("gameinfo:".length)] : [])),
	};
});

interface ForumHealth {
	ok: boolean;
	/** HTTP status from the probe; null when the request never got a response (timeout, DNS, …). */
	status: number | null;
	/** Forum db stats; null when the (read-only) NodeBB db is unreachable. */
	stats: ForumStats | null;
	/** bgs↔forum account sync drift; null when the NodeBB db is unreachable. */
	forumSync: ForumSync | null;
}

/** Drift on one linked pair — only the fields that differ are present. */
interface ForumSyncSample {
	forumUsername: string | null;
	bgsUsername: string | null;
	forumEmail: string | null;
	bgsEmail: string | null;
}

interface ForumSync {
	linkedTotal: number;
	/** Forum username ≠ bgs username (case-sensitive; forum may hold a sanitized form). */
	usernameMismatch: number;
	/** Forum email ≠ bgs email (case-insensitive, absent and "" treated as equal). */
	emailMismatch: number;
	/** Linked bgs users whose security.confirmed is false. */
	unconfirmedLinked: number;
	/** Up to 10 drifted pairs, so the admin can see who. */
	sample: ForumSyncSample[];
}

interface ForumStats {
	users: number;
	linked: number;
	usersWithPosts: number;
	posts: number;
}

// Pings the forum's public API. Never throws: the dashboard must render even
// when the forum (or the network path to it) is down.
async function checkForumHealth(): Promise<Pick<ForumHealth, "ok" | "status">> {
	try {
		const res = await fetch(`${env.forumUrl}/api/config`, { signal: AbortSignal.timeout(3000) });
		return { ok: res.ok, status: res.status };
	} catch {
		return { ok: false, status: null };
	}
}

// Cheap, batched reads of the NodeBB `objects` store. Never throws: a down or
// erroring forum db yields null stats, not a failed endpoint.
async function loadForumStats(): Promise<ForumStats | null> {
	const nodebb = await nodebbColls();
	if (!nodebb) {
		return null;
	}
	try {
		// All counts are `_key`-indexed or single-doc reads, staying cheap even on a
		// large `objects` collection. Posts use NodeBB's canonical `global.postCount`
		// counter — NodeBB stores posts as `post:<pid>` docs, not `pid:<pid>`.
		const [users, linkDoc, usersWithPosts, globalDoc] = await Promise.all([
			nodebb.objects.countDocuments({ _key: /^user:\d+$/ }),
			nodebb.objects.findOne({ _key: "boardgamersId:uid" }, { projection: { _id: 0 } }),
			nodebb.objects.countDocuments({ _key: /^user:\d+$/, postcount: { $gt: 0 } }),
			nodebb.objects.findOne({ _key: "global" }, { projection: { _id: 0, postCount: 1 } }),
		]);
		// Every field except _key is a linked bgs user id → forum uid.
		const linked = Object.keys(linkDoc ?? {}).filter((k) => k !== "_key").length;
		const posts = typeof globalDoc?.postCount === "number" ? globalDoc.postCount : 0;
		return { users, linked, usersWithPosts, posts };
	} catch (err) {
		console.error("[serverinfo] forum stats lookup failed — returning null stats", err);
		return null;
	}
}

const absentEmail = (value: unknown): value is null | undefined | "" => typeof value !== "string" || value === "";

// bgs↔forum account drift over the linked pairs in `boardgamersId:uid`. Login-time
// SSO sync self-heals a pair on the user's next forum login — this surfaces drift
// for users who haven't logged in recently. READ-ONLY: never writes to the forum
// (the forum write API comes with #172).
//
// Batched: one read of the link doc, one $in fetch of the linked bgs users, one
// $in fetch of the forum user:<uid> docs — comparison happens in-process.
// Never throws: a down or erroring forum db yields null, not a failed endpoint.
async function loadForumSync(): Promise<ForumSync | null> {
	const nodebb = await nodebbColls();
	if (!nodebb) {
		return null;
	}
	try {
		const linkDoc = await nodebb.objects.findOne({ _key: "boardgamersId:uid" }, { projection: { _id: 0 } });
		const linkMap = Object.entries(linkDoc ?? {}).filter(
			(entry): entry is [string, number] => entry[0] !== "_key" && typeof entry[1] === "number",
		);
		// Skip unparseable bgs ids rather than throwing the whole report.
		const pairs = linkMap.flatMap(([bgsId, forumUid]) => (ObjectId.isValid(bgsId) ? [{ bgsId, forumUid }] : []));
		if (pairs.length === 0) {
			return { linkedTotal: 0, usernameMismatch: 0, emailMismatch: 0, unconfirmedLinked: 0, sample: [] };
		}

		const [bgsUsers, forumUsers] = await Promise.all([
			colls.users
				.find(
					{ _id: { $in: pairs.map((p) => new ObjectId(p.bgsId)) } },
					{ projection: { "account.username": 1, "account.email": 1, "security.confirmed": 1 } },
				)
				.toArray(),
			nodebb.objects
				.find(
					{ _key: { $in: pairs.map((p) => `user:${p.forumUid}`) } },
					// _key must be projected explicitly: an inclusion projection without
					// it drops it (unlike a naked find), and we parse the uid out of it.
					{ projection: { _key: 1, username: 1, email: 1 } },
				)
				.toArray(),
		]);
		const bgsById = new Map(bgsUsers.map((u) => [u._id.toHexString(), u]));
		const forumByUid = new Map<number, NodebbObject>();
		for (const u of forumUsers) {
			const match = /^user:(\d+)$/.exec(u._key);
			if (match) {
				forumByUid.set(Number(match[1]), u);
			}
		}

		let usernameMismatch = 0;
		let emailMismatch = 0;
		let unconfirmedLinked = 0;
		const sample: ForumSyncSample[] = [];
		for (const { bgsId, forumUid } of pairs) {
			const bgs = bgsById.get(bgsId);
			const forum = forumByUid.get(forumUid);
			const usernameDrift = typeof forum?.username === "string" && forum.username !== (bgs?.account.username ?? null);
			// The forum email is unknown-typed (schemaless objects store); only compare strings.
			const forumEmail = typeof forum?.email === "string" ? forum.email : undefined;
			const emailDrift =
				!(absentEmail(forum?.email) && absentEmail(bgs?.account.email)) &&
				forumEmail?.toLowerCase() !== bgs?.account.email?.toLowerCase();
			if (usernameDrift) {
				usernameMismatch++;
			}
			if (emailDrift) {
				emailMismatch++;
			}
			// `confirmed` is optional on the schema — legacy users never set it. Only an
			// explicit false counts as unconfirmed.
			if (bgs && bgs.security.confirmed === false) {
				unconfirmedLinked++;
			}
			if ((usernameDrift || emailDrift) && sample.length < 10) {
				sample.push({
					forumUsername: typeof forum?.username === "string" ? forum.username : null,
					bgsUsername: bgs?.account.username ?? null,
					forumEmail: typeof forum?.email === "string" ? forum.email : null,
					bgsEmail: bgs?.account.email ?? null,
				});
			}
		}
		return { linkedTotal: pairs.length, usernameMismatch, emailMismatch, unconfirmedLinked, sample };
	} catch (err) {
		console.error("[serverinfo] forum sync lookup failed — returning null forumSync", err);
		return null;
	}
}

const errorsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	// Filter by error name(s), comma-separated — e.g. name=EngineTimeoutError,SlowEngineCall
	// lists game-engine hangs/timeouts plus the slow-call early-warning trail.
	name: z.string().optional(),
	// client = browser-reported errors (meta.source "web-client"); server = everything else.
	source: z.enum(["all", "server", "client"]).default("all"),
});

// GET /api/admin/errors — genuine errors from the apierrors DB collection
// (uncaught exceptions, assertion failures — not routine 4xx HTTP responses).
// Supports pagination: ?page=1&limit=20 → { errors: [...], total, page, limit }
router.get("/errors", requirePermission("serverinfo"), async (ctx) => {
	const { page, limit, name, source } = errorsQuerySchema.parse(ctx.query);
	const filter: Record<string, unknown> = {};
	if (name) {
		const names = name
			.split(",")
			.map((n) => n.trim())
			.filter(Boolean);
		if (names.length === 1) {
			filter["error.name"] = names[0];
		} else if (names.length > 1) {
			filter["error.name"] = { $in: names };
		}
	}
	if (source === "client") {
		filter["meta.source"] = "web-client";
	} else if (source === "server") {
		filter["meta.source"] = { $ne: "web-client" };
	}
	const [errors, total] = await Promise.all([
		colls.apiErrors
			.find(filter, {
				projection: {
					"error.name": 1,
					"error.message": 1,
					"request.method": 1,
					"request.url": 1,
					"request.status": 1,
					"request.id": 1,
					// Diagnostic context (secure-cookie-over-insecure): how the request
					// reached the api — proto/host/ip and the forwarding headers.
					"request.protocol": 1,
					"request.hostname": 1,
					"request.secure": 1,
					"request.ip": 1,
					"request.ips": 1,
					"request.headers": 1,
					"meta.source": 1,
					"meta.release": 1,
					"meta.proxy": 1,
					"meta.gameId": 1,
					"meta.game": 1,
					"meta.version": 1,
					"meta.action": 1,
					// Hang/slow-call attribution (game-server): who played what, how long.
					"meta.method": 1,
					"meta.playerIndex": 1,
					"meta.playerName": 1,
					"meta.move": 1,
					"meta.elapsedMs": 1,
					user: 1,
					createdAt: 1,
				},
			})
			.sort({ createdAt: -1 })
			.skip((page - 1) * limit)
			.limit(limit)
			.toArray(),
		colls.apiErrors.countDocuments(filter),
	]);
	ctx.body = { errors, total, page, limit };
});

router.get("/backup/games", requirePermission("serverinfo"), async (ctx) => {
	ctx.set({ "Content-Type": "application/gzip", "Content-Disposition": 'attachment; filename="games.bson.gz"' });
	ctx.body = fs.createReadStream(`../../../dump/${env.database.bgs.name}/games.bson.gz`);
});

router.get("/serverinfo", requirePermission("serverinfo"), async (ctx) => {
	// Same 60s heuristic the ws layer uses for player status dots:
	// lastOnline = user marked themselves online; lastActive = ws connection alive (pong).
	const activityCutoff = new Date(Date.now() - 60 * 1000);

	const [
		disk,
		nbUsers,
		nbAdmins,
		onlineUsers,
		connectedUsers,
		gamesByStatus,
		queueByKind,
		recentUsers,
		recentGames,
		forumHealth,
		forumStats,
		forumSync,
	] = await Promise.all([
		checkDiskSpace(process.cwd()),
		colls.users.countDocuments({}),
		colls.users.countDocuments({ $or: [{ authority: "admin" }, { adminGrants: { $exists: true, $ne: [] } }] }),
		colls.users.countDocuments({ "security.lastOnline": { $gt: activityCutoff } }),
		colls.users.countDocuments({ "security.lastActive": { $gt: activityCutoff } }),
		colls.games
			.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }])
			.toArray(),
		colls.gameNotifications
			.aggregate<{ _id: string; count: number }>([
				{ $match: { processed: false } },
				{ $group: { _id: "$kind", count: { $sum: 1 } } },
			])
			.toArray(),
		colls.users
			.find({}, { projection: { _id: 1, "account.username": 1, createdAt: 1 } })
			.sort({ createdAt: -1 })
			.limit(5)
			.toArray(),
		colls.games
			.find({}, { projection: { _id: 1, "game.name": 1, status: 1, lastMove: 1, createdAt: 1 } })
			.sort({ lastMove: -1 })
			.limit(5)
			.toArray(),
		checkForumHealth(),
		loadForumStats(),
		loadForumSync(),
	]);

	const forum: ForumHealth = { ...forumHealth, stats: forumStats, forumSync };

	const games: Record<string, number> = {};
	for (const g of gamesByStatus) {
		games[g._id] = g.count;
	}

	const queue: Record<string, number> = {};
	for (const q of queueByKind) {
		queue[q._id] = q.count;
	}

	ctx.body = {
		disk,
		nbUsers,
		nbAdmins,
		onlineUsers,
		connectedUsers,
		games,
		queue,
		recentUsers,
		recentGames,
		forum,
	};
});

router.post("/resend-confirmation", requirePermission("users"), async (ctx) => {
	const { email } = z.object({ email: z.string().email() }).parse(ctx.request.body);
	const user = await findByEmail(email);

	if (!user) {
		throw createError(404, "User not found: " + email);
	}

	// Same 200 whether or not the email goes out (#195): on a cooldown skip the
	// existing confirmKey is kept so the previously emailed link keeps working.
	if (authEmailOnCooldown(user)) {
		ctx.status = 200;
		return;
	}

	// The db holds only the hash of the confirm key (#164) — mint a fresh one, store
	// its hash, and hand the plaintext to the mailer (the emailed link needs it).
	const confirmKey = generateConfirmKey();
	await colls.users.updateOne({ _id: user._id }, { $set: { "security.confirmKey": hashUserSecret(confirmKey) } });
	user.security.confirmKey = confirmKey;
	await sendConfirmationEmail(user);
	await markAuthEmailSent(user);
	ctx.status = 200;
});

router.post("/login-as", requirePermission("users"), async (ctx) => {
	const { username } = z.object({ username: z.string() }).parse(ctx.request.body);
	const user = await findByUsername(username);

	if (!user) {
		throw createError(404, "User not found: " + username);
	}

	ctx.state.user = user;

	await sendAuthInfo(ctx, "admin");
});

router.post("/compute-karma", requirePermission("users"), async (ctx) => {
	const { username } = z.object({ username: z.string() }).parse(ctx.request.body);
	const user = await findByUsername(username);

	if (!user) {
		throw createError(404, "User not found: " + username);
	}

	await recalculateKarma(user);
	await colls.users.replaceOne({ _id: user._id }, user);

	ctx.status = 200;
});

router.post("/compute-all-karma", requirePermission("users"), async (ctx) => {
	for (const user of await colls.users.find().toArray()) {
		await recalculateKarma(user, new Date("2020-05-10"));
		await colls.users.replaceOne({ _id: user._id }, user);
	}

	ctx.status = 200;
});

router.post("/load-games", requirePermission("serverinfo"), async (ctx) => {
	const { path: dirPath } = z.object({ path: z.string() }).parse(ctx.request.body);

	for (const file of fs.readdirSync(dirPath)) {
		if (!file.endsWith("json")) {
			continue;
		}
		const gameId = file.replace(/\.json$/, "");
		const json = JSON.parse(fs.readFileSync(path.join(dirPath, file)).toString("utf-8"));

		const game = await colls.games.findOne({ _id: gameId });
		if (!game) {
			continue;
		}

		Object.assign(game, json);

		await colls.games.replaceOne({ _id: gameId }, game);
	}
});

router.post("/recreate-notifications", requirePermission("serverinfo"), async (ctx) => {
	const notifications = await colls.games
		.aggregate([
			{
				$match: {
					status: "ended",
					updatedAt: {
						$gt: new Date(Date.now() - 24 * 3600 * 1000 * 10),
					},
				},
			},
			{ $project: { _id: 1 } },
			{
				$lookup: {
					from: "logs",
					localField: "_id",
					foreignField: "data.game",
					as: "log",
				},
			},
			{
				$match: {
					log: {
						$not: {
							$elemMatch: {
								kind: "processGameEnded",
							},
						},
					},
				},
			},
			{
				$lookup: {
					from: "gamenotifications",
					localField: "_id",
					foreignField: "game",
					as: "notification",
				},
			},
			{
				$match: {
					notification: {
						$not: {
							$elemMatch: {
								kind: "gameEnded",
							},
						},
					},
				},
			},
			{
				$project: {
					_id: 0,
					game: "$_id",
					kind: "gameEnded",
				},
			},
		])
		.toArray();

	if (notifications.length > 0) {
		const adminNow = new Date();
		await colls.gameNotifications.insertMany(
			notifications.map((n) => ({
				game: n.game,
				kind: n.kind,
				processed: false,
				createdAt: adminNow,
				updatedAt: adminNow,
			})),
		);
	}
	ctx.status = 200;
	ctx.body = notifications;
});

export default router;
