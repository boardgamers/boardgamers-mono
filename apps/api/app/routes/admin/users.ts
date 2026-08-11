import type { Context } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { findGameInfoWithVersion, findByUsername } from "../../models/index.ts";
import { queryCount } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

// GET /api/admin/users/admins — list all admin users with activity info
router.get("/admins", async (ctx) => {
	const admins = await colls.users
		.find({ authority: "admin" }, { projection: { account: 1, createdAt: 1, security: 1 } })
		.sort({ createdAt: 1 })
		.toArray();

	// Batch-count games for all admins in one aggregation
	const adminIds = admins.map((a) => a._id);
	const gameCounts = await colls.games
		.aggregate<{ _id: ObjectId; total: number; active: number; ended: number }>([
			{ $match: { "players._id": { $in: adminIds } } },
			{ $unwind: "$players" },
			{ $match: { "players._id": { $in: adminIds } } },
			{
				$group: {
					_id: "$players._id",
					total: { $sum: 1 },
					active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
					ended: { $sum: { $cond: [{ $eq: ["$status", "ended"] }, 1, 0] } },
				},
			},
		])
		.toArray();

	const gameCountMap = new Map(gameCounts.map((g) => [g._id.toString(), g]));

	ctx.body = admins.map((a) => {
		const gc = gameCountMap.get(a._id.toString());
		return {
			_id: a._id,
			account: a.account,
			createdAt: a.createdAt,
			security: {
				lastOnline: a.security?.lastOnline,
				lastActive: a.security?.lastActive,
				lastLogin: a.security?.lastLogin,
			},
			games: gc ? { total: gc.total, active: gc.active, ended: gc.ended } : { total: 0, active: 0, ended: 0 },
		};
	});
});

// GET /api/admin/users/stats — user metrics for dashboard chart
router.get("/stats", async (ctx) => {
	const days = 30;
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	// Truncate to start of day
	since.setHours(0, 0, 0, 0);

	const activityCutoff = new Date(Date.now() - 60 * 1000);

	const [newUsersByDay, confirmedCount, adminCount, onlineCount, connectedCount] = await Promise.all([
		colls.users
			.aggregate<{ _id: string; count: number }>([
				{ $match: { createdAt: { $gte: since } } },
				{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
				{ $sort: { _id: 1 } },
			])
			.toArray(),
		colls.users.countDocuments({ "security.confirmed": true }),
		colls.users.countDocuments({ authority: "admin" }),
		colls.users.countDocuments({ "security.lastOnline": { $gt: activityCutoff } }),
		colls.users.countDocuments({ "security.lastActive": { $gt: activityCutoff } }),
	]);

	// Fill in missing days with 0
	const dateMap = new Map(newUsersByDay.map((d) => [d._id, d.count]));
	const dailyData: { date: string; count: number }[] = [];
	for (let i = 0; i < days; i++) {
		const d = new Date(since);
		d.setDate(d.getDate() + i);
		const dateStr = d.toISOString().slice(0, 10);
		dailyData.push({ date: dateStr, count: dateMap.get(dateStr) ?? 0 });
	}

	const totalUsers = await colls.users.countDocuments({});

	ctx.body = {
		totalUsers,
		confirmedUsers: confirmedCount,
		adminUsers: adminCount,
		onlineUsers: onlineCount,
		connectedUsers: connectedCount,
		newUsersByDay: dailyData,
	};
});

// GET /api/admin/users/deleted — paginated list of archived (soft-deleted) users,
// most recently archived first. Read-only: restore is manual via the DB.
const deletedUsersQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/deleted", async (ctx) => {
	const { page, limit } = deletedUsersQuerySchema.parse(ctx.query);
	const [users, total] = await Promise.all([
		colls.deletedUsers
			.find(
				{},
				{
					projection: {
						userId: 1,
						"account.username": 1,
						"account.email": 1,
						createdAt: 1,
						deletedAt: 1,
					},
				},
			)
			.sort({ deletedAt: -1 })
			.skip((page - 1) * limit)
			.limit(limit)
			.toArray(),
		colls.deletedUsers.countDocuments({}),
	]);
	ctx.body = { users, total, page, limit };
});

