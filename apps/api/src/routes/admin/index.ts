import checkDiskSpace from "check-disk-space";
import fs from "fs";
import createError from "http-errors";
import { Context } from "koa";
import Router from "koa-router";
import path from "path";
import { env } from "../../config";
import { Game, GameNotification, Log, Settings, SettingsKey, User } from "../../models";
import { sendAuthInfo } from "../account";
import { isAdmin } from "../utils";
import gameInfo from "./gameinfo";
import page from "./pages";
import users from "./users";

const router = new Router<Application.DefaultState, Context>();

router.use(isAdmin);

router.use("/gameinfo", gameInfo.routes(), gameInfo.allowedMethods());
router.use("/page", page.routes(), page.allowedMethods());
router.use("/users", users.routes(), users.allowedMethods());

router.get("/backup/games", async (ctx) => {
  ctx.set({ "Content-Type": "application/gzip", "Content-Disposition": 'attachment; filename="games.bson.gz"' });
  ctx.body = fs.createReadStream(`../../../dump/${env.database.bgs.name}/games.bson.gz`);
});

router.get("/serverinfo", async (ctx) => {
  ctx.body = {
    disk: await checkDiskSpace(process.cwd()),
    nbUsers: await User.count({}),
    announcement: (await Settings.findById(SettingsKey.Announcement))?.value,
    cron: env.cron,
  };
});

router.post("/resend-confirmation", async (ctx) => {
  const { email } = ctx.request.body;
  const user = await User.findByEmail(email);

  if (!user) {
    throw createError(404, "User not found: " + email);
  }

  await user.sendConfirmationEmail();
  ctx.status = 200;
});

router.post("/login-as", async (ctx) => {
  const { username } = ctx.request.body;
  const user = await User.findByUsername(username);

  if (!user) {
    throw createError(404, "User not found: " + username);
  }

  ctx.state.user = user;

  await sendAuthInfo(ctx);
});

router.post("/compute-karma", async (ctx) => {
  const { username } = ctx.request.body;
  const user = await User.findByUsername(username);

  if (!user) {
    throw createError(404, "User not found: " + username);
  }

  await user.recalculateKarma();
  await user.save();

  ctx.status = 200;
});

router.post("/compute-all-karma", async (ctx) => {
  for (const user of await User.find()) {
    await user.recalculateKarma(new Date("2020-05-10"));
    await user.save();
  }

  ctx.status = 200;
});

router.post("/load-games", async (ctx) => {
  const dirPath = ctx.request.body?.path;

  for (const file of fs.readdirSync(dirPath)) {
    if (!file.endsWith("json")) {
      continue;
    }
    const gameId = file.replace(/\.json$/, "");
    const json = JSON.parse(fs.readFileSync(path.join(dirPath, file)).toString("utf-8"));

    const game = await Game.findById(gameId);

    for (const key of Object.keys(json)) {
      game[key] = json[key];
    }

    await game.save();
  }
});

router.post("/announcement", async (ctx) => {
  await Settings.updateOne(
    { _id: SettingsKey.Announcement },
    { $set: { value: ctx.request.body?.announcement } },
    { upsert: true }
  );
  ctx.status = 200;
});

router.post("/recreate-notifications", async (ctx) => {
  const notifications = await Game.aggregate([
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
        from: Log.collection.name,
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
        from: GameNotification.collection.name,
        localField: "_id",
        foreignField: "game",
        as: "notification",
      },
    },
    {
      $match: {
        game: {
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
  ]);

  await GameNotification.insertMany(notifications);
  ctx.status = 200;
  ctx.body = notifications;
});

export default router;
