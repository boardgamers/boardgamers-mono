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