const userSearchQuerySchema = z.object({
	search: z.string().optional(),
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/search", async (ctx) => {
	const { search } = userSearchQuerySchema.parse(ctx.query);

	if (!search || search.trim().length < 2) {
		ctx.body = [];
		return;
	}

	const pattern = new RegExp("^" + escapeRegex(search.trim().toLowerCase()));

	// Search both username (via slug) and email, with username matches first.
	const foundUsers = await colls.users
		.find({ $or: [{ "security.slug": pattern }, { "account.email": pattern }] }, { projection: { account: 1 } })
		.limit(queryCount(ctx))
		.toArray();
	ctx.body = foundUsers;
});

router.post("/:userId", async (ctx) => {
	const { account } = z.object({ account: z.object({ karma: z.number() }) }).parse(ctx.request.body);
	await colls.users.updateOne(
		{ _id: new ObjectId(ctx.params.userId) },
		{
			$set: { "account.karma": account.karma },
		},
	);
	ctx.status = 200;
});

router.post("/:userId/authority", async (ctx) => {
	const { authority } = z.object({ authority: z.enum(["user", "admin"]) }).parse(ctx.request.body);
	await colls.users.updateOne({ _id: new ObjectId(ctx.params.userId) }, { $set: { authority } });
	ctx.status = 200;
});

router.post("/:userId/elo/:game", async (ctx) => {
	const { value } = z.object({ value: z.number() }).parse(ctx.request.body);
	await colls.gamePreferences.updateOne(
		{ user: new ObjectId(ctx.params.userId), game: ctx.params.game },
		{ $set: { "elo.value": value } },
		{ upsert: false },
	);
	ctx.status = 200;
});

router.post("/:userId/access/grant", async (ctx) => {
	const { game, version } = z
		.object({
			type: z.literal("game"),
			game: z.string(),
			version: z.union([z.number().int(), z.literal("latest")]),
		})
		.parse(ctx.request.body);

	const gameInfo = await findGameInfoWithVersion(game, version);

	if (!gameInfo) {
		ctx.status = 404;
		return;
	}

	if (gameInfo.meta.public) {
		ctx.status = 200;
		return;
	}

	if (!(await colls.users.countDocuments({ _id: new ObjectId(ctx.params.userId) }))) {
		ctx.status = 404;
		return;
	}

	await colls.gamePreferences.updateOne(
		{ user: new ObjectId(ctx.params.userId), game },
		{ $set: { "access.maxVersion": gameInfo._id.version } },
		{ upsert: true },
	);
	ctx.status = 200;
});

const zeroMethodCounts = () => ({ password: 0, google: 0, facebook: 0, discord: 0, github: 0, huggingface: 0 });

// DELETE /api/admin/users/:userId/refresh-tokens — revoke all sessions (refresh tokens) of a user
router.delete("/:userId/refresh-tokens", async (ctx) => {
	const userId = new ObjectId(ctx.params.userId);

	if (!(await colls.users.countDocuments({ _id: userId }))) {
		ctx.status = 404;
		return;
	}

	const { deletedCount } = await colls.jwtRefreshTokens.deleteMany({ user: userId });

	ctx.body = { deleted: deletedCount };
});

