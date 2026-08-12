import checkDiskSpace from "check-disk-space";
import fs from "node:fs";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import path from "node:path";
import { env } from "../../config/index.ts";
import { colls, nodebbColls } from "../../config/db.ts";
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
import { isAdmin } from "../utils.ts";
import changelogRouter from "./changelog.ts";
import gameInfo from "./gameinfo.ts";
import gamesRouter from "./games.ts";
import loki from "./loki.ts";
import pagesRouter from "./pages.ts";
import tokensRouter from "./tokens.ts";
import usersRouter from "./users.ts";

const router = new Router<Application.DefaultState, Context>();

router.use(isAdmin);

router.use("/changelog", changelogRouter.routes(), changelogRouter.allowedMethods());
router.use("/gameinfo", gameInfo.routes(), gameInfo.allowedMethods());
router.use("/games", gamesRouter.routes(), gamesRouter.allowedMethods());
router.use("/loki", loki.routes(), loki.allowedMethods());
router.use("/page", pagesRouter.routes(), pagesRouter.allowedMethods());
router.use("/tokens", tokensRouter.routes(), tokensRouter.allowedMethods());
router.use("/users", usersRouter.routes(), usersRouter.allowedMethods());

interface ForumHealth {
	ok: boolean;
	/** HTTP status from the probe; null when the request never got a response (timeout, DNS, …). */
	status: number | null;
	/** Forum db stats; null when the (read-only) NodeBB db is unreachable. */
	stats: ForumStats | null;
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
		// All three counts use the `_key` index (or a single doc read), so the
		// queries stay cheap even on a large `objects` collection.
		const [users, linkDoc, usersWithPosts, postIds] = await Promise.all([
			nodebb.objects.countDocuments({ _key: /^user:\d+$/ }),
			nodebb.objects.findOne({ _key: "boardgamersId:uid" }, { projection: { _id: 0 } }),
			nodebb.objects.countDocuments({ _key: /^user:\d+$/, postcount: { $gt: 0 } }),
			nodebb.objects.countDocuments({ _key: /^pid:\d+$/ }),
		]);
		// Every field except _key is a linked bgs user id → forum uid.
		const linked = Object.keys(linkDoc ?? {}).filter((k) => k !== "_key").length;
		return { users, linked, usersWithPosts, posts: postIds };
	} catch (err) {
		console.error("[serverinfo] forum stats lookup failed — returning null stats", err);
		return null;
	}
}

const errorsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	// Filter by error name — e.g. name=EngineTimeoutError lists game-engine hangs/timeouts.
	name: z.string().optional(),
});

// GET /api/admin/errors — genuine errors from the apierrors DB collection
// (uncaught exceptions, assertion failures — not routine 4xx HTTP responses).
// Supports pagination: ?page=1&limit=20 → { errors: [...], total, page, limit }
router.get("/errors", async (ctx) => {
	const { page, limit, name } = errorsQuerySchema.parse(ctx.query);
	const filter = name ? { "error.name": name } : {};
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

router.get("/backup/games", async (ctx) => {
	ctx.set({ "Content-Type": "application/gzip", "Content-Disposition": 'attachment; filename="games.bson.gz"' });
	ctx.body = fs.createReadStream(`../../../dump/${env.database.bgs.name}/games.bson.gz`);
});

router.get("/serverinfo", async (ctx) => {
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
	] = await Promise.all([
		checkDiskSpace(process.cwd()),
		colls.users.countDocuments({}),
		colls.users.countDocuments({ authority: "admin" }),
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
	]);

	const forum: ForumHealth = { ...forumHealth, stats: forumStats };

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

router.post("/resend-confirmation", async (ctx) => {
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

router.post("/login-as", async (ctx) => {
	const { username } = z.object({ username: z.string() }).parse(ctx.request.body);
	const user = await findByUsername(username);

	if (!user) {
		throw createError(404, "User not found: " + username);
	}

	ctx.state.user = user;

	await sendAuthInfo(ctx, "admin");
});

router.post("/compute-karma", async (ctx) => {
	const { username } = z.object({ username: z.string() }).parse(ctx.request.body);
	const user = await findByUsername(username);

	if (!user) {
		throw createError(404, "User not found: " + username);
	}

	await recalculateKarma(user);
	await colls.users.replaceOne({ _id: user._id }, user);

	ctx.status = 200;
});

router.post("/compute-all-karma", async (ctx) => {
	for (const user of await colls.users.find().toArray()) {
		await recalculateKarma(user, new Date("2020-05-10"));
		await colls.users.replaceOne({ _id: user._id }, user);
	}

	ctx.status = 200;
});

router.post("/load-games", async (ctx) => {
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

router.post("/recreate-notifications", async (ctx) => {
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
