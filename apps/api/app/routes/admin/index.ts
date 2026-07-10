import checkDiskSpace from "check-disk-space";
import fs from "node:fs";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import path from "node:path";
import { env } from "../../config/index.ts";
import { colls } from "../../config/db.ts";
import {
  announcementSchema,
  findByEmail,
  findByUsername,
  recalculateKarma,
  sendConfirmationEmail,
  SettingsKey,
} from "../../models/index.ts";
import { sendAuthInfo } from "../account/index.ts";
import { z } from "zod";
import { isAdmin } from "../utils.ts";
import gameInfo from "./gameinfo.ts";
import loki from "./loki.ts";
import page from "./pages.ts";
import usersRouter from "./users.ts";

const router = new Router<Application.DefaultState, Context>();

router.use(isAdmin);

router.use("/gameinfo", gameInfo.routes(), gameInfo.allowedMethods());
router.use("/loki", loki.routes(), loki.allowedMethods());
router.use("/page", page.routes(), page.allowedMethods());
router.use("/users", usersRouter.routes(), usersRouter.allowedMethods());

// GET /api/admin/errors — recent genuine errors from the apierrors DB collection
// (uncaught exceptions, assertion failures — not routine 4xx HTTP responses).
router.get("/errors", async (ctx) => {
  const errors = await colls.apiErrors
    .find(
      {},
      {
        projection: {
          "error.name": 1,
          "error.message": 1,
          "request.method": 1,
          "request.url": 1,
          "request.status": 1,
          "request.id": 1,
          user: 1,
          createdAt: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  ctx.body = errors;
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
    onlineUsers,
    connectedUsers,
    gamesByStatus,
    queueByKind,
    recentUsers,
    recentGames,
    announcement,
  ] = await Promise.all([
    checkDiskSpace(process.cwd()),
    colls.users.countDocuments({}),
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
    colls.settings.findOne({ _id: SettingsKey.Announcement }),
  ]);

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
    onlineUsers,
    connectedUsers,
    games,
    queue,
    recentUsers,
    recentGames,
    announcement: announcement?.value,
    cron: env.cron,
  };
});

router.post("/resend-confirmation", async (ctx) => {
  const { email } = z.object({ email: z.string().email() }).parse(ctx.request.body);
  const user = await findByEmail(email);

  if (!user) {
    throw createError(404, "User not found: " + email);
  }

  await sendConfirmationEmail(user);
  ctx.status = 200;
});

router.post("/login-as", async (ctx) => {
  const { username } = z.object({ username: z.string() }).parse(ctx.request.body);
  const user = await findByUsername(username);

  if (!user) {
    throw createError(404, "User not found: " + username);
  }

  ctx.state.user = user;

  await sendAuthInfo(ctx);
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

router.post("/announcement", async (ctx) => {
  const { announcement } = z.object({ announcement: announcementSchema.optional() }).parse(ctx.request.body);
  await colls.settings.updateOne(
    { _id: SettingsKey.Announcement },
    { $set: { value: announcement } },
    { upsert: true },
  );
  ctx.status = 200;
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