// GET /api/admin/users/login-methods — users grouped by login mechanisms, split by recent activity
router.get("/login-methods", async (ctx) => {
	const recentDays = 90;
	const since = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);

	const grouped = await colls.users
		.aggregate<{
			_id: {
				password: boolean;
				google: boolean;
				facebook: boolean;
				discord: boolean;
				github: boolean;
				huggingface: boolean;
				recent: boolean;
			};
			count: number;
		}>([
			{
				$group: {
					_id: {
						password: { $gt: [{ $strLenCP: { $ifNull: ["$account.password", ""] } }, 0] },
						google: { $gt: ["$account.social.google", null] },
						facebook: { $gt: ["$account.social.facebook", null] },
						discord: { $gt: ["$account.social.discord", null] },
						github: { $gt: ["$account.social.github", null] },
						huggingface: { $gt: ["$account.social.huggingface", null] },
						recent: { $gte: [{ $ifNull: ["$security.lastLogin.date", new Date(0)] }, since] },
					},
					count: { $sum: 1 },
				},
			},
		])
		.toArray();

	const perMethod = { recent: zeroMethodCounts(), older: zeroMethodCounts() };
	// The $group splits each method set into recent/older buckets — merge them back
	// so every combination is a single row carrying both counts.
	const comboMap = new Map<string, { methods: string[]; recent: number; older: number }>();

	for (const { _id, count } of grouped) {
		const bucket = _id.recent ? "recent" : "older";
		if (_id.password) {
			perMethod[bucket].password += count;
		}
		if (_id.google) {
			perMethod[bucket].google += count;
		}
		if (_id.facebook) {
			perMethod[bucket].facebook += count;
		}
		if (_id.discord) {
			perMethod[bucket].discord += count;
		}
		if (_id.github) {
			perMethod[bucket].github += count;
		}
		if (_id.huggingface) {
			perMethod[bucket].huggingface += count;
		}

		const methods = (["password", "google", "facebook", "discord", "github", "huggingface"] as const).filter(
			(m) => _id[m],
		);
		const key = methods.join("+");
		const row = comboMap.get(key) ?? { methods, recent: 0, older: 0 };
		if (_id.recent) {
			row.recent += count;
		} else {
			row.older += count;
		}
		comboMap.set(key, row);
	}

	const combinations = [...comboMap.values()].sort((a, b) => b.recent + b.older - (a.recent + a.older));

	// Real login trend: refresh tokens double as a login log (bounded by their 120-day TTL).
	// Each token is stamped with the login method used to open the session.
	const trendWeeks = 13;
	const trendSince = new Date(Date.now() - trendWeeks * 7 * DAY_MS);

	const [sessionsByMethod, loginsByMethodWeek] = await Promise.all([
		colls.jwtRefreshTokens
			.aggregate<{ _id: string | null; count: number }>([{ $group: { _id: "$loginMethod", count: { $sum: 1 } } }])
			.toArray(),
		colls.jwtRefreshTokens
			.aggregate<{ _id: { week: string; method: string }; count: number }>([
				{ $match: { createdAt: { $gte: trendSince } } },
				{
					$group: {
						_id: {
							week: { $dateToString: { format: "%G-W%V", date: "$createdAt" } },
							method: { $ifNull: ["$loginMethod", "unknown"] },
						},
						count: { $sum: 1 },
					},
				},
				{ $sort: { "_id.week": 1 } },
			])
			.toArray(),
	]);

	const sessions: Record<string, number> = {};
	for (const { _id, count } of sessionsByMethod) {
		sessions[_id ?? "unknown"] = count;
	}

	const methodSet = new Set<string>();
	const countMap = new Map<string, number>();
	for (const { _id, count } of loginsByMethodWeek) {
		methodSet.add(_id.method);
		countMap.set(`${_id.week}/${_id.method}`, count);
	}
	const methods = [...methodSet].sort();

	// Fill missing weeks so the chart has a continuous x-axis (Mongo 8 sorts %G-W%V correctly).
	const weekSet = new Set<string>();
	for (let i = 0; i < trendWeeks; i++) {
		weekSet.add(isoWeekString(new Date(Date.now() - (trendWeeks - 1 - i) * 7 * DAY_MS)));
	}
	for (const { _id } of loginsByMethodWeek) {
		weekSet.add(_id.week);
	}
	const weeks = [...weekSet].sort();

	const loginsByWeek = weeks.map((week) => {
		const entry: Record<string, string | number> = { week };
		for (const method of methods) {
			entry[method] = countMap.get(`${week}/${method}`) ?? 0;
		}
		return entry;
	});

	ctx.body = { recentDays, perMethod, combinations, sessions, trend: { weeks: trendWeeks, methods, loginsByWeek } };
});

const DAY_MS = 24 * 3600 * 1000;

function isoWeekString(date: Date): string {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	// Move to the Thursday of the ISO week — the ISO year is the year that Thursday falls in.
	d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
	const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
	firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));
	const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
	return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

router.post("/:userId/confirm", async (ctx) => {
	if (!(await colls.users.countDocuments({ _id: new ObjectId(ctx.params.userId) }))) {
		return;
	}

	await colls.users.updateOne(
		{ _id: new ObjectId(ctx.params.userId) },
		{ $set: { "security.confirmed": true, "security.confirmKey": null } },
	);
	ctx.status = 200;
});

router.delete("/:userId", async (ctx) => {
	const userId = new ObjectId(ctx.params.userId);

	if (!(await colls.users.countDocuments({ _id: userId }))) {
		ctx.status = 404;
		return;
	}

	await Promise.all([
		colls.users.deleteOne({ _id: userId }),
		colls.jwtRefreshTokens.deleteMany({ user: userId }),
		colls.gamePreferences.deleteMany({ user: userId }),
		colls.apiErrors.deleteMany({ user: userId }),
		colls.gameNotifications.deleteMany({ user: userId }),
		colls.roomMetaData.deleteMany({ user: userId }),
	]);

	ctx.status = 200;
});

router.get("/:userId/api-errors", async (ctx) => {
	if (!(await colls.users.countDocuments({ _id: new ObjectId(ctx.params.userId) }))) {
		return;
	}

	ctx.body = await colls.apiErrors
		.find({ user: new ObjectId(ctx.params.userId) })
		.sort({ createdAt: -1 })
		.limit(10)
		.toArray();
});

router.get("/infoByName/:username", async (ctx) => {
	const user = await findByUsername(ctx.params.username);

	if (!user) {
		// Not an active account — it may have been archived to deletedUsers by the
		// dead-user cleanup. Answer 200 with a marker so the admin UI can show a
		// "deleted/archived" state instead of a bare "not found".
		const slug = ctx.params.username.toLowerCase();
		const archived =
			(await colls.deletedUsers.findOne(
				{ "security.slug": slug },
				{ sort: { deletedAt: -1 }, projection: { userId: 1, "account.username": 1, createdAt: 1, deletedAt: 1 } },
			)) ??
			(await colls.deletedUsers.findOne(
				{ "account.username": ctx.params.username },
				{ sort: { deletedAt: -1 }, projection: { userId: 1, "account.username": 1, createdAt: 1, deletedAt: 1 } },
			));

		if (archived) {
			ctx.body = { archived: true, ...archived };
			return;
		}

		ctx.status = 404;
		return;
	}

	// Count games by status and get recent games
	const [gameCounts, recentGames] = await Promise.all([
		colls.games
			.aggregate<{ _id: string; count: number }>([
				{ $match: { "players._id": user._id } },
				{ $group: { _id: "$status", count: { $sum: 1 } } },
			])
			.toArray(),
		colls.games
			.find(
				{ "players._id": user._id },
				{ projection: { _id: 1, "game.name": 1, status: 1, lastMove: 1, createdAt: 1 } },
			)
			.sort({ lastMove: -1 })
			.limit(10)
			.toArray(),
	]);

	const games: Record<string, number> = {};
	for (const g of gameCounts) {
		games[g._id] = g.count;
	}

	ctx.body = { ...user, games, recentGames };
});

export default router;
